# Quick deploy: build + push BOTH images, restart BOTH servers. No infra reconcile.
#
# Usage:
#   cd backend
#   .\quick-deploy.ps1              # deploy API + worker
#   .\quick-deploy.ps1 -SkipWorker  # API only
#   .\quick-deploy.ps1 -SkipApi     # worker only
#
# Full infra deploy (creates servers/LB/firewall if missing): .\hetzner-deploy.ps1
#
# NOTE: do NOT set $ErrorActionPreference='Stop' here — docker writes progress
# to stderr and PS 5.1 wraps it into ErrorRecords, killing the script mid-run.

param(
    [switch]$SkipWorker,
    [switch]$SkipApi
)

$API_IP = "46.224.149.244"      # Pinzos-backend-1
$WORKER_IP = "159.69.107.109"   # Pinzos-worker-1
$SSH_KEY = "$env:USERPROFILE\.ssh\Pinzos_ed25519"
$SSH_OPTS = @("-i", $SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR")
$BACKEND_IMAGE = "ghcr.io/edenluchill/pinzos-backend"
$WORKER_IMAGE = "ghcr.io/edenluchill/pinzos-worker"
$TAG = Get-Date -Format "yyyyMMdd-HHmmss"

function Fail([string]$msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }
function Step([string]$msg) { Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }

if (-not $env:GITHUB_TOKEN) { Fail "GITHUB_TOKEN not set" }
$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Docker daemon not running (start Docker Desktop)" }

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ----------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------
if (-not $SkipApi) {
    Step "Building API image ($TAG)..."
    docker build -f Dockerfile.production -t "${BACKEND_IMAGE}:${TAG}" -t "${BACKEND_IMAGE}:latest" . 2>&1 | Select-String -Pattern 'ERROR|DONE|naming' | Select-Object -Last 3
    if ($LASTEXITCODE -ne 0) { Fail "API image build failed" }
    Ok "API image built"
}

if (-not $SkipWorker) {
    Step "Building worker image..."
    docker build -f Dockerfile.worker -t "${WORKER_IMAGE}:latest" . 2>&1 | Select-String -Pattern 'ERROR|DONE|naming' | Select-Object -Last 3
    if ($LASTEXITCODE -ne 0) { Fail "Worker image build failed" }
    Ok "Worker image built"
}

# ----------------------------------------------------------------------------
# Push
# ----------------------------------------------------------------------------
Step "Pushing to GHCR..."
docker login ghcr.io -u edenluchill -p $env:GITHUB_TOKEN 2>$null
if ($LASTEXITCODE -ne 0) { Fail "GHCR login failed" }
if (-not $SkipApi) {
    docker push "${BACKEND_IMAGE}:latest" | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0) { Fail "API image push failed" }
    docker push "${BACKEND_IMAGE}:${TAG}" | Select-Object -Last 1
}
if (-not $SkipWorker) {
    docker push "${WORKER_IMAGE}:latest" | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0) { Fail "Worker image push failed" }
}
Ok "Images pushed"

# ----------------------------------------------------------------------------
# Server-side GHCR login helper (token via ASCII temp file + cmd stdin
# redirect — PS 5.1 piping adds a UTF-8 BOM that corrupts the token)
# ----------------------------------------------------------------------------
function Login-Server([string]$ip) {
    $tmp = Join-Path $env:TEMP "ghcr-token.txt"
    [System.IO.File]::WriteAllText($tmp, $env:GITHUB_TOKEN, [System.Text.Encoding]::ASCII)
    $sshArgs = ($SSH_OPTS -join ' ')
    cmd /c "ssh $sshArgs root@$ip ""tr -d '\r' | docker login ghcr.io -u edenluchill --password-stdin"" < `"$tmp`"" | Out-Null
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

# ----------------------------------------------------------------------------
# Restart servers
# ----------------------------------------------------------------------------
if (-not $SkipApi) {
    Step "Updating API server ($API_IP)..."
    ssh @SSH_OPTS "root@$API_IP" "cd /opt/pinzos && docker pull ${BACKEND_IMAGE}:latest >/dev/null 2>&1 || exit 42; docker compose up -d --force-recreate --no-build 2>&1 | tail -2"
    if ($LASTEXITCODE -eq 42) {
        Write-Host "  GHCR login expired on API server, re-authenticating..." -ForegroundColor Yellow
        Login-Server $API_IP
        ssh @SSH_OPTS "root@$API_IP" "cd /opt/pinzos && docker pull ${BACKEND_IMAGE}:latest >/dev/null && docker compose up -d --force-recreate --no-build 2>&1 | tail -2"
    }
    if ($LASTEXITCODE -ne 0) { Fail "API server update failed" }
    Ok "API container restarted"
}

if (-not $SkipWorker) {
    Step "Updating worker server ($WORKER_IP)..."
    ssh @SSH_OPTS "root@$WORKER_IP" "cd /opt/pinzos-worker && docker compose pull -q >/dev/null 2>&1 || exit 42; docker compose up -d 2>&1 | tail -2"
    if ($LASTEXITCODE -eq 42) {
        Write-Host "  GHCR login expired on worker server, re-authenticating..." -ForegroundColor Yellow
        Login-Server $WORKER_IP
        ssh @SSH_OPTS "root@$WORKER_IP" "cd /opt/pinzos-worker && docker compose pull -q >/dev/null && docker compose up -d 2>&1 | tail -2"
    }
    if ($LASTEXITCODE -ne 0) { Fail "Worker server update failed" }
    Ok "Worker container restarted"
}

# ----------------------------------------------------------------------------
# Health checks
# ----------------------------------------------------------------------------
Step "Verifying health..."
if (-not $SkipApi) {
    # Container healthcheck start-period is 40s and the LB needs a probe cycle
    # to mark the instance healthy again — retry up to ~2 min
    $healthy = $false
    foreach ($attempt in 1..12) {
        Start-Sleep -Seconds 10
        try {
            $health = Invoke-WebRequest -Uri "https://api.pinzos.com/health" -UseBasicParsing -TimeoutSec 10
            if ($health.StatusCode -eq 200) { $healthy = $true; break }
        } catch {
            Write-Host "  waiting for API health... (attempt $attempt/12)" -ForegroundColor Gray
        }
    }
    if ($healthy) { Ok "API healthy: https://api.pinzos.com/health" }
    else { Fail "API not healthy after 2 min (check: ssh root@$API_IP 'docker logs pinzos-api')" }
}
if (-not $SkipWorker) {
    $status = ssh @SSH_OPTS "root@$WORKER_IP" "sleep 5; docker ps --filter name=pinzos-worker --format '{{.Status}}'"
    if ($status -match 'Up') { Ok "Worker running: $status" }
    else { Fail "Worker not running: $status (check: docker logs pinzos-worker)" }
}

$sw.Stop()
Write-Host "`n[DONE] Quick deploy complete in $([math]::Round($sw.Elapsed.TotalMinutes,1)) min (tag: $TAG)" -ForegroundColor Green
