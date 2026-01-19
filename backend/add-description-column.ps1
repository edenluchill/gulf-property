# Load environment variables from .env file
Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*?)\s*$') {
        $name = $matches[1]
        $value = $matches[2]
        Set-Item -Path "env:$name" -Value $value
    }
}

# Set PostgreSQL password environment variable
$env:PGPASSWORD = $env:DB_PASSWORD

# Run the migration SQL
$sql = @"
-- Add description column if it doesn't exist
DO `$`$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'project_unit_types' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE project_unit_types 
        ADD COLUMN description TEXT;
        
        RAISE NOTICE 'Added description column to project_unit_types table';
    ELSE
        RAISE NOTICE 'Description column already exists in project_unit_types table';
    END IF;
END `$`$;
"@

Write-Host "Running migration..." -ForegroundColor Cyan
Write-Host "Database: $($env:DB_NAME)" -ForegroundColor Gray
Write-Host "Host: $($env:DB_HOST)" -ForegroundColor Gray

# Execute the SQL
$sql | psql -h $env:DB_HOST -U $env:DB_USER -d $env:DB_NAME

Write-Host "`nDone!" -ForegroundColor Green
