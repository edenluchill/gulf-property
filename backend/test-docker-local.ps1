# Test Docker Setup Locally
# This script builds and runs the backend in Docker to test PDF to Image functionality

param(
    [switch]$Build = $false,
    [switch]$Clean = $false
)

$ErrorActionPreference = "Stop"

Write-Host "[DOCKER] Testing Gulf Property Backend" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "[WARN] No .env file found. Creating from template..." -ForegroundColor Yellow
    if (Test-Path "env.template") {
        Copy-Item "env.template" ".env"
        Write-Host "[OK] Created .env file. Please edit it with your API keys." -ForegroundColor Green
        Write-Host ""
        Write-Host "Required:" -ForegroundColor Yellow
        Write-Host "  - GEMINI_API_KEY" -ForegroundColor Yellow
        Write-Host "  - DB credentials" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter after editing .env"
    } else {
        Write-Host "[FAIL] env.template not found!" -ForegroundColor Red
        exit 1
    }
}

# Clean up if requested
if ($Clean) {
    Write-Host "[INFO] Cleaning up..." -ForegroundColor Yellow
    docker-compose down -v
    docker rmi gulf-property-api -f 2>$null
    Write-Host "[OK] Cleanup complete" -ForegroundColor Green
    Write-Host ""
}

# Build if requested or if image doesn't exist
$imageExists = docker images -q gulf-property-api
if ($Build -or -not $imageExists) {
    Write-Host "[INFO] Building Docker image..." -ForegroundColor Yellow
    Write-Host ""
    
    docker-compose build --no-cache
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Docker build failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "[OK] Docker image built successfully" -ForegroundColor Green
    Write-Host ""
}

# Start services
Write-Host "[INFO] Starting services..." -ForegroundColor Yellow
docker-compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Failed to start services!" -ForegroundColor Red
    exit 1
}

# Wait for services to be ready
Write-Host ""
Write-Host "[INFO] Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Check database
Write-Host ""
Write-Host "[CHECK] PostgreSQL..." -ForegroundColor Cyan
docker-compose exec -T postgres pg_isready -U postgres
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Database is ready" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Database not ready" -ForegroundColor Red
}

# Check API
Write-Host ""
Write-Host "[CHECK] API..." -ForegroundColor Cyan
$retries = 0
$maxRetries = 10
$apiReady = $false

while ($retries -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host "[OK] API is ready!" -ForegroundColor Green
            $apiReady = $true
            break
        }
    } catch {
        $retries++
        if ($retries -lt $maxRetries) {
            Write-Host "   Waiting... (attempt $retries/$maxRetries)" -ForegroundColor Gray
            Start-Sleep -Seconds 3
        }
    }
}

if (-not $apiReady) {
    Write-Host "[FAIL] API failed to start" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checking logs..." -ForegroundColor Yellow
    docker-compose logs --tail=50 api
    exit 1
}

# Test canvas availability
Write-Host ""
Write-Host "[TEST] Canvas/PDF conversion..." -ForegroundColor Cyan
$canvasTest = 'try { require(\"pdf-img-convert\"); console.log(\"OK\"); } catch(e) { console.error(\"FAILED:\", e.message); process.exit(1); }'
docker-compose exec -T api node -e $canvasTest

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Canvas and PDF conversion working!" -ForegroundColor Green
} else {
    Write-Host "[WARN] Canvas may have issues" -ForegroundColor Yellow
}

# Show status
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Docker Environment Ready!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan
Write-Host "  API:      http://localhost:3000" -ForegroundColor White
Write-Host "  Health:   http://localhost:3000/health" -ForegroundColor White
Write-Host "  Database: localhost:5432" -ForegroundColor White
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  View logs:    docker-compose logs -f api" -ForegroundColor White
Write-Host "  Stop:         docker-compose down" -ForegroundColor White
Write-Host "  Restart:      docker-compose restart api" -ForegroundColor White
Write-Host "  Shell:        docker-compose exec api sh" -ForegroundColor White
Write-Host ""
Write-Host "[ACTION] Now upload a PDF through frontend to test image extraction!" -ForegroundColor Yellow
Write-Host "         Frontend should connect to: http://localhost:3000" -ForegroundColor Gray
Write-Host ""
