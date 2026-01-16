# Simple Docker Test Script
# No emojis, pure ASCII

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Docker Canvas Test" -ForegroundColor Cyan  
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to backend directory
Push-Location (Join-Path $PSScriptRoot ".")

try {
    # Check if containers are running
    Write-Host "[1/5] Checking container status..." -ForegroundColor Yellow
    docker-compose ps
    
    Write-Host ""
    Write-Host "[2/5] Waiting for API to be ready..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    # Test canvas
    Write-Host ""
    Write-Host "[3/5] Testing pdf-img-convert..." -ForegroundColor Yellow
    $canvasCmd = 'require(\"pdf-img-convert\"); console.log(\"CANVAS_OK\")'
    docker-compose exec -T api node -e $canvasCmd
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Canvas is working!" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Canvas test failed" -ForegroundColor Yellow
    }
    
    # Check API health
    Write-Host ""
    Write-Host "[4/5] Testing API health..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host "[OK] API is healthy" -ForegroundColor Green
        }
    } catch {
        Write-Host "[WARN] API not responding yet" -ForegroundColor Yellow
    }
    
    # Show logs
    Write-Host ""
    Write-Host "[5/5] Recent API logs:" -ForegroundColor Yellow
    docker-compose logs --tail=20 api
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Ready to test! Upload PDF via frontend." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Useful commands:" -ForegroundColor Cyan
    Write-Host "  Logs:    docker-compose logs -f api" -ForegroundColor White
    Write-Host "  Stop:    docker-compose down" -ForegroundColor White
    Write-Host "  Restart: docker-compose restart api" -ForegroundColor White
    Write-Host ""
    
} finally {
    Pop-Location
}
