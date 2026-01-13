# Kill all processes using port 3000 (Backend server)

Write-Host "Searching for processes using port 3000..." -ForegroundColor Yellow

try {
    $connections = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
    
    if ($connections) {
        foreach ($conn in $connections) {
            $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "Found process: $($process.Name) (PID: $($process.Id)) on port 3000" -ForegroundColor Cyan
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                Write-Host "Killed process $($process.Id)" -ForegroundColor Green
            }
        }
        Write-Host "Backend server process has been terminated." -ForegroundColor Green
    } else {
        Write-Host "No processes found on port 3000" -ForegroundColor Gray
    }
} catch {
    Write-Host "No processes found on port 3000" -ForegroundColor Gray
}
