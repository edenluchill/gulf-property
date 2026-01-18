# ============================================================================
# PowerShell script to migrate construction_progress column
# ============================================================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Construction Progress Migration Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables from .env
if (Test-Path ".env") {
    Write-Host "Loading .env file..." -ForegroundColor Yellow
    Get-Content .env | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
} else {
    Write-Host "Warning: .env file not found!" -ForegroundColor Red
    Write-Host "Please ensure DATABASE_URL is set in your environment" -ForegroundColor Yellow
    Write-Host ""
}

# Get database URL
$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) {
    Write-Host "Error: DATABASE_URL not found in environment!" -ForegroundColor Red
    exit 1
}

Write-Host "Database URL found" -ForegroundColor Green
Write-Host ""

# Confirm migration
Write-Host "This will migrate the construction_progress column from VARCHAR to NUMERIC" -ForegroundColor Yellow
Write-Host ""
Write-Host "The migration will:" -ForegroundColor White
Write-Host "  1. Create a temporary numeric column" -ForegroundColor Gray
Write-Host "  2. Convert existing string values to numbers" -ForegroundColor Gray
Write-Host "  3. Replace the old column with the new one" -ForegroundColor Gray
Write-Host "  4. Add validation constraints" -ForegroundColor Gray
Write-Host ""

$confirm = Read-Host "Do you want to proceed? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Migration cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Starting migration..." -ForegroundColor Cyan

# Check if running locally or in production
if ($dbUrl -match "localhost" -or $dbUrl -match "127.0.0.1") {
    Write-Host "Detected LOCAL database" -ForegroundColor Yellow
    
    # Use psql for local database
    $migrationScript = Join-Path $PSScriptRoot "db\migrations\migrate-construction-progress-to-numeric.sql"
    
    if (-not (Test-Path $migrationScript)) {
        Write-Host "Error: Migration script not found at $migrationScript" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Executing migration script..." -ForegroundColor Yellow
    psql $dbUrl -f $migrationScript
    
} else {
    Write-Host "Detected REMOTE database" -ForegroundColor Yellow
    
    # For remote database, use psql with connection string
    $migrationScript = Join-Path $PSScriptRoot "db\migrations\migrate-construction-progress-to-numeric.sql"
    
    if (-not (Test-Path $migrationScript)) {
        Write-Host "Error: Migration script not found at $migrationScript" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Executing migration script on remote database..." -ForegroundColor Yellow
    psql $dbUrl -f $migrationScript
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "Migration completed successfully!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Verify the data looks correct" -ForegroundColor Gray
    Write-Host "  2. Test your application" -ForegroundColor Gray
    Write-Host "  3. Deploy updated code to production" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "Migration failed!" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check the error messages above" -ForegroundColor Yellow
    Write-Host "The migration is wrapped in a transaction, so no changes were made" -ForegroundColor Yellow
    exit 1
}
