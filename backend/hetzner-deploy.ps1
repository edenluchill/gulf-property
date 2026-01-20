#Requires -Version 5.1

<#
.SYNOPSIS
    Hetzner Backend Deployment Script for Gulf Property
    
.DESCRIPTION
    Deploy the Gulf Property backend API to Hetzner Cloud
    Database should be deployed separately (managed PostgreSQL or dedicated server)
    
    Prerequisites:
    1. Install hcloud CLI: https://github.com/hetznercloud/cli/releases
    2. Install Docker Desktop
    3. Configure hcloud context: hcloud context create gulf-property
    4. Prepare .env.production file with production credentials
    5. Ensure PostgreSQL database is accessible
    
.EXAMPLE
    .\hetzner-deploy.ps1
    
.NOTES
    Author: Gulf Property Team
    Version: 1.0
#>

# Configuration
$ErrorActionPreference = "Stop"
$PROJECT_NAME = "GulfProperty"
$DOCKER_NAME = $PROJECT_NAME.ToLower()
$LOCATION = "nbg1"                # Nuremberg, Germany (closest to Dubai)
$SERVER_TYPE = "cpx22"            # 4 vCPU, 8GB RAM (cpx21 not available in nbg1, using next option)
$LB_TYPE = "lb11"
$INITIAL_INSTANCES = 1            # Start with 2 instances for redundancy
$NETWORK_ZONE = "eu-central"

# Switch to correct Hetzner project (try multiple variations)
$contextNames = @($PROJECT_NAME, "gulf-property", "gulfproperty", "Gulf-Property")
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
    Write-Host "  1. Switch to existing: hcloud context use gulf-property" -ForegroundColor Cyan
    Write-Host "  2. Create new: hcloud context create GulfProperty" -ForegroundColor Cyan
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
Write-Host "  Target Port: $APP_PORT"
Write-Host ""
Write-Info "Starting deployment..."
Write-Host ""

# ============================================================================
# 1. SSH Key
# ============================================================================

Write-Step "1/8 Configuring SSH key..."

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

Write-Step "2/8 Creating private network..."

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

Write-Step "3/8 Creating firewall..."

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
# 4. Build Docker Image
# ============================================================================

Write-Step "4/8 Building Docker image..."

$IMAGE_TAG = Get-Date -Format "yyyyMMdd-HHmmss"
Write-Info "Building: ${DOCKER_NAME}-backend:${IMAGE_TAG}"

# Build production-optimized image
docker build --no-cache `
    --build-arg NODE_ENV=production `
    -t "${DOCKER_NAME}-backend:${IMAGE_TAG}" `
    -f Dockerfile.production .

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Docker build failed!"
    exit 1
}

docker tag "${DOCKER_NAME}-backend:${IMAGE_TAG}" "${DOCKER_NAME}-backend:latest"

Write-Success "Docker image built"

# Save image
Write-Info "Exporting image (this may take a few minutes)..."
$TEMP_TAR = "$env:TEMP\${PROJECT_NAME}-backend-${IMAGE_TAG}.tar"
docker save "${DOCKER_NAME}-backend:latest" -o $TEMP_TAR

if (-not (Test-Path $TEMP_TAR)) {
    Write-Error-Custom "Docker tar not found"
    exit 1
}

$imageSizeMB = [math]::Round((Get-Item $TEMP_TAR).Length / 1MB, 2)
Write-Success "Image exported ($imageSizeMB MB)"

# ============================================================================
# 5. Create Backend Servers
# ============================================================================

Write-Step "5/8 Creating backend servers..."

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
  - mkdir -p /opt/gulf-property
  - mkdir -p /var/log/gulf-property
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

Write-Step "6/8 Deploying backend to servers..."

for ($i = 0; $i -lt $SERVER_IPS.Count; $i++) {
    $IP = $SERVER_IPS[$i]
    $SERVER_NUM = $i + 1
    
    Write-Info "Deploying to server ${SERVER_NUM}: $IP"
    
    # Wait for SSH
    Write-Info "Waiting for SSH..."
    $retries = 0
    $maxRetries = 30
    
    while ($retries -lt $maxRetries) {
        try {
            ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$IP "echo ok" 2>$null
            if ($LASTEXITCODE -eq 0) { break }
        } catch {}
        
        $retries++
        if ($retries -eq $maxRetries) {
            Write-Error-Custom "SSH timeout for $IP"
            exit 1
        }
        Start-Sleep -Seconds 5
    }
    
    Write-Success "SSH connection established"
    
    # Create directories
    Write-Info "Creating directories..."
    ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$IP "mkdir -p /opt/gulf-property /var/log/gulf-property"
    
    Write-Info "Uploading Docker image (this will take several minutes)..."
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
        -o Compression=yes `
        $TEMP_TAR `
        "root@${IP}:/tmp/image.tar"
    
    Write-Info "Uploading configuration files..."
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
        $ENV_FILE `
        "root@${IP}:/opt/gulf-property/.env"
    
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
        docker-compose.production.yml `
        "root@${IP}:/opt/gulf-property/docker-compose.yml"
    
    # Upload nginx config - prioritize nginx.conf for simplicity
    if (Test-Path "nginx.conf") {
        Write-Info "Uploading nginx.conf (HTTP-only, simple config)..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            nginx.conf `
            "root@${IP}:/opt/gulf-property/nginx.conf"
    } elseif (Test-Path "nginx.production-no-ssl.conf") {
        Write-Info "Uploading nginx.production-no-ssl.conf..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            nginx.production-no-ssl.conf `
            "root@${IP}:/opt/gulf-property/nginx.conf"
    } else {
        Write-Warning "No nginx config found, nginx may not work correctly"
    }
    
    Write-Info "Starting backend services..."
    
    # 创建部署脚本文件（使用 Unix 换行符）
    $deployScript = @'
