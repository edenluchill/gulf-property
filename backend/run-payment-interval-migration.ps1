# ============================================================================
# Run Payment Interval Migration
# ============================================================================
# This script applies the add-payment-interval-fields.sql migration to the database

param(
    [string]$EnvFile = ".env"
)

Write-Host "🔧 Running Payment Interval Migration..." -ForegroundColor Cyan

# Load environment variables
if (Test-Path $EnvFile) {
    Write-Host "📝 Loading environment from $EnvFile" -ForegroundColor Green
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($key, $value)
        }
    }
} else {
    Write-Host "❌ Error: $EnvFile not found" -ForegroundColor Red
    exit 1
}

# Get database connection details
$DB_HOST = $env:DB_HOST
$DB_PORT = $env:DB_PORT
$DB_NAME = $env:DB_NAME
$DB_USER = $env:DB_USER
$DB_PASSWORD = $env:DB_PASSWORD

if (-not $DB_HOST -or -not $DB_NAME -or -not $DB_USER -or -not $DB_PASSWORD) {
    Write-Host "❌ Error: Missing required database environment variables" -ForegroundColor Red
    Write-Host "   Required: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD" -ForegroundColor Yellow
    exit 1
}

Write-Host "🔗 Database: $DB_USER@$DB_HOST/$DB_NAME" -ForegroundColor Cyan

# Build PostgreSQL connection URL
$dbUrl = "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Migration file
$migrationScript = "db/migrations/add-payment-interval-fields.sql"

if (-not (Test-Path $migrationScript)) {
    Write-Host "❌ Error: Migration file not found: $migrationScript" -ForegroundColor Red
    exit 1
}

Write-Host "📄 Migration file: $migrationScript" -ForegroundColor Cyan

# Check if psql is available
try {
    $null = Get-Command psql -ErrorAction Stop
    Write-Host "✅ psql found" -ForegroundColor Green
    
    Write-Host "`n🚀 Applying migration..." -ForegroundColor Cyan
    psql $dbUrl -f $migrationScript
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Migration completed successfully!" -ForegroundColor Green
        Write-Host "   The interval_months and interval_description columns have been added." -ForegroundColor Green
    } else {
        Write-Host "`n❌ Migration failed!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ psql is not installed or not in PATH" -ForegroundColor Red
    Write-Host "`n📋 Alternative: Run migration via Docker container" -ForegroundColor Yellow
    Write-Host "   Copy and run this command:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   docker exec -i gulf-property-api psql `"$dbUrl`" < $migrationScript" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Or connect to PostgreSQL and run:" -ForegroundColor Yellow
    Write-Host "   ALTER TABLE project_payment_plans ADD COLUMN IF NOT EXISTS interval_months INTEGER;" -ForegroundColor Cyan
    Write-Host "   ALTER TABLE project_payment_plans ADD COLUMN IF NOT EXISTS interval_description TEXT;" -ForegroundColor Cyan
}
