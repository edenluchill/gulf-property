#Requires -Version 5.1

<#
.SYNOPSIS
    Hetzner Backend Deployment Script for Pinzos

.DESCRIPTION
    Deploy the Pinzos backend API to Hetzner Cloud
    Database should be deployed separately (managed PostgreSQL or dedicated server)
    SSL is handled by Cloudflare — no Let's Encrypt needed

    Prerequisites:
    1. Install hcloud CLI: https://github.com/hetznercloud/cli/releases
    2. Install Docker Desktop
    3. Configure hcloud context: hcloud context create pinzos
    4. Prepare .env.production file with production credentials
    5. Ensure PostgreSQL database is accessible
    6. Configure Cloudflare DNS to point domain to Load Balancer IP

.EXAMPLE
    .\hetzner-deploy.ps1

.NOTES
    Author: Pinzos Team
    Version: 3.0
    Updates: Removed Let's Encrypt — SSL handled by Cloudflare
#>

param(
    [string]$Domain = "api.pinzos.com"
)

# Configuration
$ErrorActionPreference = "Stop"
$PROJECT_NAME = "Pinzos"
$DOCKER_NAME = $PROJECT_NAME.ToLower()
$LOCATION = "nbg1"                # Nuremberg, Germany (closest to Dubai)
# With worker architecture: main API handles requests, worker handles heavy PDF processing
$SERVER_TYPE = "cpx22"            # 4 vCPU, 8GB RAM
$LB_TYPE = "lb11"
$INITIAL_INSTANCES = 1            # Start with 1 instance (can scale later)
$NETWORK_ZONE = "eu-central"

# GitHub Container Registry
$GITHUB_USERNAME = "edenluchill"
$GHCR_IMAGE = "ghcr.io/$GITHUB_USERNAME/pinzos-backend"

# Switch to correct Hetzner project (try multiple variations)
$contextNames = @($PROJECT_NAME, "pinzos", "Pinzos")
$contextFound = $false

Write-Host "Searching for Hetzner project context..." -ForegroundColor Yellow

foreach ($contextName in $contextNames) {
    $ErrorActionPreference = "Continue"
    hcloud context use $contextName 2>$null
    $ErrorActionPreference = "Stop"

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Using context: $contextName" -ForegroundColor Green
        $contextFound = $true
        break
    }
}

if (-not $contextFound) {
    Write-Host "[FAIL] No matching Hetzner context found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available contexts:" -ForegroundColor Yellow
    hcloud context list
    Write-Host ""
    Write-Host "Please use one of these options:" -ForegroundColor Yellow
    Write-Host "  1. Switch to existing: hcloud context use pinzos" -ForegroundColor Cyan
    Write-Host "  2. Create new: hcloud context create Pinzos" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# Color output functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Write-Step {
    param([string]$Message)
    Write-Host "[STEP] $Message" -ForegroundColor Cyan
}

# ============================================================================
# Check Prerequisites
# ============================================================================

Write-Step "Checking prerequisites..."

# Check hcloud
try {
    $null = Get-Command hcloud -ErrorAction Stop
    Write-Success "hcloud CLI installed"
} catch {
    Write-Error-Custom "hcloud CLI not installed"
    Write-Host "Download from: https://github.com/hetznercloud/cli/releases"
    exit 1
}

# Check Docker
try {
    $null = Get-Command docker -ErrorAction Stop
    Write-Success "Docker installed"
} catch {
    Write-Error-Custom "Docker not installed"
    exit 1
}

# Check Docker daemon
Write-Info "Checking Docker daemon status..."
try {
    $ErrorActionPreference = "Continue"
    $dockerInfo = docker info 2>&1 | Out-String
    $dockerExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"

    if ($dockerExitCode -ne 0) {
        Write-Error-Custom "Docker daemon is not responding"
        Write-Host "Please start Docker Desktop" -ForegroundColor Yellow
        exit 1
    }
    Write-Success "Docker daemon is running"
} catch {
    Write-Error-Custom "Failed to check Docker status"
    exit 1
}

