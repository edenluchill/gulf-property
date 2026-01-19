# Check if project_payment_plans table exists in the database

Write-Host "Checking database tables..." -ForegroundColor Cyan

# Load environment variables
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)$') {
            $key = $matches[1]
            $value = $matches[2] -replace '^\s*"?(.*?)"?\s*$', '$1'
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

$DB_USER = $env:DB_USER
$DB_PASSWORD = $env:DB_PASSWORD
$DB_HOST = $env:DB_HOST
$DB_PORT = $env:DB_PORT
$DB_NAME = $env:DB_NAME

Write-Host "`nConnecting to database: $DB_NAME@${DB_HOST}:${DB_PORT}" -ForegroundColor Yellow

# Check if tables exist
$checkQuery = @"
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('residential_projects', 'project_unit_types', 'project_payment_plans')
ORDER BY table_name;
"@

Write-Host "`nExecuting query..." -ForegroundColor Yellow
$env:PGPASSWORD = $DB_PASSWORD
$result = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -A -c $checkQuery

Write-Host "`n=== EXISTING TABLES ===" -ForegroundColor Green
if ($result) {
    $result -split "`n" | ForEach-Object {
        if ($_.Trim()) {
            Write-Host "  [OK] $_" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  [ERROR] No tables found!" -ForegroundColor Red
}

# Check for payment plans specifically
Write-Host "`n=== CHECKING project_payment_plans TABLE ===" -ForegroundColor Cyan
$checkPaymentPlans = "SELECT COUNT(*) FROM project_payment_plans;"

try {
    $count = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -A -c $checkPaymentPlans 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Table exists! Current rows: $count" -ForegroundColor Green
    } else {
        Write-Host "  [ERROR] Table does not exist!" -ForegroundColor Red
        Write-Host "`nTo create the table, run:" -ForegroundColor Yellow
        Write-Host "  psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d ${DB_NAME} -f src/db/residential-projects-schema.sql" -ForegroundColor White
    }
} catch {
    Write-Host "  [ERROR] Error checking table: $_" -ForegroundColor Red
}

Write-Host "`nDone!" -ForegroundColor Green
