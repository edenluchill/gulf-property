#Requires -Version 5.1
<#
.SYNOPSIS
    Test database connection and show statistics

.DESCRIPTION
    Quick script to test database connection and show data statistics
    
.EXAMPLE
    .\test-database.ps1
#>

$ErrorActionPreference = "Stop"

$DB_HOST = "49.13.227.73"
$DB_PORT = "5432"
$DB_NAME = "gulf_property"
$DB_USER = "gulf_admin"
$DB_PASSWORD = "aB246`$29"

Write-Host "🔌 Testing Gulf Property Database Connection" -ForegroundColor Cyan
Write-Host ""
Write-Host "Connection Details:" -ForegroundColor Yellow
Write-Host "  Host: $DB_HOST" -ForegroundColor White
Write-Host "  Port: $DB_PORT" -ForegroundColor White
Write-Host "  Database: $DB_NAME" -ForegroundColor White
Write-Host "  User: $DB_USER" -ForegroundColor White
Write-Host ""

# Set password for psql
$env:PGPASSWORD = $DB_PASSWORD

# Test connection
Write-Host "Testing connection..." -ForegroundColor Blue
try {
    $result = psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT 'Connected'" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Connection successful!" -ForegroundColor Green
    } else {
        Write-Host "❌ Connection failed!" -ForegroundColor Red
        Write-Host $result
        exit 1
    }
} catch {
    Write-Host "❌ psql not found. Please install PostgreSQL client tools." -ForegroundColor Red
    Write-Host "Or use pgAdmin with these connection details." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "📊 Database Statistics" -ForegroundColor Cyan
Write-Host "─" * 60

# Get table counts
Write-Host ""
Write-Host "Tables:" -ForegroundColor Yellow
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
SELECT 
  tablename as \"Table\",
  n_live_tup as \"Rows\"
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
"

# Get top areas
Write-Host ""
Write-Host "Top 10 Areas:" -ForegroundColor Yellow
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
SELECT 
  area_name as \"Area\",
  COUNT(*) as \"Properties\",
  ROUND(AVG(starting_price)) as \"Avg Price\"
FROM off_plan_properties
WHERE starting_price IS NOT NULL
GROUP BY area_name
ORDER BY COUNT(*) DESC
LIMIT 10;
"

# Get developer stats
Write-Host ""
Write-Host "Top 10 Developers:" -ForegroundColor Yellow
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
SELECT 
  developer as \"Developer\",
  COUNT(*) as \"Projects\"
FROM off_plan_properties
GROUP BY developer
ORDER BY COUNT(*) DESC
LIMIT 10;
"

# Get price range
Write-Host ""
Write-Host "Price Statistics:" -ForegroundColor Yellow
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "
SELECT 
  COUNT(*) as \"Total Properties\",
  MIN(starting_price) as \"Min Price\",
  ROUND(AVG(starting_price)) as \"Avg Price\",
  MAX(starting_price) as \"Max Price\"
FROM off_plan_properties
WHERE starting_price IS NOT NULL;
"

Write-Host ""
Write-Host "✅ Database test complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Connection String for pgAdmin:" -ForegroundColor Yellow
Write-Host "  Host: $DB_HOST" -ForegroundColor White
Write-Host "  Port: $DB_PORT" -ForegroundColor White
Write-Host "  Database: $DB_NAME" -ForegroundColor White
Write-Host "  User: $DB_USER" -ForegroundColor White
Write-Host "  Password: $DB_PASSWORD" -ForegroundColor White
Write-Host ""