# Check .env file
$ENV_FILE = ".env.production"
if (-not (Test-Path $ENV_FILE)) {
    Write-Error-Custom "Production environment file not found: $ENV_FILE"
    Write-Host ""
    Write-Host "Please create $ENV_FILE with production credentials:" -ForegroundColor Yellow
    Write-Host "  - PORT"
    Write-Host "  - DB_HOST (your PostgreSQL server)"
    Write-Host "  - DB_PORT"
    Write-Host "  - DB_NAME"
    Write-Host "  - DB_USER"
    Write-Host "  - DB_PASSWORD"
    Write-Host "  - GEMINI_API_KEY"
    Write-Host "  - CORS_ORIGIN"
    exit 1
}

Write-Success "Using production environment: $ENV_FILE"

# Detect port
$APP_PORT = 3000
$envContent = Get-Content $ENV_FILE -Raw
if ($envContent -match "PORT=(\d+)") {
    $APP_PORT = [int]$matches[1]
    Write-Info "Detected application port: $APP_PORT"
}

# Verify database credentials exist
$requiredVars = @('DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'GEMINI_API_KEY')
$missingVars = @()
foreach ($var in $requiredVars) {
    if ($envContent -notmatch "$var=.+") {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Error-Custom "Missing required environment variables in $ENV_FILE"
    Write-Host "Missing: $($missingVars -join ', ')" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Info "Configuration:"
Write-Host "  Project: $PROJECT_NAME"
Write-Host "  Environment: $ENV_FILE"
Write-Host "  Location: $LOCATION"
Write-Host "  Server Type: $SERVER_TYPE"
Write-Host "  Instances: $INITIAL_INSTANCES"
Write-Host "  Load Balancer: $LB_TYPE"
Write-Host "  SSL: Cloudflare (no origin cert needed)"
Write-Host ""
Write-Info "Starting deployment..."
Write-Host ""

# ============================================================================
# 1. SSH Key
# ============================================================================

Write-Step "1/7 Configuring SSH key..."

$SSH_KEY_NAME = "$PROJECT_NAME-key"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\${PROJECT_NAME}_ed25519"

$keyExists = $false
try {
    $ErrorActionPreference = "Continue"
    $null = hcloud ssh-key describe $SSH_KEY_NAME 2>$null
    $keyExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
} catch {
    $keyExists = $false
    $ErrorActionPreference = "Stop"
}

if ($keyExists) {
    Write-Success "SSH key exists: $SSH_KEY_NAME"
} else {
    if (-not (Test-Path $SSH_KEY_PATH)) {
        Write-Info "Generating SSH key..."
        ssh-keygen -t ed25519 -f $SSH_KEY_PATH -N '""' -C "hetzner-$PROJECT_NAME"
        Write-Success "SSH key generated"
    }

    Write-Info "Uploading SSH key..."
    hcloud ssh-key create --name $SSH_KEY_NAME --public-key-from-file "${SSH_KEY_PATH}.pub"
    Write-Success "SSH key uploaded"
}

# ============================================================================
# 2. Private Network
# ============================================================================

Write-Step "2/7 Creating private network..."

$NETWORK_NAME = "$PROJECT_NAME-network"

$networkExists = $false
try {
    $ErrorActionPreference = "Continue"
    $null = hcloud network describe $NETWORK_NAME 2>$null
    $networkExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
} catch {
    $networkExists = $false
    $ErrorActionPreference = "Stop"
}

if ($networkExists) {
    Write-Success "Network exists: $NETWORK_NAME"
} else {
    Write-Info "Creating network..."
    hcloud network create --name $NETWORK_NAME --ip-range 10.0.0.0/16
    hcloud network add-subnet $NETWORK_NAME --network-zone $NETWORK_ZONE --type cloud --ip-range 10.0.1.0/24
    Write-Success "Network created: $NETWORK_NAME"
}

# ============================================================================
# 3. Firewall
# ============================================================================

Write-Step "3/7 Creating firewall..."

$FIREWALL_NAME = "$PROJECT_NAME-firewall"

$firewallExists = $false
try {
    $ErrorActionPreference = "Continue"
    $null = hcloud firewall describe $FIREWALL_NAME 2>$null
    $firewallExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
} catch {
    $firewallExists = $false
    $ErrorActionPreference = "Stop"
}

if (-not $firewallExists) {
    Write-Info "Creating firewall..."
    hcloud firewall create --name $FIREWALL_NAME
}

Write-Info "Syncing firewall rules..."

$rulesJson = @"
[
  {
    "direction": "in",
    "protocol": "tcp",
    "port": "22",
    "source_ips": ["0.0.0.0/0", "::/0"]
  },
  {
    "direction": "in",
    "protocol": "tcp",
    "port": "80",
    "source_ips": ["0.0.0.0/0", "::/0"]
  },
  {
    "direction": "in",
    "protocol": "tcp",
    "port": "443",
    "source_ips": ["0.0.0.0/0", "::/0"]
  },
  {
    "direction": "in",
    "protocol": "tcp",
    "port": "$APP_PORT",
    "source_ips": ["10.0.0.0/16", "0.0.0.0/0"]
  },
  {
    "direction": "in",
    "protocol": "icmp",
    "source_ips": ["0.0.0.0/0", "::/0"]
  }
]
"@

$tempFile = [System.IO.Path]::GetTempFileName()
$rulesJson | Out-File -FilePath $tempFile -Encoding ascii
hcloud firewall replace-rules $FIREWALL_NAME --rules-file $tempFile
Remove-Item $tempFile

Write-Success "Firewall configured"

# ============================================================================
# 4. Build and Push Docker Image
# ============================================================================

Write-Step "4/7 Building and pushing Docker image..."

$IMAGE_TAG = Get-Date -Format "yyyyMMdd-HHmmss"
Write-Info "Building: ${GHCR_IMAGE}:${IMAGE_TAG}"

# Build production-optimized image (using cache for faster builds)
docker build `
    --build-arg NODE_ENV=production `
    -t "${GHCR_IMAGE}:${IMAGE_TAG}" `
    -t "${GHCR_IMAGE}:latest" `
    -f Dockerfile.production .

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Docker build failed!"
    exit 1
}

Write-Success "Docker image built"

# Login to GitHub Container Registry
Write-Info "Logging in to GitHub Container Registry..."
if (-not $env:GITHUB_TOKEN) {
    Write-Error-Custom "GITHUB_TOKEN environment variable not set"
    Write-Host ""
    Write-Host "To set up GHCR access:" -ForegroundColor Yellow
    Write-Host "  1. Go to: https://github.com/settings/tokens" -ForegroundColor White
    Write-Host "  2. Create a token with 'write:packages' scope" -ForegroundColor White
    Write-Host "  3. Run: `$env:GITHUB_TOKEN = 'your_token_here'" -ForegroundColor Cyan
    Write-Host "  4. Then re-run this script" -ForegroundColor White
    exit 1
}

# NOTE: Windows PowerShell 管道喂 --password-stdin 会给 token 追加换行符导致
# "denied: denied"。改用 -p 直传(token 已在 env，deploy 场景可接受 insecure 提示)。
docker login ghcr.io -u $GITHUB_USERNAME -p $env:GITHUB_TOKEN

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Failed to login to GHCR"
    exit 1
}

Write-Success "Logged in to GHCR"

# Push image to registry
Write-Info "Pushing image to GHCR (only changed layers)..."
docker push "${GHCR_IMAGE}:${IMAGE_TAG}"
docker push "${GHCR_IMAGE}:latest"

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Failed to push image"
    exit 1
}

