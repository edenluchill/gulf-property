#!/bin/bash
# Verify Nginx Configuration for Upload Optimization

echo "========================================"
echo "Nginx Configuration Verification"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running in Docker
if [ -f /.dockerenv ]; then
    echo -e "${GREEN}✓${NC} Running inside Docker container"
    NGINX_CMD="nginx"
else
    echo -e "${YELLOW}⚠${NC} Running on host, will use docker-compose"
    NGINX_CMD="docker-compose exec -T nginx nginx"
fi

echo ""
echo "1. Testing Nginx configuration syntax..."
if $NGINX_CMD -t 2>&1 | grep -q "successful"; then
    echo -e "${GREEN}✓${NC} Nginx configuration syntax is valid"
else
    echo -e "${RED}✗${NC} Nginx configuration has errors:"
    $NGINX_CMD -t
    exit 1
fi

echo ""
echo "2. Checking upload optimization settings..."

CONFIG_FILE="/etc/nginx/nginx.conf"
if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="nginx.conf"
fi

# Check for upload optimization settings
checks_passed=0
checks_failed=0

echo ""
echo "Checking key settings:"

# Check client_body_buffer_size
if grep -q "client_body_buffer_size.*128k" "$CONFIG_FILE" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} client_body_buffer_size: 128k"
    ((checks_passed++))
else
    echo -e "${YELLOW}⚠${NC} client_body_buffer_size: not found or incorrect"
    ((checks_failed++))
fi

# Check client_max_body_size
if grep -q "client_max_body_size.*500M" "$CONFIG_FILE" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} client_max_body_size: 500M"
    ((checks_passed++))
else
    echo -e "${YELLOW}⚠${NC} client_max_body_size: not found or incorrect"
    ((checks_failed++))
fi

# Check for optimized upload endpoint
if grep -q "/api/langgraph-progress/start" "$CONFIG_FILE" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Optimized upload endpoint configured"
    ((checks_passed++))
else
    echo -e "${YELLOW}⚠${NC} Optimized upload endpoint: not found"
    ((checks_failed++))
fi

# Check proxy_request_buffering off
if grep -A 10 "/api/langgraph-progress/start" "$CONFIG_FILE" 2>/dev/null | grep -q "proxy_request_buffering off"; then
    echo -e "${GREEN}✓${NC} proxy_request_buffering: off"
    ((checks_passed++))
else
    echo -e "${YELLOW}⚠${NC} proxy_request_buffering: not disabled"
    ((checks_failed++))
fi

# Check proxy_buffering off
if grep -A 10 "/api/langgraph-progress/start" "$CONFIG_FILE" 2>/dev/null | grep -q "proxy_buffering off"; then
    echo -e "${GREEN}✓${NC} proxy_buffering: off"
    ((checks_passed++))
else
    echo -e "${YELLOW}⚠${NC} proxy_buffering: not disabled"
    ((checks_failed++))
fi

echo ""
echo "========================================"
echo "Verification Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$checks_passed${NC}"
echo -e "Failed: ${YELLOW}$checks_failed${NC}"
echo ""

if [ $checks_failed -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo "Your Nginx is configured correctly for upload optimization."
    exit 0
else
    echo -e "${YELLOW}⚠ Some checks failed.${NC}"
    echo "Please review the configuration and make necessary changes."
    echo ""
    echo "Expected settings in nginx.conf:"
    echo "  - client_body_buffer_size 128k"
    echo "  - client_max_body_size 500M"
    echo "  - location /api/langgraph-progress/start with:"
    echo "    * proxy_request_buffering off"
    echo "    * proxy_buffering off"
    exit 1
fi
