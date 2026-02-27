#Requires -Version 5.1

<#
.SYNOPSIS
    Deploy Pinzos PDF Worker to Hetzner Cloud

.DESCRIPTION
    Deploys the PDF processing worker to a dedicated server.
    Worker polls database for pending jobs and processes PDFs.

.EXAMPLE
    .\deploy.ps1
#>

# Configuration
$ErrorActionPreference = "Stop"
$PROJECT_NAME = "Pinzos"
$WORKER_NAME = "Pinzos-worker"
$LOCATION = "nbg1"
$SERVER_TYPE = "cpx32"  # 4 vCPU, 8GB RAM for PDF processing

# GitHub Container Registry
$GITHUB_USERNAME = "edenluchill"
$GHCR_IMAGE = "ghcr.io/$GITHUB_USERNAME/pinzos-worker"

# SSH Key (same as main server)
$SSH_KEY_NAME = "$PROJECT_NAME-key"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\${PROJECT_NAME}_ed25519"

# Paths
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND_DIR = Join-Path $SCRIPT_DIR "..\backend"
$ENV_FILE = Join-Path $BACKEND_DIR ".env.production"

# Color output functions
function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Blue }
function Write-Success { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warning { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Error-Custom { param([string]$Message) Write-Host "[FAIL] $Message" -ForegroundColor Red }
function Write-Step { param([string]$Message) Write-Host "[STEP] $Message" -ForegroundColor Cyan }

# Switch to Hetzner project
Write-Step "Checking Hetzner context..."
$ErrorActionPreference = "Continue"
hcloud context use pinzos 2>$null
$ErrorActionPreference = "Stop"
if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Hetzner context 'pinzos' not found"
    exit 1
}
Write-Success "Using Hetzner context: pinzos"

# Check prerequisites
Write-Step "Checking prerequisites..."

if (-not $env:GITHUB_TOKEN) {
    Write-Error-Custom "GITHUB_TOKEN not set"
    Write-Host "Run: `$env:GITHUB_TOKEN = 'your_token'" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $ENV_FILE)) {
    Write-Error-Custom ".env.production not found at: $ENV_FILE"
    exit 1
}

Write-Success "Prerequisites OK"

# ============================================================================
# Build and Push Worker Image
# ============================================================================

Write-Step "1/4 Building worker image..."

$IMAGE_TAG = Get-Date -Format "yyyyMMdd-HHmmss"

# Build from worker directory
Push-Location $SCRIPT_DIR
docker build `
    --build-arg NODE_ENV=production `
    -t "${GHCR_IMAGE}:${IMAGE_TAG}" `
    -t "${GHCR_IMAGE}:latest" `
    -f Dockerfile .

if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Error-Custom "Docker build failed"
    exit 1
}
Pop-Location

Write-Success "Worker image built"

Write-Info "Pushing to GHCR..."
$env:GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin 2>&1 | Out-Null
docker push "${GHCR_IMAGE}:${IMAGE_TAG}"
docker push "${GHCR_IMAGE}:latest"

Write-Success "Image pushed: ${GHCR_IMAGE}:latest"

# ============================================================================
# Create Worker Server
# ============================================================================

Write-Step "2/4 Creating worker server..."

$SERVER_NAME = "$WORKER_NAME-1"

$ErrorActionPreference = "Continue"
$serverExists = hcloud server describe $SERVER_NAME 2>$null
$ErrorActionPreference = "Stop"

if ($LASTEXITCODE -eq 0) {
    Write-Warning "Server exists: $SERVER_NAME"
    $serverInfo = hcloud server describe $SERVER_NAME -o json | ConvertFrom-Json
    $WORKER_IP = $serverInfo.public_net.ipv4.ip
} else {
    Write-Info "Creating server: $SERVER_NAME"

    $serverJson = hcloud server create `
        --name $SERVER_NAME `
        --type $SERVER_TYPE `
        --location $LOCATION `
        --image ubuntu-22.04 `
        --ssh-key $SSH_KEY_NAME `
        --label "app=$PROJECT_NAME" `
        --label "role=worker" `
        -o json

    if ($LASTEXITCODE -ne 0) {
        Write-Error-Custom "Failed to create server"
        exit 1
    }

    $serverInfo = $serverJson | ConvertFrom-Json
    Write-Info "Waiting for server..."
    Start-Sleep -Seconds 30

    $serverInfo = hcloud server describe $SERVER_NAME -o json | ConvertFrom-Json
    $WORKER_IP = $serverInfo.public_net.ipv4.ip
    Write-Success "Server created: $WORKER_IP"
}

# ============================================================================
# Deploy Worker
# ============================================================================

Write-Step "3/4 Deploying worker..."

Write-Info "Waiting for SSH..."
$retries = 0
while ($retries -lt 30) {
    $retries++
    $ErrorActionPreference = "Continue"
    $sshResult = ssh -n -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o LogLevel=ERROR root@$WORKER_IP "echo connected" 2>&1
    $ErrorActionPreference = "Stop"

    if ($sshResult -match "connected") {
        Write-Success "SSH ready"
        break
    }
    Write-Host "  Attempt $retries/30..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
}

Write-Info "Uploading files..."
$ErrorActionPreference = "Continue"

ssh -n -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@$WORKER_IP "mkdir -p /opt/pinzos-worker" 2>&1 | Out-Null

scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR `
    $ENV_FILE "root@${WORKER_IP}:/opt/pinzos-worker/.env" 2>&1 | Out-Null

# Use docker-compose from worker directory
$COMPOSE_FILE = Join-Path $SCRIPT_DIR "docker-compose.yml"
scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR `
    $COMPOSE_FILE "root@${WORKER_IP}:/opt/pinzos-worker/docker-compose.yml" 2>&1 | Out-Null

$ErrorActionPreference = "Stop"

Write-Info "Starting worker..."

$ghcrToken = $env:GITHUB_TOKEN

$deployScript = @"
#!/bin/bash
set -e
cd /opt/pinzos-worker

# Install Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

# Pull worker image
echo "Pulling worker image..."
echo "$ghcrToken" | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
docker pull ${GHCR_IMAGE}:latest

# Start worker
echo "Starting worker..."
docker compose down 2>/dev/null || true
docker compose up -d

# Show status
echo ""
echo "Worker started:"
docker ps --format "table {{.Names}}\t{{.Status}}"
"@

$tempScript = [System.IO.Path]::GetTempFileName()
$unixScript = $deployScript -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($tempScript, $unixScript, [System.Text.UTF8Encoding]::new($false))

$ErrorActionPreference = "Continue"
scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR $tempScript "root@${WORKER_IP}:/tmp/deploy.sh" 2>&1 | Out-Null
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR root@$WORKER_IP "chmod +x /tmp/deploy.sh && /tmp/deploy.sh"
$ErrorActionPreference = "Stop"
Remove-Item $tempScript -Force -ErrorAction SilentlyContinue

Write-Success "Worker deployed"

# ============================================================================
# Summary
# ============================================================================

Write-Step "4/4 Deployment complete!"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Success "Pinzos Worker Deployed!"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Worker Server: $WORKER_IP" -ForegroundColor White
Write-Host ""
Write-Host "Check logs:" -ForegroundColor Yellow
Write-Host "  ssh -i $SSH_KEY_PATH root@$WORKER_IP 'docker logs pinzos-worker -f'" -ForegroundColor Gray
Write-Host ""
Write-Host "IMPORTANT: Make sure main API has USE_WORKER_MODE=true in .env" -ForegroundColor Yellow
Write-Host ""