Write-Success "Image pushed to ${GHCR_IMAGE}:latest"

# ============================================================================
# 5. Create Backend Servers
# ============================================================================

Write-Step "5/7 Creating backend servers..."

$SERVER_IDS = @()
$SERVER_IPS = @()

for ($i = 1; $i -le $INITIAL_INSTANCES; $i++) {
    $SERVER_NAME = "$PROJECT_NAME-backend-$i"

    $serverExists = $false
    try {
        $ErrorActionPreference = "Continue"
        $null = hcloud server describe $SERVER_NAME 2>$null
        $serverExists = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = "Stop"
    } catch {
        $serverExists = $false
        $ErrorActionPreference = "Stop"
    }

    if ($serverExists) {
        Write-Warning "Server exists: $SERVER_NAME"
        $serverInfo = hcloud server describe $SERVER_NAME -o json | ConvertFrom-Json
        $SERVER_ID = $serverInfo.id
        $PUBLIC_IP = $serverInfo.public_net.ipv4.ip
    } else {
        Write-Info "Creating server $i/${INITIAL_INSTANCES}: $SERVER_NAME"

        $cloudInit = @'
#cloud-config
runcmd:
  - mkdir -p /opt/pinzos
  - mkdir -p /var/log/pinzos
'@

        $tempCloudInit = [System.IO.Path]::GetTempFileName()
        $cloudInit | Out-File -FilePath $tempCloudInit -Encoding utf8

        $serverJson = hcloud server create `
            --name $SERVER_NAME `
            --type $SERVER_TYPE `
            --location $LOCATION `
            --image ubuntu-22.04 `
            --ssh-key $SSH_KEY_NAME `
            --network $NETWORK_NAME `
            --firewall $FIREWALL_NAME `
            --label "app=$PROJECT_NAME" `
            --label "role=backend" `
            --user-data-from-file $tempCloudInit `
            -o json

        if ($LASTEXITCODE -ne 0) {
            Remove-Item $tempCloudInit
            Write-Error-Custom "Failed to create server"
            exit 1
        }

        Remove-Item $tempCloudInit

        $serverInfo = $serverJson | ConvertFrom-Json
        $SERVER_ID = $serverInfo.server.id

        Write-Info "Waiting for server initialization..."
        Start-Sleep -Seconds 30

        $serverInfo = hcloud server describe $SERVER_ID -o json | ConvertFrom-Json
        $PUBLIC_IP = $serverInfo.public_net.ipv4.ip
        Write-Success "Server created: $SERVER_NAME ($PUBLIC_IP)"
    }

    $SERVER_IDS += $SERVER_ID
    $SERVER_IPS += $PUBLIC_IP
}

# ============================================================================
# 6. Deploy Backend Application
# ============================================================================

Write-Step "6/7 Deploying backend to servers..."

for ($i = 0; $i -lt $SERVER_IPS.Count; $i++) {
    $IP = $SERVER_IPS[$i]
    $SERVER_NUM = $i + 1

    Write-Info "Deploying to server ${SERVER_NUM}: $IP"

    # Wait for SSH
    Write-Info "Waiting for SSH to become available..."
    $retries = 0
    $maxRetries = 30

    while ($retries -lt $maxRetries) {
        $retries++
        $ErrorActionPreference = "Continue"
        $sshResult = ssh -n -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o LogLevel=ERROR root@$IP "echo connected" 2>&1 | Select-String -Pattern "^connected$"
        $sshExitCode = $LASTEXITCODE
        $ErrorActionPreference = "Stop"

        if ($sshExitCode -eq 0 -and $sshResult) {
            Write-Success "SSH ready after $retries attempt(s)"
            break
        }

        if ($retries -eq $maxRetries) {
            Write-Error-Custom "SSH timeout after $maxRetries attempts for $IP"
            exit 1
        }
        Write-Host "  Attempt $retries/$maxRetries - waiting 5s..." -ForegroundColor Gray
        Start-Sleep -Seconds 5
    }

    # Create directories
    Write-Info "Creating directories..."
    $ErrorActionPreference = "Continue"
    ssh -n -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@$IP "mkdir -p /opt/pinzos /var/log/pinzos" 2>&1 | Out-Null
    $ErrorActionPreference = "Stop"

    Write-Info "Uploading configuration files..."
    $ErrorActionPreference = "Continue"

    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR `
        $ENV_FILE "root@${IP}:/opt/pinzos/.env" 2>&1 | Out-Null

    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR `
        docker-compose.production.yml "root@${IP}:/opt/pinzos/docker-compose.yml" 2>&1 | Out-Null

    # Upload nginx config — production version for Cloudflare
    if (Test-Path "nginx.production.conf") {
        Write-Info "Uploading nginx.production.conf (Cloudflare SSL)..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR `
            nginx.production.conf "root@${IP}:/opt/pinzos/nginx.conf" 2>&1 | Out-Null
    } elseif (Test-Path "nginx.conf") {
        Write-Info "Uploading nginx.conf (HTTP-only)..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR `
            nginx.conf "root@${IP}:/opt/pinzos/nginx.conf" 2>&1 | Out-Null
    } else {
        Write-Warning "No nginx config found, nginx may not work correctly"
    }

    $ErrorActionPreference = "Stop"
    Write-Info "SSL: Auto-configured via Cloudflare DNS challenge"

    Write-Info "Starting backend services..."

    # Pass credentials to server
    $ghcrToken = $env:GITHUB_TOKEN

    # Read Cloudflare token from .env.production
    $cfToken = ""
    if ($envContent -match "CLOUDFLARE_API_TOKEN=(.+)") {
        $cfToken = $matches[1].Trim()
    }

    $deployScript = @"
#!/bin/bash
set -e
cd /opt/pinzos

# Install Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    echo "Docker installed"
fi

# Login to GHCR and pull image
echo "Pulling image from GHCR..."
echo "$ghcrToken" | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
docker pull ${GHCR_IMAGE}:latest
echo "Image pulled"

# Verify .env file
if [ ! -f .env ]; then
    echo "ERROR: .env file not found!"
    exit 1
fi
echo "Environment file found"

# Setup SSL certificate for upload-api.pinzos.com (bypasses Cloudflare for 500MB+ uploads)
CERT_PATH="/etc/letsencrypt/live/upload-api.pinzos.com/fullchain.pem"
if [ ! -f "`$CERT_PATH" ]; then
    echo "Setting up SSL certificate..."

    # Install certbot with Cloudflare plugin
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-dns-cloudflare

    # Create Cloudflare credentials
    CF_TOKEN="$cfToken"
    if [ -n "`$CF_TOKEN" ]; then
        mkdir -p /root/.secrets
        echo "dns_cloudflare_api_token = `$CF_TOKEN" > /root/.secrets/cloudflare.ini
        chmod 600 /root/.secrets/cloudflare.ini

        # Generate certificate using DNS challenge
        certbot certonly --dns-cloudflare \
            --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
            -d upload-api.pinzos.com \
            --non-interactive --agree-tos --email admin@pinzos.com

        echo "SSL certificate generated"
    else
        echo "WARNING: CLOUDFLARE_API_TOKEN not set, skipping SSL setup"
        echo "Add CLOUDFLARE_API_TOKEN to .env.production for automatic SSL"
    fi
else
    echo "SSL certificate exists"
fi

# Pull nginx if needed
if grep -q "nginx:" docker-compose.yml 2>/dev/null; then
    echo "Pulling nginx image..."
    docker pull nginx:alpine
fi

# Start containers
echo "Starting containers..."
HOST_PORT=`$(grep '^PORT=' .env | cut -d '=' -f 2 | tr -d '\r' || echo "3000")
echo "Detected PORT: `$HOST_PORT"

# Use docker compose v2 syntax (Docker plugin)
docker compose down 2>/dev/null || true
docker compose up -d --force-recreate --no-build

# Wait for health check
echo "Verifying health..."
SUCCESS=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -s --max-time 2 "http://127.0.0.1:`$HOST_PORT/health" | grep -q 'ok\|healthy' || \
       curl -s --max-time 2 "http://127.0.0.1/health" | grep -q 'ok\|healthy'; then
        echo "Backend is UP"
        SUCCESS=1
        break
    fi
    echo "Waiting... (attempt `$i/15)"
    sleep 3
done

if [ `$SUCCESS -eq 0 ]; then
    echo "Health check failed!"
    docker ps
    docker logs pinzos-api --tail 100
    exit 1
fi

echo ""
echo "Backend deployed successfully on this server"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
"@

    $tempScript = [System.IO.Path]::GetTempFileName()
    $unixScript = $deployScript -replace "`r`n", "`n" -replace "`r", "`n"
    [System.IO.File]::WriteAllText($tempScript, $unixScript, [System.Text.UTF8Encoding]::new($false))

    $ErrorActionPreference = "Continue"
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR $tempScript "root@${IP}:/tmp/deploy.sh" 2>&1 | Out-Null
    ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@$IP "chmod +x /tmp/deploy.sh && /tmp/deploy.sh"
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    Remove-Item $tempScript -Force -ErrorAction SilentlyContinue

    if ($exitCode -ne 0) {
        Write-Error-Custom "Deployment failed on server $SERVER_NUM"
        exit 1
    }

    Write-Success "Server $SERVER_NUM deployed successfully"
}


# ============================================================================
# 7. Create Load Balancer
# ============================================================================

Write-Step "7/7 Creating Load Balancer..."

$LB_NAME = "$PROJECT_NAME-lb"

$lbExists = $false
try {
    $ErrorActionPreference = "Continue"
    $null = hcloud load-balancer describe $LB_NAME 2>$null
    $lbExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
} catch {
    $lbExists = $false
    $ErrorActionPreference = "Stop"
}

if ($lbExists) {
    Write-Success "Load Balancer exists: $LB_NAME"
    $lbInfo = hcloud load-balancer describe $LB_NAME -o json | ConvertFrom-Json
    $LB_IP = $lbInfo.public_net.ipv4.ip
} else {
    Write-Info "Creating Load Balancer..."

    $lbJson = hcloud load-balancer create `
        --name $LB_NAME `
        --type $LB_TYPE `
        --location $LOCATION `
        --network $NETWORK_NAME `
        --label "app=$PROJECT_NAME" `
        -o json

    $lbInfo = $lbJson | ConvertFrom-Json
    $LB_IP = $lbInfo.load_balancer.public_net.ipv4.ip
    Write-Success "Load Balancer created: $LB_IP"
}

# Configure HTTP service (Cloudflare connects on port 80)
Write-Info "Configuring Load Balancer service..."

$lbInfo = hcloud load-balancer describe $LB_NAME -o json | ConvertFrom-Json

$serviceExists = $false
foreach ($service in $lbInfo.services) {
    if ($service.listen_port -eq 80) {
        $serviceExists = $true
        break
    }
}

if (-not $serviceExists) {
    hcloud load-balancer add-service $LB_NAME `
        --protocol http `
        --listen-port 80 `
        --destination-port 80 `
        --health-check-protocol http `
        --health-check-port 80 `
        --health-check-http-path /health `
        --health-check-interval 10s `
        --health-check-timeout 5s `
        --health-check-retries 3

    Write-Success "HTTP service configured"
}

# Add HTTPS (443) passthrough for direct uploads (bypassing Cloudflare)
$httpsServiceExists = $false
foreach ($service in $lbInfo.services) {
    if ($service.listen_port -eq 443) {
        $httpsServiceExists = $true
        break
    }
}

if (-not $httpsServiceExists) {
    Write-Info "Adding HTTPS passthrough service for upload-api..."
    hcloud load-balancer add-service $LB_NAME `
        --protocol tcp `
        --listen-port 443 `
        --destination-port 443

    Write-Success "HTTPS passthrough service configured (for upload-api.pinzos.com)"
}

# Add server targets
Write-Info "Adding servers to Load Balancer..."
foreach ($id in $SERVER_IDS) {
    $targetExists = $false
    $lbInfo = hcloud load-balancer describe $LB_NAME -o json | ConvertFrom-Json
    foreach ($target in $lbInfo.targets) {
        if ($target.type -eq "server" -and $target.server.id -eq $id) {
            $targetExists = $true
            break
        }
    }

    if (-not $targetExists) {
        hcloud load-balancer add-target $LB_NAME --server $id --use-private-ip
        Write-Success "Added server $id to Load Balancer"
    }
}

Write-Success "Load Balancer configured: $LB_IP"

# Verify deployment via LB
Write-Info "Waiting for Load Balancer health checks..."
Start-Sleep -Seconds 15

$verified = $false
$maxRetries = 10

for ($retry = 1; $retry -le $maxRetries; $retry++) {
    Write-Info "Verification attempt $retry/$maxRetries..."

    try {
        $response = Invoke-WebRequest -Uri "http://$LB_IP/health" -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Write-Success "Load Balancer health check PASSED!"
            $verified = $true
            break
        }
    } catch {
        Write-Info "Waiting for services to be healthy..."
    }

    if (-not $verified -and $retry -lt $maxRetries) {
        Start-Sleep -Seconds 10
    }
}

