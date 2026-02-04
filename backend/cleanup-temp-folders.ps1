#!/usr/bin/env pwsh
# PowerShell wrapper for temp folders cleanup script
# Usage: ./cleanup-temp-folders.ps1

Write-Host "🧹 Pinzos - Temp Folders Cleanup" -ForegroundColor Cyan
Write-Host ""

# Run cleanup script
Write-Host "Running cleanup script..." -ForegroundColor Green
Write-Host ""

npx ts-node cleanup-temp-folders.ts

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Cleanup completed successfully" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Cleanup failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
