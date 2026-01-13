#Requires -Version 5.1

<#
.SYNOPSIS
    Database Management Helper Script

.DESCRIPTION
    Utility script for managing your Hetzner PostgreSQL database
    
.EXAMPLE
    .\manage-database.ps1 -Action status
    .\manage-database.ps1 -Action backup
    .\manage-database.ps1 -Action restore -BackupFile backup.sql
    
.NOTES
    Run deploy-database.ps1 first to set up the database
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("status", "backup", "restore", "ssh", "psql", "logs", "info", "test")]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [string]$BackupFile = ""
)

$ErrorActionPreference = "Stop"

$PROJECT_NAME = "gulf-property"
$SERVER_NAME = "$PROJECT_NAME-db"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\${PROJECT_NAME}_db_ed25519"
$ENV_FILE = "backend\.env.database"

# Color output functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

# Check if server exists
try {
    $serverInfo = hcloud server describe $SERVER_NAME -o json 2>$null | ConvertFrom-Json
    $SERVER_IP = $serverInfo.public_net.ipv4.ip
} catch {
    Write-Error-Custom "Database server not found: $SERVER_NAME"
    Write-Info "Please run deploy-database.ps1 first"
    exit 1
}

# Load database credentials from .env.database
if (-not (Test-Path $ENV_FILE)) {
    Write-Error-Custom "Credentials file not found: $ENV_FILE"
    Write-Info "Please run deploy-database.ps1 first"
    exit 1
}

$DB_HOST = ""
$DB_NAME = ""
$DB_USER = ""
$DB_PASSWORD = ""

Get-Content $ENV_FILE | ForEach-Object {
    if ($_ -match "^DB_HOST=(.+)$") { $DB_HOST = $matches[1].Trim() }
    if ($_ -match "^DB_NAME=(.+)$") { $DB_NAME = $matches[1].Trim() }
    if ($_ -match "^DB_USER=(.+)$") { $DB_USER = $matches[1].Trim() }
    if ($_ -match "^DB_PASSWORD=(.+)$") { $DB_PASSWORD = $matches[1].Trim() }
}

