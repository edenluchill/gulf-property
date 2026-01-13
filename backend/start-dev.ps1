# Smart Dev Server Starter
# Automatically kills process on port 3000 before starting

$PORT = 3000

Write-Host ""
Write-Host "Checking port $PORT..." -ForegroundColor Cyan

# Find process using port 3000
$process = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1

if ($process) {
    Write-Host "Port $PORT is in use by process $process" -ForegroundColor Yellow
    Write-Host "Killing process $process..." -ForegroundColor Yellow
    
    Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    Write-Host "Process killed" -ForegroundColor Green
    Start-Sleep -Seconds 1
}
else {
    Write-Host "Port $PORT is available" -ForegroundColor Green
}

Write-Host ""
Write-Host "Starting development server..." -ForegroundColor Cyan
Write-Host ""

# Start dev server directly
& npx ts-node-dev --respawn --transpile-only src/index.ts
