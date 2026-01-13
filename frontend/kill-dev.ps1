# Kill all processes using ports 5173 and 5174 (Vite dev servers)

Write-Host "Searching for processes using ports 5173 and 5174..." -ForegroundColor Yellow

$ports = @(5173, 5174)
$killed = $false

foreach ($port in $ports) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        
        foreach ($conn in $connections) {
            $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "Found process: $($process.Name) (PID: $($process.Id)) on port $port" -ForegroundColor Cyan
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                Write-Host "Killed process $($process.Id)" -ForegroundColor Green
                $killed = $true
            }
        }
    } catch {
        # Port not in use, continue
    }
}

if (-not $killed) {
    Write-Host "No processes found on ports 5173 or 5174" -ForegroundColor Gray
} else {
    Write-Host "All dev server processes have been terminated." -ForegroundColor Green
}