# Execute action
switch ($Action) {
    "status" {
        Write-Info "Checking database server status..."
        Write-Host ""
        Write-Host "Server: $SERVER_NAME" -ForegroundColor Cyan
        Write-Host "IP: $SERVER_IP" -ForegroundColor Cyan
        Write-Host ""
        
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP @"
echo "=== System Status ==="
uptime
echo ""
echo "=== PostgreSQL Status ==="
systemctl status postgresql --no-pager
echo ""
echo "=== Disk Usage ==="
df -h /
echo ""
echo "=== Database Size ==="
sudo -u postgres psql -d $DB_NAME -c "SELECT pg_size_pretty(pg_database_size('$DB_NAME')) AS db_size;"
echo ""
echo "=== Active Connections ==="
sudo -u postgres psql -d $DB_NAME -c "SELECT COUNT(*) as connections FROM pg_stat_activity;"
echo ""
echo "=== Table Sizes ==="
sudo -u postgres psql -d $DB_NAME -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 5;"
"@
    }
    
    "backup" {
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupFileName = "gulf-property-backup-$timestamp.sql"
        
        Write-Info "Creating database backup..."
        
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP "sudo -u postgres pg_dump $DB_NAME > /tmp/$backupFileName"
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error-Custom "Backup failed on server"
            exit 1
        }
        
        Write-Info "Downloading backup..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no "root@${SERVER_IP}:/tmp/$backupFileName" "./$backupFileName"
        
        if ($LASTEXITCODE -eq 0) {
            ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP "rm /tmp/$backupFileName"
            Write-Success "Backup saved: $backupFileName"
            
            $fileSize = (Get-Item $backupFileName).Length / 1MB
            Write-Info "Backup size: $([math]::Round($fileSize, 2)) MB"
        } else {
            Write-Error-Custom "Failed to download backup"
            exit 1
        }
    }
    
    "restore" {
        if (-not $BackupFile) {
            Write-Error-Custom "Please specify backup file with -BackupFile parameter"
            Write-Info "Example: .\manage-database.ps1 -Action restore -BackupFile backup.sql"
            exit 1
        }
        
        if (-not (Test-Path $BackupFile)) {
            Write-Error-Custom "Backup file not found: $BackupFile"
            exit 1
        }
        
        Write-Warning "This will restore the database from backup!"
        Write-Warning "Current data may be overwritten."
        $confirm = Read-Host "Type 'yes' to continue"
        
        if ($confirm -ne "yes") {
            Write-Info "Restore cancelled"
            exit 0
        }
        
        Write-Info "Uploading backup file..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no $BackupFile "root@${SERVER_IP}:/tmp/restore.sql"
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error-Custom "Failed to upload backup file"
            exit 1
        }
        
        Write-Info "Restoring database..."
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP "sudo -u postgres psql $DB_NAME < /tmp/restore.sql"
        
        if ($LASTEXITCODE -eq 0) {
            ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP "rm /tmp/restore.sql"
            Write-Success "Database restored successfully"
        } else {
            Write-Error-Custom "Restore failed"
            exit 1
        }
    }
    
    "ssh" {
        Write-Info "Opening SSH connection to database server..."
        Write-Info "Commands you can run:"
        Write-Host "  - sudo -u postgres psql                 (PostgreSQL admin)"
        Write-Host "  - sudo -u postgres psql -d $DB_NAME    (Connect to DB)"
        Write-Host "  - systemctl status postgresql            (Check status)"
        Write-Host "  - tail -f /var/log/postgresql/...        (View logs)"
        Write-Host ""
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP
    }
    
    "psql" {
        Write-Info "Opening PostgreSQL connection..."
        Write-Info "Connecting to: $DB_NAME @ $DB_HOST"
        Write-Host ""
        
        $env:PGPASSWORD = $DB_PASSWORD
        psql -h $DB_HOST -U $DB_USER -d $DB_NAME
    }
    
    "logs" {
        Write-Info "Fetching PostgreSQL logs (last 50 lines)..."
        Write-Host ""
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$SERVER_IP "tail -n 50 /var/log/postgresql/postgresql-*-main.log"
    }
    
    "info" {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "Database Connection Information" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Host:     $DB_HOST" -ForegroundColor White
        Write-Host "Port:     5432" -ForegroundColor White
        Write-Host "Database: $DB_NAME" -ForegroundColor White
        Write-Host "User:     $DB_USER" -ForegroundColor White
        Write-Host "Password: $DB_PASSWORD" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Connection String:" -ForegroundColor Cyan
        Write-Host "postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME" -ForegroundColor White
        Write-Host ""
        Write-Host "psql Command:" -ForegroundColor Cyan
        Write-Host "psql -h $DB_HOST -U $DB_USER -d $DB_NAME" -ForegroundColor White
        Write-Host ""
        Write-Host "SSH Access:" -ForegroundColor Cyan
        Write-Host "ssh -i $SSH_KEY_PATH root@$SERVER_IP" -ForegroundColor White
        Write-Host ""
    }
    
    "test" {
        Write-Info "Testing database connection..."
        Write-Host ""
        
        $env:PGPASSWORD = $DB_PASSWORD
        $testQuery = @"
SELECT 
    version() as pg_version,
    current_database() as database,
    current_user as user,
    inet_server_addr() as server_ip;
"@
        
        psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "$testQuery"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Success "Database connection successful!"
            
            Write-Info "Testing PostGIS..."
            psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT postgis_version();"
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "PostGIS extension working!"
            }
            
            Write-Host ""
            Write-Info "Checking tables..."
            psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\dt"
            
        } else {
            Write-Error-Custom "Connection failed!"
            Write-Info "Check your credentials in $ENV_FILE"
        }
    }
}

Write-Host ""