if (-not $verified) {
    Write-Warning "Verification timed out, but servers may still be starting"
    Write-Info "Check health manually: http://$LB_IP/health"
}

# ============================================================================
# Deployment Summary
# ============================================================================

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Success "$PROJECT_NAME Backend Deployment Complete!"
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend Servers:" -ForegroundColor Cyan
for ($i = 0; $i -lt $SERVER_IPS.Count; $i++) {
    $num = $i + 1
    Write-Host "  Server ${num}: $($SERVER_IPS[$i])" -ForegroundColor White
}
Write-Host ""
Write-Host "Load Balancer:" -ForegroundColor Cyan
Write-Host "  Public IP: $LB_IP" -ForegroundColor White
Write-Host "  Health: http://$LB_IP/health" -ForegroundColor White
Write-Host ""
Write-Host "SSL Configuration:" -ForegroundColor Cyan
Write-Host "  api.pinzos.com: Cloudflare Flexible (orange cloud)" -ForegroundColor Green
Write-Host "  upload-api.pinzos.com: Direct HTTPS (gray cloud, DNS-only)" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Verify API is working:" -ForegroundColor White
Write-Host "     curl https://$Domain/health" -ForegroundColor Gray
Write-Host "  2. Cloudflare DNS (2 records needed):" -ForegroundColor White
Write-Host "     A record: $Domain -> $LB_IP (Proxied / orange cloud)" -ForegroundColor Gray
Write-Host "     A record: upload-api.pinzos.com -> $LB_IP (DNS only / gray cloud)" -ForegroundColor Gray
Write-Host "  3. If upload-api HTTPS not working, generate cert on server:" -ForegroundColor White
Write-Host "     ssh root@<server-ip>" -ForegroundColor Gray
Write-Host "     docker stop pinzos-nginx" -ForegroundColor Gray
Write-Host "     certbot certonly --standalone -d upload-api.pinzos.com" -ForegroundColor Gray
Write-Host "     docker start pinzos-nginx" -ForegroundColor Gray
Write-Host ""
Write-Host "Troubleshooting:" -ForegroundColor Yellow
Write-Host "  SSH Access:" -ForegroundColor White
Write-Host "    ssh -i $SSH_KEY_PATH root@<server-ip>" -ForegroundColor Gray
Write-Host "  View Logs:" -ForegroundColor White
Write-Host "    ssh -i $SSH_KEY_PATH root@<server-ip> 'docker logs pinzos-api -f'" -ForegroundColor Gray
Write-Host ""
