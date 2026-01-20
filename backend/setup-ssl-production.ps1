#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Sets up SSL certificates for Gulf Property backend in production
.DESCRIPTION
    This script connects to the production server and sets up Let's Encrypt SSL certificates,
    then switches nginx to use the SSL-enabled configuration.
#>

param(
    [string]$ServerIP = "",
    [string]$Domain = "api.gulf-property.com",
    [string]$Email = ""
)

$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_NAME = "GulfProperty"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\hetzner-$PROJECT_NAME"

# Colors for output
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warning { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "[FAIL] $args" -ForegroundColor Red }
function Write-Step { Write-Host "`n[STEP] $args" -ForegroundColor Magenta }

Write-Host "=====================================" -ForegroundColor Green
Write-Host "Gulf Property - SSL Setup (Production)" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""

# Get server IP if not provided
if (-not $ServerIP) {
    Write-Info "Finding production server..."
    $serverList = hcloud server list -o columns=name,ipv4 -o noheader | Where-Object { $_ -match "$PROJECT_NAME-backend" }
    
    if ($serverList) {
        $ServerIP = ($serverList -split '\s+')[1]
        Write-Success "Found server: $ServerIP"
    } else {
        Write-Error "No production server found. Please provide IP address."
        exit 1
    }
}

# Get email if not provided
if (-not $Email) {
    $Email = Read-Host "Enter email for Let's Encrypt notifications"
    if (-not $Email) {
        Write-Error "Email is required"
        exit 1
    }
}

Write-Host ""
Write-Info "Configuration:"
Write-Host "  Server: $ServerIP"
Write-Host "  Domain: $Domain"
Write-Host "  Email: $Email"
Write-Host ""

$confirm = Read-Host "Continue? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Cancelled"
    exit 0
}

# Create SSL setup script
Write-Step "Creating SSL setup script..."

$sslScript = @'
#!/bin/bash
set -e

DOMAIN="{{DOMAIN}}"
EMAIL="{{EMAIL}}"

echo "Installing Certbot..."
apt-get update
apt-get install -y certbot

echo "Stopping nginx to free port 80..."
cd /opt/gulf-property
docker compose stop nginx

echo "Obtaining SSL certificate..."
certbot certonly --standalone \
    --preferred-challenges http \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive

if [ $? -ne 0 ]; then
    echo "Failed to obtain SSL certificate"
    docker compose start nginx
    exit 1
fi

echo "Certificate obtained successfully!"

# Setup auto-renewal
echo "Setting up auto-renewal..."
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'EOF'
#!/bin/bash
cd /opt/gulf-property
docker compose restart nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# Add cron job for renewal (if not exists)
(crontab -l 2>/dev/null | grep -q "certbot renew") || \
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet") | crontab -

echo "SSL setup complete!"
'@ -replace '{{DOMAIN}}', $Domain -replace '{{EMAIL}}', $Email

$tempScript = [System.IO.Path]::GetTempFileName()
$sslScript | Out-File -FilePath $tempScript -Encoding UTF8

Write-Success "SSL setup script created"

# Upload and execute SSL setup script
Write-Step "Setting up SSL on server..."

try {
    # Upload script
    Write-Info "Uploading SSL setup script..."
    scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
        $tempScript `
        "root@${ServerIP}:/tmp/setup-ssl.sh"
    
    # Make executable and run
    Write-Info "Running SSL setup..."
    ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no "root@${ServerIP}" @"
chmod +x /tmp/setup-ssl.sh
/tmp/setup-ssl.sh
rm /tmp/setup-ssl.sh
"@
    
    Write-Success "SSL certificates installed!"
    
    # Upload SSL-enabled nginx config
    Write-Step "Switching to SSL-enabled nginx configuration..."
    
    if (Test-Path "nginx.production.conf") {
        Write-Info "Uploading nginx.production.conf (with SSL)..."
        scp -i $SSH_KEY_PATH -o StrictHostKeyChecking=no `
            nginx.production.conf `
            "root@${ServerIP}:/opt/gulf-property/nginx.conf"
        
        # Restart nginx
        Write-Info "Restarting nginx with SSL configuration..."
        ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no "root@${ServerIP}" @"
cd /opt/gulf-property
docker compose restart nginx
sleep 3
docker compose ps
"@
        
        Write-Success "SSL configuration applied!"
        
        # Test the connection
        Write-Step "Testing HTTPS connection..."
        try {
            $response = Invoke-WebRequest -Uri "https://$Domain/health" -TimeoutSec 10 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Success "HTTPS is working correctly!"
            }
        } catch {
            Write-Warning "Could not verify HTTPS connection. Please check manually."
        }
        
    } else {
        Write-Error "nginx.production.conf not found!"
        Write-Info "Please create nginx.production.conf with SSL configuration"
        exit 1
    }
    
} finally {
    # Cleanup
    if (Test-Path $tempScript) {
        Remove-Item $tempScript -Force
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "SSL Setup Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your API is now accessible at:" -ForegroundColor Green
Write-Host "  https://$Domain" -ForegroundColor Green
Write-Host ""
Write-Host "Certificate will auto-renew before expiration." -ForegroundColor Cyan
Write-Host "Test renewal with: certbot renew --dry-run" -ForegroundColor Cyan
Write-Host ""
