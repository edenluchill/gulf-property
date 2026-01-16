#!/usr/bin/env pwsh
# PowerShell wrapper for R2 temp files cleanup script
# Usage: ./cleanup-r2-temp-files.ps1

Write-Host "🧹 Gulf Property - R2 Temp Files Cleanup" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ Error: .env file not found" -ForegroundColor Red
    Write-Host "Copy env.template to .env and configure R2 credentials" -ForegroundColor Yellow
    exit 1
}

# Run cleanup script
Write-Host "Running cleanup script..." -ForegroundColor Green
Write-Host ""

npx ts-node cleanup-r2-temp-files.ts

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Cleanup completed successfully" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Cleanup failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
