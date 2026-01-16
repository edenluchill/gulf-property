#Requires -Version 5.1
<#
.SYNOPSIS
    Add Dubai Areas and Landmarks to database

.DESCRIPTION
    Runs the dubai-areas-landmarks.sql script to create and populate
    dubai_areas and dubai_landmarks tables with sample data.

.EXAMPLE
    .\update-dubai-schema.ps1
    
.NOTES
    Version: 1.0
    Requires: PostgreSQL database already running
#>

$ErrorActionPreference = "Stop"

# ============================================================================
# Configuration
# ============================================================================

$SCHEMA_FILE = "src\db\dubai-areas-landmarks.sql"

Write-Host "`n===========================================================================" -ForegroundColor Cyan
Write-Host "        Dubai Areas & Landmarks Database Schema Update" -ForegroundColor Green
Write-Host "==========================================================================`n" -ForegroundColor Cyan

# ============================================================================
# Check Prerequisites
# ============================================================================

Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

# Check if schema file exists
if (-not (Test-Path $SCHEMA_FILE)) {
    Write-Host "  ERROR: Schema file not found: $SCHEMA_FILE" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Schema file found" -ForegroundColor Green

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "  ERROR: .env file not found in backend directory" -ForegroundColor Red
    Write-Host "  Please create .env with database credentials" -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ .env file found" -ForegroundColor Green

# ============================================================================
# Load Environment Variables
# ============================================================================

Write-Host "`n[2/4] Loading database credentials..." -ForegroundColor Yellow

$envContent = Get-Content ".env" -ErrorAction Stop
$dbVars = @{}

foreach ($line in $envContent) {
    if ($line -match '^([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        $dbVars[$key] = $value
    }
}

$DB_HOST = $dbVars['DB_HOST']
$DB_PORT = $dbVars['DB_PORT']
$DB_NAME = $dbVars['DB_NAME']
$DB_USER = $dbVars['DB_USER']
$DB_PASSWORD = $dbVars['DB_PASSWORD']

if (-not $DB_HOST -or -not $DB_NAME -or -not $DB_USER -or -not $DB_PASSWORD) {
    Write-Host "  ERROR: Missing database credentials in .env" -ForegroundColor Red
    Write-Host "  Required: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD" -ForegroundColor Yellow
    exit 1
}

Write-Host "  ✓ Database: $DB_NAME @ $DB_HOST" -ForegroundColor Green

# ============================================================================
# Test Database Connection
# ============================================================================

Write-Host "`n[3/4] Testing database connection..." -ForegroundColor Yellow

$env:PGPASSWORD = $DB_PASSWORD
$testQuery = "SELECT 1;"

try {
    $result = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c $testQuery 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Connection failed"
    }
    Write-Host "  ✓ Database connection successful" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Cannot connect to database" -ForegroundColor Red
    Write-Host "  Make sure PostgreSQL is running and credentials are correct" -ForegroundColor Yellow
    exit 1
}

# ============================================================================
# Run Schema Update
# ============================================================================

Write-Host "`n[4/4] Applying schema updates..." -ForegroundColor Yellow
Write-Host "  - Creating dubai_areas table..." -ForegroundColor Gray
Write-Host "  - Creating dubai_landmarks table..." -ForegroundColor Gray
Write-Host "  - Creating indexes..." -ForegroundColor Gray
Write-Host "  - Inserting sample data (8 areas, 13 landmarks)..." -ForegroundColor Gray

try {
    $output = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $SCHEMA_FILE 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n  ERROR: Schema update failed" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        exit 1
    }
    
    Write-Host "  ✓ Schema updated successfully" -ForegroundColor Green
} catch {
    Write-Host "`n  ERROR: Failed to run schema file" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# ============================================================================
# Verify Installation
# ============================================================================

Write-Host "`n[✓] Verifying installation..." -ForegroundColor Yellow

# Check areas count
$areasCount = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM dubai_areas;" 2>&1 | ForEach-Object { $_.Trim() }
Write-Host "  - Dubai Areas: $areasCount" -ForegroundColor Cyan

# Check landmarks count
$landmarksCount = & psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM dubai_landmarks;" 2>&1 | ForEach-Object { $_.Trim() }
Write-Host "  - Dubai Landmarks: $landmarksCount" -ForegroundColor Cyan

# ============================================================================
# Complete
# ============================================================================

Write-Host "`n===========================================================================" -ForegroundColor Cyan
Write-Host "                    ✓ Update Complete!" -ForegroundColor Green
Write-Host "==========================================================================`n" -ForegroundColor Cyan

Write-Host "Sample Data Loaded:" -ForegroundColor Yellow
Write-Host "  • Downtown Dubai (Burj Khalifa, Dubai Mall)" -ForegroundColor White
Write-Host "  • Dubai Marina (Waterfront living)" -ForegroundColor White
Write-Host "  • Palm Jumeirah (Luxury island)" -ForegroundColor White
Write-Host "  • Business Bay (Business district)" -ForegroundColor White
Write-Host "  • JBR (Beach lifestyle)" -ForegroundColor White
Write-Host "  • Dubai Hills Estate (Family community)" -ForegroundColor White
Write-Host "  • + 13 Famous Landmarks" -ForegroundColor White

Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "  1. Restart your backend server" -ForegroundColor White
Write-Host "  2. Frontend will automatically fetch the new data" -ForegroundColor White
Write-Host "  3. Toggle 'Areas & Landmarks' button on the map" -ForegroundColor White

Write-Host "`nAPI Endpoints:" -ForegroundColor Yellow
Write-Host "  GET /api/dubai/areas - Fetch all areas" -ForegroundColor White
Write-Host "  GET /api/dubai/landmarks - Fetch all landmarks" -ForegroundColor White

Write-Host ""

# Clean up
$env:PGPASSWORD = $null
