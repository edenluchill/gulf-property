#!/bin/bash

# Gulf Property - SSL Setup Script for Cloudflare + Let's Encrypt
# 在 Hetzner 服务器上运行此脚本以配置 SSL 证书

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Gulf Property - SSL Setup Script${NC}"
echo "=================================="
echo ""

# 检查是否以 root 运行
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root${NC}"
    exit 1
fi

# 获取域名
read -p "Enter your domain (e.g., api.gulf-property.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Domain cannot be empty${NC}"
    exit 1
fi

# 获取邮箱
read -p "Enter your email for Let's Encrypt notifications: " EMAIL

if [ -z "$EMAIL" ]; then
    echo -e "${RED}Email cannot be empty${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  Domain: $DOMAIN"
echo "  Email: $EMAIL"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# ============================================================================
# 1. 安装 Certbot
# ============================================================================

echo ""
echo -e "${YELLOW}[1/5] Installing Certbot...${NC}"

if command -v certbot &> /dev/null; then
    echo -e "${GREEN}✓ Certbot already installed${NC}"
else
    apt-get update
    apt-get install -y certbot
    echo -e "${GREEN}✓ Certbot installed${NC}"
fi

# ============================================================================
# 2. 停止 Nginx (临时)
# ============================================================================

echo ""
echo -e "${YELLOW}[2/5] Stopping Nginx temporarily...${NC}"

cd /opt/gulf-property

# 停止 nginx 容器以释放端口 80
docker compose stop nginx 2>/dev/null || true

echo -e "${GREEN}✓ Nginx stopped${NC}"

# ============================================================================
# 3. 获取 SSL 证书
# ============================================================================

echo ""
echo -e "${YELLOW}[3/5] Obtaining SSL certificate...${NC}"
echo -e "${YELLOW}Note: Ensure DNS is pointing to this server before continuing${NC}"
echo ""

# 检查证书是否已存在
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo -e "${YELLOW}Certificate already exists for $DOMAIN${NC}"
    read -p "Renew certificate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        certbot renew --force-renewal --standalone -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    fi
else
    certbot certonly --standalone -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ SSL certificate obtained successfully${NC}"
    echo ""
    echo "Certificate files:"
    echo "  - Cert: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    echo "  - Key:  /etc/letsencrypt/live/$DOMAIN/privkey.pem"
else
    echo -e "${RED}✗ Failed to obtain SSL certificate${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check DNS: nslookup $DOMAIN"
    echo "  2. Ensure port 80 is accessible"
    echo "  3. Check Cloudflare proxy settings"
    exit 1
fi

# ============================================================================
# 4. 更新 Nginx 配置
# ============================================================================

echo ""
echo -e "${YELLOW}[4/5] Updating Nginx configuration...${NC}"

# 备份现有配置
if [ -f "nginx.conf" ]; then
    cp nginx.conf nginx.conf.backup
    echo -e "${GREEN}✓ Backup created: nginx.conf.backup${NC}"
fi

# 创建生产配置
cat > nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 50M;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript;

    upstream backend {
        server api:3000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    # HTTP - redirect to HTTPS
    server {
        listen 80;
        server_name $DOMAIN;

        location /.well-known/acme-challenge/ {
            root /var/lib/letsencrypt;
        }

        location /health {
            proxy_pass http://backend;
            access_log off;
        }

        location / {
            return 301 https://\$host\$request_uri;
        }
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        server_name $DOMAIN;

        ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;

        location /health {
            proxy_pass http://backend;
            access_log off;
        }

        location / {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_cache_bypass \$http_upgrade;
            
            proxy_connect_timeout 90s;
            proxy_send_timeout 90s;
            proxy_read_timeout 90s;
        }
    }
}
EOF

echo -e "${GREEN}✓ Nginx configuration updated${NC}"

# ============================================================================
# 5. 重启服务
# ============================================================================

echo ""
echo -e "${YELLOW}[5/5] Restarting services...${NC}"

# 重启所有服务
docker compose up -d --force-recreate

# 等待服务启动
echo "Waiting for services to start..."
sleep 10

# 检查健康状态
if curl -s --max-time 5 https://$DOMAIN/health | grep -q 'ok\|healthy'; then
    echo -e "${GREEN}✓ Services are running with HTTPS${NC}"
else
    echo -e "${YELLOW}⚠ Health check warning (services may still be starting)${NC}"
fi

# ============================================================================
# 设置自动续期
# ============================================================================

echo ""
echo -e "${YELLOW}Setting up automatic certificate renewal...${NC}"

# 创建续期 hook
cat > /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh << 'EOF'
#!/bin/bash
cd /opt/gulf-property
docker compose restart nginx
EOF

chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh

# 添加 cron job (每天检查)
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet") | crontab -
    echo -e "${GREEN}✓ Auto-renewal configured (daily at 3am)${NC}"
else
    echo -e "${GREEN}✓ Auto-renewal already configured${NC}"
fi

# ============================================================================
# 完成
# ============================================================================

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}SSL Setup Complete! 🎉${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Your API is now accessible at:"
echo -e "${GREEN}  https://$DOMAIN${NC}"
echo ""
echo "Test the setup:"
echo "  curl https://$DOMAIN/health"
echo ""
echo "Certificate will auto-renew before expiry."
echo ""
echo "Logs:"
echo "  docker logs gulf-property-nginx -f"
echo "  docker logs gulf-property-api -f"
echo ""
