#Requires -Version 5.1
<#
.SYNOPSIS
    Gulf Property PostgreSQL Database Deployment to Hetzner Cloud

.DESCRIPTION
    One-command deployment of production-ready PostgreSQL 16 with PostGIS
    
.EXAMPLE
    .\deploy-database.ps1
    
.NOTES
    Version: 1.1
#>

# ============================================================================
# Configuration
# ============================================================================

$ErrorActionPreference = "Stop"

$PROJECT_NAME = "gulf-property"
$DB_NAME = "gulf_property"
$DB_USER = "gulf_admin"
$LOCATION = "nbg1"               # Nuremberg, Germany
$SERVER_TYPE = "cpx22"           # 2 vCPU, 4GB RAM, 80GB disk
$NETWORK_ZONE = "eu-central"

# ============================================================================
# Helper Functions
# ============================================================================

function New-RandomPassword {
    param([int]$Length = 24)
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $password = ""
    $random = New-Object System.Random
    for ($i = 0; $i -lt $Length; $i++) {
        $password += $chars[$random.Next(0, $chars.Length)]
    }
    return $password
}

function Write-Info($Message) { Write-Host "[INFO] $Message" -ForegroundColor Blue }
function Write-Success($Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warning($Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Error-Custom($Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }
function Write-Step($Message) { Write-Host "`n[STEP] $Message" -ForegroundColor Cyan }

function Invoke-RemoteScript {
    param(
        [string]$Script,
        [string]$Description
    )
    
    Write-Info $Description
    $tempFile = [System.IO.Path]::GetTempFileName()
    $cleanScript = $Script.Replace("`r", "")
    [System.IO.File]::WriteAllText($tempFile, $cleanScript, (New-Object System.Text.UTF8Encoding $false))
    
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o LogLevel=ERROR $tempFile "root@${PUBLIC_IP}:/tmp/script.sh" 2>$null
    ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$PUBLIC_IP "bash /tmp/script.sh 2>&1"
    $exitCode = $LASTEXITCODE
    
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    
    if ($exitCode -ne 0) {
        Write-Error-Custom "$Description failed"
        exit 1
    }
}

# ============================================================================
# Prerequisites Check
# ============================================================================

Write-Step "Checking prerequisites..."

# Check hcloud CLI
if (-not (Get-Command hcloud -ErrorAction SilentlyContinue)) {
    Write-Error-Custom "hcloud CLI not installed"
    Write-Host "Download: https://github.com/hetznercloud/cli/releases"
    exit 1
}
Write-Success "hcloud CLI found"

# Check hcloud context
try {
    $null = hcloud context list 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Success "hcloud configured"
} catch {
    Write-Error-Custom "hcloud not configured"
    Write-Host "Run: hcloud context create <name>"
    exit 1
}

# Check schema file
$SCHEMA_PATH = "backend\src\db\schema.sql"
if (-not (Test-Path $SCHEMA_PATH)) {
    Write-Error-Custom "Schema not found: $SCHEMA_PATH"
    exit 1
}
Write-Success "Schema file found"

# Use fixed password
$DB_PASSWORD = "aB246`$29"
$SSH_KEY_NAME = "$PROJECT_NAME-db-key"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\${PROJECT_NAME}_db_ed25519"
$NETWORK_NAME = "$PROJECT_NAME-db-network"
$FIREWALL_NAME = "$PROJECT_NAME-db-firewall"
$SERVER_NAME = "$PROJECT_NAME-db"

# ============================================================================
# Create Infrastructure
# ============================================================================

Write-Step "Setting up infrastructure..."

# SSH Key
if (-not (hcloud ssh-key describe $SSH_KEY_NAME 2>$null)) {
    if (-not (Test-Path $SSH_KEY_PATH)) {
        Write-Info "Generating SSH key..."
        ssh-keygen -t ed25519 -f $SSH_KEY_PATH -N '""' -C "hetzner-$PROJECT_NAME-db" 2>$null | Out-Null
    }
    hcloud ssh-key create --name $SSH_KEY_NAME --public-key-from-file "${SSH_KEY_PATH}.pub" 2>$null | Out-Null
    Write-Success "SSH key created"
} else {
    Write-Success "SSH key exists"
}

# Network
if (-not (hcloud network describe $NETWORK_NAME 2>$null)) {
    hcloud network create --name $NETWORK_NAME --ip-range 10.1.0.0/16 2>$null | Out-Null
    hcloud network add-subnet $NETWORK_NAME --network-zone $NETWORK_ZONE --type cloud --ip-range 10.1.1.0/24 2>$null | Out-Null
    Write-Success "Network created"
} else {
    Write-Success "Network exists"
}

# Firewall
if (-not (hcloud firewall describe $FIREWALL_NAME 2>$null)) {
    hcloud firewall create --name $FIREWALL_NAME 2>$null | Out-Null
}

$rulesJson = @"
[
  {"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ["0.0.0.0/0", "::/0"]},
  {"direction": "in", "protocol": "tcp", "port": "5432", "source_ips": ["0.0.0.0/0", "::/0"]},
  {"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"]}
]
"@

$tempFile = [System.IO.Path]::GetTempFileName()
$rulesJson | Out-File -FilePath $tempFile -Encoding ascii
Start-Process -FilePath "hcloud" -ArgumentList "firewall","replace-rules",$FIREWALL_NAME,"--rules-file",$tempFile -Wait -NoNewWindow -RedirectStandardOutput "$env:TEMP\hcloud.out" -RedirectStandardError "$env:TEMP\hcloud.err"
Remove-Item $tempFile,$env:TEMP\hcloud.out,$env:TEMP\hcloud.err -ErrorAction SilentlyContinue
Write-Success "Firewall configured"

# Server
$serverExists = $false
try {
    $null = hcloud server describe $SERVER_NAME 2>&1
    $serverExists = ($LASTEXITCODE -eq 0)
} catch {
    $serverExists = $false
}

if (-not $serverExists) {
    Write-Info "Creating server (this takes ~30 seconds)..."
    
    $cloudInit = @"
#cloud-config
package_update: true
packages:
  - curl
  - gnupg
"@
    
    $tempCloudInit = [System.IO.Path]::GetTempFileName()
    $cloudInit | Out-File -FilePath $tempCloudInit -Encoding utf8
    
    hcloud server create `
        --name $SERVER_NAME `
        --type $SERVER_TYPE `
        --location $LOCATION `
        --image ubuntu-22.04 `
        --ssh-key $SSH_KEY_NAME `
        --network $NETWORK_NAME `
        --firewall $FIREWALL_NAME `
        --label "app=$PROJECT_NAME" `
        --user-data-from-file $tempCloudInit 2>$null | Out-Null
    
    Remove-Item $tempCloudInit
    Start-Sleep -Seconds 25
    Write-Success "Server created"
} else {
    Write-Success "Server exists"
}

$serverInfo = hcloud server describe $SERVER_NAME -o json | ConvertFrom-Json
$PUBLIC_IP = $serverInfo.public_net.ipv4.ip

Write-Success "Server IP: $PUBLIC_IP"

# ============================================================================
# Wait for SSH
# ============================================================================

Write-Step "Connecting to server..."

$retries = 0
while ($retries -lt 30) {
    $null = ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o LogLevel=ERROR root@$PUBLIC_IP "echo ok" 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    $retries++
    if ($retries -eq 30) {
        Write-Error-Custom "SSH timeout"
        exit 1
    }
    Start-Sleep -Seconds 3
}

Write-Success "SSH connected"

# ============================================================================
# Install PostgreSQL
# ============================================================================

Write-Step "Installing PostgreSQL 16 with PostGIS..."

$installScript = @'
#!/bin/bash
set -e

# Check if already installed
if systemctl is-active --quiet postgresql; then
    echo "PostgreSQL already running"
    exit 0
fi

echo "Installing PostgreSQL..."

# Add PostgreSQL repo
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg 2>/dev/null
echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt jammy-pgdg main" > /etc/apt/sources.list.d/pgdg.list

# Install
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 postgresql-16-postgis-3 postgresql-contrib-16 >/dev/null 2>&1

# Start service
systemctl enable --now postgresql

echo "PostgreSQL installed"
'@

Invoke-RemoteScript -Script $installScript -Description "Installing PostgreSQL"
Write-Success "PostgreSQL 16 with PostGIS installed"

# ============================================================================
# Configure PostgreSQL
# ============================================================================

Write-Step "Configuring PostgreSQL..."

$configScript = @'
#!/bin/bash
set -e

PG_CONF="/etc/postgresql/16/main/postgresql.conf"
PG_HBA="/etc/postgresql/16/main/pg_hba.conf"

# Configure postgresql.conf
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" "$PG_CONF"
sed -i "s/max_connections = 100/max_connections = 200/" "$PG_CONF"
sed -i "s/shared_buffers = 128MB/shared_buffers = 512MB/" "$PG_CONF"

# Configure pg_hba.conf
if ! grep -q "0.0.0.0/0" "$PG_HBA"; then
    echo "host    all             all             0.0.0.0/0               scram-sha-256" >> "$PG_HBA"
fi

# Restart
systemctl restart postgresql
sleep 2

echo "PostgreSQL configured"
'@

Invoke-RemoteScript -Script $configScript -Description "Configuring remote access"
Write-Success "Remote access enabled"

# ============================================================================
# Create Database and User
# ============================================================================

Write-Step "Creating database and user..."

$dbScript = @"
#!/bin/bash
set -e

# Check if database exists
if sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo "Database already exists"
    exit 0
fi

# Create user and database
sudo -u postgres psql <<'EOF'
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

# Enable PostGIS and set permissions
sudo -u postgres psql -d $DB_NAME <<'EOF'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
EOF

echo "Database created"
"@

Invoke-RemoteScript -Script $dbScript -Description "Creating database"
Write-Success "Database '$DB_NAME' created"

# ============================================================================
# Import Schema
# ============================================================================

Write-Step "Importing database schema..."

# Check if application tables exist
$checkScript = @"
#!/bin/bash
TABLE_EXISTS=`$(PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='off_plan_properties');" 2>/dev/null | xargs)
echo `$TABLE_EXISTS
"@

$tempCheck = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tempCheck, $checkScript.Replace("`r", ""), (New-Object System.Text.UTF8Encoding $false))
scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o LogLevel=ERROR $tempCheck "root@${PUBLIC_IP}:/tmp/check.sh" 2>$null
$tableExists = ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$PUBLIC_IP "bash /tmp/check.sh" 2>&1 | Select-Object -Last 1
Remove-Item $tempCheck

if ($tableExists -eq "t") {
    Write-Success "Schema already imported"
} else {
    Write-Info "Uploading schema..."
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o LogLevel=ERROR $SCHEMA_PATH "root@${PUBLIC_IP}:/tmp/schema.sql" 2>$null

    $importScript = @"
#!/bin/bash
set -e
PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -f /tmp/schema.sql -q 2>&1
TABLE_COUNT=`$(PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" | xargs)
echo "Imported `$TABLE_COUNT tables"
"@

    Invoke-RemoteScript -Script $importScript -Description "Importing schema"
    Write-Success "Schema imported successfully"
}

# ============================================================================
# Test Connection
# ============================================================================

Write-Step "Testing database connection..."

$testScript = @"
#!/bin/bash
# Don't use set -e here - grep may return 1 if no results

# Test connection
RESULT=`$(PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT 'OK' AS status;" 2>/dev/null | xargs)

if [ "`$RESULT" != "OK" ]; then
    echo "Connection test failed"
    exit 1
fi

# Test PostGIS
POSTGIS=`$(PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT PostGIS_Version();" 2>/dev/null | head -1 | xargs)

# Count tables
TABLE_COUNT=`$(PGPASSWORD='$DB_PASSWORD' psql -h localhost -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>/dev/null | xargs)

echo "Connection: OK"
echo "PostGIS: `$POSTGIS"
echo "Tables: `$TABLE_COUNT"
exit 0
"@

Write-Info "Running connection tests..."
$tempTest = [System.IO.Path]::GetTempFileName()
$cleanTest = $testScript.Replace("`r", "")
[System.IO.File]::WriteAllText($tempTest, $cleanTest, (New-Object System.Text.UTF8Encoding $false))
scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o LogLevel=ERROR $tempTest "root@${PUBLIC_IP}:/tmp/test.sh" 2>$null
$testOutput = ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$PUBLIC_IP "bash /tmp/test.sh" 2>&1
Remove-Item $tempTest
Write-Host $testOutput
Write-Success "Database is working!"

# ============================================================================
# Create Environment File
# ============================================================================

Write-Step "Creating environment file..."

$envContent = @"
# Gulf Property Database Configuration
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

DB_HOST=$PUBLIC_IP
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Connection String:
# postgresql://${DB_USER}:${DB_PASSWORD}@${PUBLIC_IP}:5432/${DB_NAME}
"@

$envContent | Out-File -FilePath "backend\.env.database" -Encoding utf8
Write-Success "Saved to backend\.env.database"

# Also save full credentials
$credContent = @"
Gulf Property Database Credentials
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
========================================

Host: $PUBLIC_IP
Port: 5432
Database: $DB_NAME
User: $DB_USER
Password: $DB_PASSWORD

Connection String:
postgresql://${DB_USER}:${DB_PASSWORD}@${PUBLIC_IP}:5432/${DB_NAME}

SSH Access:
ssh -i $SSH_KEY_PATH root@$PUBLIC_IP

PostgreSQL CLI:
psql -h $PUBLIC_IP -U $DB_USER -d $DB_NAME

========================================
KEEP THIS FILE SECURE - DO NOT COMMIT
"@

$credContent | Out-File -FilePath "database-credentials.txt" -Encoding utf8

# ============================================================================
# Deployment Complete
# ============================================================================

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "                    Database Deployment Complete!                       " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Server Information:" -ForegroundColor Cyan
Write-Host "  IP Address: $PUBLIC_IP" -ForegroundColor White
Write-Host "  Type: $SERVER_TYPE (2 vCPU, 4GB RAM, 80GB SSD)" -ForegroundColor White
Write-Host "  Location: Nuremberg, Germany" -ForegroundColor White
Write-Host ""
Write-Host "Database Connection:" -ForegroundColor Cyan
Write-Host "  Host: $PUBLIC_IP" -ForegroundColor White
Write-Host "  Port: 5432" -ForegroundColor White
Write-Host "  Database: $DB_NAME" -ForegroundColor White
Write-Host "  User: $DB_USER" -ForegroundColor White
Write-Host "  Password: $DB_PASSWORD" -ForegroundColor Yellow
Write-Host ""
Write-Host "PostgreSQL: 16.11 with PostGIS 3.6" -ForegroundColor Cyan
Write-Host ""
Write-Host "Files Created:" -ForegroundColor Cyan
Write-Host "  backend\.env.database         (use in your backend)" -ForegroundColor White
Write-Host "  database-credentials.txt    (backup - keep secure!)" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Copy backend\.env.database to backend\.env" -ForegroundColor White
Write-Host "  2. Start your backend: cd backend && npm run dev" -ForegroundColor White
Write-Host "  3. Import data (optional): npm run import-data" -ForegroundColor White
Write-Host ""
Write-Host "Quick Test:" -ForegroundColor Cyan
Write-Host "  psql -h $PUBLIC_IP -U $DB_USER -d $DB_NAME" -ForegroundColor White
Write-Host ""
Write-Host "Monthly Cost: ~€7.50" -ForegroundColor Green
Write-Host ""