#!/bin/bash
set -e
cd /opt/gulf-property

# Install Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    echo "✅ Docker installed"
fi

# Load Docker image
if [ -f /tmp/image.tar ]; then
    echo "Loading Docker image..."
    docker load < /tmp/image.tar
    rm -f /tmp/image.tar
    echo "✅ Image loaded"
fi

# Verify .env file
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file not found!"
    exit 1
fi
echo "✅ Environment file found"

# Pull nginx if needed
if grep -q "nginx:" docker-compose.yml 2>/dev/null; then
    echo "Pulling nginx image..."
    docker pull nginx:alpine
fi

# Start containers
echo "Starting containers..."
HOST_PORT=$(grep '^PORT=' .env | cut -d '=' -f 2 | tr -d '\r' || echo "3000")
echo "Detected PORT: $HOST_PORT"

docker compose down 2>/dev/null || true
docker compose up -d --force-recreate --pull never --no-build

# Wait for health check
echo "Verifying health..."
SUCCESS=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -s --max-time 2 "http://127.0.0.1:$HOST_PORT/health" | grep -q 'ok\|healthy' || \
       curl -s --max-time 2 "http://127.0.0.1/health" | grep -q 'ok\|healthy'; then
        echo "✅ Backend is UP"
        SUCCESS=1
        break
    fi
    echo "Waiting... (attempt $i/15)"
    sleep 3
done

if [ $SUCCESS -eq 0 ]; then
    echo "❌ Health check failed!"
    docker ps
    docker logs gulf-property-api --tail 100
    exit 1
fi

echo ""
echo "✅ Backend deployed successfully on this server"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
'@
    
    # 保存脚本到临时文件，使用 Unix 换行符（LF）
    $tempScript = [System.IO.Path]::GetTempFileName()
    # 移除 Windows 换行符并使用 Unix 换行符
    $unixScript = $deployScript -replace "`r`n", "`n" -replace "`r", "`n"
    [System.IO.File]::WriteAllText($tempScript, $unixScript, [System.Text.UTF8Encoding]::new($false))
    
    # 上传并执行脚本
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no $tempScript "root@${IP}:/tmp/deploy.sh"
    ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$IP "chmod +x /tmp/deploy.sh && /tmp/deploy.sh"
    Remove-Item $tempScript -Force -ErrorAction SilentlyContinue
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -ne 0) {
        Write-Error-Custom "Deployment failed on server $SERVER_NUM"
        exit 1
    }
    
    Write-Success "Server $SERVER_NUM deployed successfully"
}

# Cleanup
if (Test-Path $TEMP_TAR) {
    Remove-Item $TEMP_TAR
    Write-Info "Cleaned up temporary files"
}

# ============================================================================
# 7. Create Load Balancer
# ============================================================================

Write-Step "7/8 Creating Load Balancer..."

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

# Configure HTTP service
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

# ============================================================================
# 8. Verify Deployment
# ============================================================================

Write-Step "8/8 Verifying deployment..."

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
Write-Success "Gulf Property Backend Deployment Complete!"
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
Write-Host "  Health Check: http://$LB_IP/health" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Test the API: http://$LB_IP" -ForegroundColor White
Write-Host "  2. Configure DNS: Point your domain to $LB_IP" -ForegroundColor White
Write-Host "  3. Setup SSL: SSH to servers and run setup-ssl.sh (if available)" -ForegroundColor White
Write-Host "  4. Update frontend CORS_ORIGIN in .env.production" -ForegroundColor White
Write-Host ""
Write-Host "SSH Access:" -ForegroundColor Yellow
Write-Host "  ssh -i $SSH_KEY_PATH root@<server-ip>" -ForegroundColor White
Write-Host ""
Write-Host "Logs:" -ForegroundColor Yellow
Write-Host "  ssh -i $SSH_KEY_PATH root@<server-ip> 'docker logs gulf-property-api -f'" -ForegroundColor White
Write-Host ""
