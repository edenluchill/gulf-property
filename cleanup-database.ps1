#Requires -Version 5.1
<#
.SYNOPSIS
    Clean up Hetzner database infrastructure

.DESCRIPTION
    Removes all database-related resources from Hetzner Cloud
    
.EXAMPLE
    .\cleanup-database.ps1
#>

$ErrorActionPreference = "Stop"
$PROJECT_NAME = "gulf-property"

Write-Host "⚠️  WARNING: This will delete ALL database infrastructure!" -ForegroundColor Yellow
Write-Host ""
Write-Host "Resources to be deleted:" -ForegroundColor Yellow
Write-Host "  - Server: $PROJECT_NAME-db" -ForegroundColor White
Write-Host "  - Firewall: $PROJECT_NAME-db-firewall" -ForegroundColor White
Write-Host "  - Network: $PROJECT_NAME-db-network" -ForegroundColor White
Write-Host "  - SSH Key: $PROJECT_NAME-db-key" -ForegroundColor White
Write-Host ""
$confirm = Read-Host "Type 'DELETE' to confirm"

if ($confirm -ne "DELETE") {
    Write-Host "Cancelled" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Deleting resources..." -ForegroundColor Red

# Delete server
if (hcloud server describe "$PROJECT_NAME-db" 2>$null) {
    Write-Host "Deleting server..." -ForegroundColor Yellow
    hcloud server delete "$PROJECT_NAME-db" 2>$null | Out-Null
    Write-Host "✓ Server deleted" -ForegroundColor Green
}

# Delete firewall
if (hcloud firewall describe "$PROJECT_NAME-db-firewall" 2>$null) {
    Write-Host "Deleting firewall..." -ForegroundColor Yellow
    hcloud firewall delete "$PROJECT_NAME-db-firewall" 2>$null | Out-Null
    Write-Host "✓ Firewall deleted" -ForegroundColor Green
}

# Delete network
if (hcloud network describe "$PROJECT_NAME-db-network" 2>$null) {
    Write-Host "Deleting network..." -ForegroundColor Yellow
    hcloud network delete "$PROJECT_NAME-db-network" 2>$null | Out-Null
    Write-Host "✓ Network deleted" -ForegroundColor Green
}

# Delete SSH key
if (hcloud ssh-key describe "$PROJECT_NAME-db-key" 2>$null) {
    Write-Host "Deleting SSH key..." -ForegroundColor Yellow
    hcloud ssh-key delete "$PROJECT_NAME-db-key" 2>$null | Out-Null
    Write-Host "✓ SSH key deleted" -ForegroundColor Green
}

Write-Host ""
Write-Host "✓ All resources deleted!" -ForegroundColor Green
Write-Host ""
