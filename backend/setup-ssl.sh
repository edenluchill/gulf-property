#!/bin/bash

#
# SSL Certificate Setup Script for Gulf Property Backend
# Uses Let's Encrypt with Certbot
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Gulf Property - SSL Setup${NC}"
echo "=============================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# Get domain name
read -p "Enter your domain name (e.g., api.gulfproperty.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Domain name is required${NC}"
    exit 1
fi

# Get email for Let's Encrypt
read -p "Enter your email for Let's Encrypt notifications: " EMAIL
if [ -z "$EMAIL" ]; then
    echo -e "${RED}Email is required${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  Domain: $DOMAIN"
echo "  Email: $EMAIL"
echo ""
read -p "Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled"
    exit 0
fi

# Install Certbot
echo ""
echo -e "${YELLOW}Installing Certbot...${NC}"
apt-get update
apt-get install -y certbot

# Stop nginx temporarily
echo ""
echo -e "${YELLOW}Stopping nginx...${NC}"
cd /opt/gulf-property
docker compose stop nginx 2>/dev/null || true

# Obtain certificate
echo ""
echo -e "${YELLOW}Obtaining SSL certificate...${NC}"
certbot certonly --standalone \
    --preferred-challenges http \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to obtain SSL certificate${NC}"
    docker compose start nginx 2>/dev/null || true
    exit 1
fi

# Update nginx.conf
echo ""
echo -e "${YELLOW}Updating nginx configuration...${NC}"

# Backup original
cp nginx.conf nginx.conf.backup

# Update server_name and uncomment HTTPS block
sed -i "s/server_name _;/server_name $DOMAIN;/" nginx.conf
sed -i "s/your-domain.com/$DOMAIN/g" nginx.conf

# Uncomment HTTPS server block
sed -i '/# server {/,/# }/s/^#[ ]*//' nginx.conf

# Enable HTTPS redirect
sed -i '/# Uncomment this in production/,/# }/s/^# //' nginx.conf
sed -i '/# Temporary: proxy to backend/,/^    }/s/^/# /' nginx.conf

# Restart nginx
echo ""
echo -e "${YELLOW}Restarting nginx with SSL...${NC}"
docker compose up -d nginx

# Test nginx config
docker compose exec nginx nginx -t

if [ $? -ne 0 ]; then
    echo -e "${RED}Nginx configuration error!${NC}"
    echo "Restoring backup..."
    mv nginx.conf.backup nginx.conf
    docker compose restart nginx
    exit 1
fi

# Setup auto-renewal
echo ""
echo -e "${YELLOW}Setting up auto-renewal...${NC}"

# Create renewal hook
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'EOF'
#!/bin/bash
cd /opt/gulf-property
docker compose restart nginx
EOF

chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# Add cron job for renewal
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet") | crontab -

echo ""
echo -e "${GREEN}=============================="
echo "SSL Setup Complete!"
echo "=============================="
echo -e "${NC}"
echo "Your site is now accessible at:"
echo -e "${GREEN}https://$DOMAIN${NC}"
echo ""
echo "Certificate will auto-renew before expiration."
echo "Check renewal with: certbot renew --dry-run"
echo ""
