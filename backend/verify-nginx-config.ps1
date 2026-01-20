# Verify Nginx Configuration for Upload Optimization

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Nginx Configuration Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test if docker-compose is available
try {
    $dockerComposeVersion = docker-compose --version 2>$null
    Write-Host "✓ Docker Compose found: $dockerComposeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Docker Compose not found" -ForegroundColor Red
    Write-Host "Please ensure Docker Desktop is running" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "1. Testing Nginx configuration syntax..." -ForegroundColor White

try {
    $testResult = docker-compose exec -T nginx nginx -t 2>&1
    if ($testResult -match "successful") {
        Write-Host "✓ Nginx configuration syntax is valid" -ForegroundColor Green
    } else {
        Write-Host "✗ Nginx configuration has errors:" -ForegroundColor Red
        Write-Host $testResult -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Failed to test Nginx configuration" -ForegroundColor Red
    Write-Host "Make sure the nginx container is running:" -ForegroundColor Yellow
    Write-Host "  docker-compose ps" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "2. Checking upload optimization settings..." -ForegroundColor White
Write-Host ""

$configFile = "nginx.conf"
if (-not (Test-Path $configFile)) {
    Write-Host "✗ nginx.conf not found in current directory" -ForegroundColor Red
    exit 1
}

$configContent = Get-Content $configFile -Raw

$checksPassed = 0
$checksFailed = 0

Write-Host "Checking key settings:" -ForegroundColor White
Write-Host ""

# Check client_body_buffer_size
if ($configContent -match "client_body_buffer_size\s+128k") {
    Write-Host "✓ client_body_buffer_size: 128k" -ForegroundColor Green
    $checksPassed++
} else {
    Write-Host "⚠ client_body_buffer_size: not found or incorrect" -ForegroundColor Yellow
    $checksFailed++
}

# Check client_max_body_size
if ($configContent -match "client_max_body_size\s+500M") {
    Write-Host "✓ client_max_body_size: 500M" -ForegroundColor Green
    $checksPassed++
} else {
    Write-Host "⚠ client_max_body_size: not found or incorrect" -ForegroundColor Yellow
    $checksFailed++
}

# Check for optimized upload endpoint
if ($configContent -match "/api/langgraph-progress/start") {
    Write-Host "✓ Optimized upload endpoint configured" -ForegroundColor Green
    $checksPassed++
} else {
    Write-Host "⚠ Optimized upload endpoint: not found" -ForegroundColor Yellow
    $checksFailed++
}

# Check proxy_request_buffering off
if ($configContent -match "location /api/langgraph-progress/start[\s\S]*?proxy_request_buffering off") {
    Write-Host "✓ proxy_request_buffering: off" -ForegroundColor Green
    $checksPassed++
} else {
    Write-Host "⚠ proxy_request_buffering: not disabled" -ForegroundColor Yellow
    $checksFailed++
}

# Check proxy_buffering off
if ($configContent -match "location /api/langgraph-progress/start[\s\S]*?proxy_buffering off") {
    Write-Host "✓ proxy_buffering: off" -ForegroundColor Green
    $checksPassed++
} else {
    Write-Host "⚠ proxy_buffering: not disabled" -ForegroundColor Yellow
    $checksFailed++
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $checksPassed" -ForegroundColor Green
Write-Host "Failed: $checksFailed" -ForegroundColor Yellow
Write-Host ""

if ($checksFailed -eq 0) {
    Write-Host "✓ All checks passed!" -ForegroundColor Green
    Write-Host "Your Nginx is configured correctly for upload optimization." -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Restart Nginx: docker-compose restart nginx" -ForegroundColor Gray
    Write-Host "2. Test upload at: https://gulf-property.com/developer/upload" -ForegroundColor Gray
    Write-Host "3. Check browser console for upload progress logs" -ForegroundColor Gray
    exit 0
} else {
    Write-Host "⚠ Some checks failed." -ForegroundColor Yellow
    Write-Host "Please review the configuration and make necessary changes." -ForegroundColor White
    Write-Host ""
    Write-Host "Expected settings in nginx.conf:" -ForegroundColor Cyan
    Write-Host "  - client_body_buffer_size 128k" -ForegroundColor Gray
    Write-Host "  - client_max_body_size 500M" -ForegroundColor Gray
    Write-Host "  - location /api/langgraph-progress/start with:" -ForegroundColor Gray
    Write-Host "    * proxy_request_buffering off" -ForegroundColor Gray
    Write-Host "    * proxy_buffering off" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To fix, run: git pull origin main" -ForegroundColor Yellow
    exit 1
}
