# ============================================================================
# Run Unit Description Migration
# Adds the description column to project_unit_types table
# ============================================================================

Write-Host "🔧 Running unit description migration..." -ForegroundColor Cyan

# Load environment variables
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*?)\s*$') {
            $name = $matches[1]
            $value = $matches[2]
            Set-Item -Path "env:$name" -Value $value
        }
    }
    Write-Host "✅ Loaded .env file" -ForegroundColor Green
} else {
    Write-Host "⚠️  No .env file found, using system environment variables" -ForegroundColor Yellow
}

# Get database connection string
$DB_HOST = $env:DB_HOST
$DB_PORT = $env:DB_PORT
$DB_NAME = $env:DB_NAME
$DB_USER = $env:DB_USER
$DB_PASSWORD = $env:DB_PASSWORD

if (-not $DB_HOST -or -not $DB_NAME -or -not $DB_USER) {
    Write-Host "❌ Missing required database environment variables" -ForegroundColor Red
    Write-Host "   Required: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD" -ForegroundColor Red
    exit 1
}

# Connection string
$PGPASSWORD = $DB_PASSWORD
$env:PGPASSWORD = $PGPASSWORD

Write-Host "📊 Connecting to database: $DB_NAME@$DB_HOST" -ForegroundColor Cyan

# Run migration
$migrationFile = "db/migrations/add-unit-description-column.sql"

if (Test-Path $migrationFile) {
    Write-Host "📝 Running migration: $migrationFile" -ForegroundColor Cyan
    
    & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $migrationFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} else {
    Write-Host "❌ Migration file not found: $migrationFile" -ForegroundColor Red
    exit 1
}

# Verify the column was added
Write-Host "`n🔍 Verifying column exists..." -ForegroundColor Cyan
$verifyQuery = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'project_unit_types' AND column_name = 'description';"
& psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c $verifyQuery

Write-Host "`n✨ Done!" -ForegroundColor Green
