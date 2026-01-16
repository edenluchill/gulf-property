#Requires -Version 5.1
# Update database with new Residential Projects schema

$ErrorActionPreference = "Stop"

function Write-Info { param([string]$msg) Write-Host "[INFO] $msg" -ForegroundColor Blue }
function Write-Success { param([string]$msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Fail { param([string]$msg) Write-Host "[FAIL] $msg" -ForegroundColor Red }
function Write-Step { param([string]$msg) Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }

# Detect Database Configuration
Write-Step "Detecting database configuration..."

$DB_HOST = ""
$DB_PORT = "5432"
$DB_NAME = ""
$DB_USER = ""
$DB_PASSWORD = ""

# Try backend\.env.database first (Hetzner deployment)
if (Test-Path "backend\.env.database") {
    Write-Info "Found Hetzner database config"
    Get-Content "backend\.env.database" | ForEach-Object {
        if ($_ -match "^DB_HOST=(.+)$") { $DB_HOST = $matches[1].Trim() }
        if ($_ -match "^DB_PORT=(.+)$") { $DB_PORT = $matches[1].Trim() }
        if ($_ -match "^DB_NAME=(.+)$") { $DB_NAME = $matches[1].Trim() }
        if ($_ -match "^DB_USER=(.+)$") { $DB_USER = $matches[1].Trim() }
        if ($_ -match "^DB_PASSWORD=(.+)$") { $DB_PASSWORD = $matches[1].Trim() }
    }
}
# Try backend\.env (local development)
elseif (Test-Path "backend\.env") {
    Write-Info "Found local database config"
    Get-Content "backend\.env" | ForEach-Object {
        if ($_ -match "^DB_HOST=(.+)$") { $DB_HOST = $matches[1].Trim() }
        if ($_ -match "^DB_PORT=(.+)$") { $DB_PORT = $matches[1].Trim() }
        if ($_ -match "^DB_NAME=(.+)$") { $DB_NAME = $matches[1].Trim() }
        if ($_ -match "^DB_USER=(.+)$") { $DB_USER = $matches[1].Trim() }
        if ($_ -match "^DB_PASSWORD=(.+)$") { $DB_PASSWORD = $matches[1].Trim() }
    }
}
else {
    Write-Fail "No database config found!"
    Write-Host "Please create backend\.env or backend\.env.database"
    exit 1
}

if (-not $DB_HOST -or -not $DB_NAME -or -not $DB_USER -or -not $DB_PASSWORD) {
    Write-Fail "Incomplete database configuration"
    exit 1
}

Write-Success "Database: $DB_NAME @ $DB_HOST"

# Check schema file
$SCHEMA_PATH = "backend\src\db\residential-projects-schema.sql"
if (-not (Test-Path $SCHEMA_PATH)) {
    Write-Fail "Schema not found: $SCHEMA_PATH"
    exit 1
}
Write-Success "Schema file found"

# Test Connection
Write-Step "Testing database connection..."

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Fail "psql not found"
    Write-Host "Install PostgreSQL client from: https://www.postgresql.org/download/windows/"
    exit 1
}

$env:PGPASSWORD = $DB_PASSWORD
$testResult = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT version();" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Fail "Database connection failed"
    Write-Host "Error: $testResult"
    exit 1
}

Write-Success "Connection successful"

# Check Existing Tables
Write-Step "Checking existing tables..."

$tableExists = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='residential_projects');" 2>&1 | Out-String
$tableExists = $tableExists.Trim()

if ($tableExists -eq "t") {
    Write-Host ""
    Write-Host "WARNING: Table 'residential_projects' already exists!" -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "Do you want to REPLACE the schema? This will DROP existing tables! (yes/no)"
    
    if ($confirm -ne "yes") {
        Write-Info "Update cancelled"
        exit 0
    }
    
    Write-Host "Dropping existing tables..." -ForegroundColor Yellow
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "DROP TABLE IF EXISTS project_payment_plans CASCADE; DROP TABLE IF EXISTS project_unit_types CASCADE; DROP TABLE IF EXISTS residential_projects CASCADE;" 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Old tables dropped"
    } else {
        Write-Fail "Failed to drop tables"
        exit 1
    }
} else {
    Write-Success "No conflicts found"
}

# Import Schema
Write-Step "Importing Residential Projects schema..."

Write-Info "Executing SQL script..."
$ErrorActionPreference = "Continue"
$importResult = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $SCHEMA_PATH 2>&1 | Out-String
$exitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"

if ($exitCode -ne 0) {
    Write-Fail "Schema import failed"
    Write-Host "Error details:" -ForegroundColor Red
    Write-Host $importResult
    exit 1
}

Write-Success "Schema imported successfully"

# Verify Tables
Write-Step "Verifying new tables..."

Write-Host ""
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT table_name, (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count FROM information_schema.tables t WHERE table_schema = 'public' AND table_name IN ('residential_projects', 'project_unit_types', 'project_payment_plans') ORDER BY table_name;"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Success "All tables created successfully!"
} else {
    Write-Fail "Verification failed"
    exit 1
}

# Summary
Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Schema Update Complete!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "New Tables Created:" -ForegroundColor Cyan
Write-Host "  residential_projects" -ForegroundColor Green
Write-Host "  project_unit_types" -ForegroundColor Green
Write-Host "  project_payment_plans" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Restart backend: cd backend; npm run dev"
Write-Host "  2. Test upload: http://localhost:5173/developer/upload-v2"
Write-Host "  3. Check database: .\manage-database.ps1 -Action psql"
Write-Host ""

$env:PGPASSWORD = $null
