#Requires -Version 5.1

<#
.SYNOPSIS
    Diagnose Gulf Property Backend Deployment Issues
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$ServerIP = ""
)

$ErrorActionPreference = "Stop"
$PROJECT_NAME = "GulfProperty"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\${PROJECT_NAME}_ed25519"

function Write-Header {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

# 如果没有指定IP，尝试从hcloud获取
if ([string]::IsNullOrWhiteSpace($ServerIP)) {
    Write-Host "No server IP provided, fetching from Hetzner..." -ForegroundColor Yellow
    
    # 尝试切换到正确的context
    $contextNames = @($PROJECT_NAME, "gulf-property", "gulfproperty")
    foreach ($contextName in $contextNames) {
        $null = hcloud context use $contextName 2>$null
        if ($LASTEXITCODE -eq 0) { break }
    }
    
    # 获取第一个backend服务器
    $servers = hcloud server list -o json | ConvertFrom-Json
    $backendServer = $servers | Where-Object { $_.name -like "*backend*" } | Select-Object -First 1
    
    if ($backendServer) {
        $ServerIP = $backendServer.public_net.ipv4.ip
        Write-Host "Found server: $($backendServer.name) - $ServerIP" -ForegroundColor Green
    } else {
        Write-Host "No backend servers found. Please provide IP manually:" -ForegroundColor Red
        Write-Host "  .\diagnose-deployment.ps1 -ServerIP <ip>" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Diagnosing server: $ServerIP" -ForegroundColor Green
Write-Host "SSH Key: $SSH_KEY_PATH" -ForegroundColor Gray

# 测试SSH连接
Write-Header "1. Testing SSH Connection"
try {
    ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@$ServerIP "echo 'SSH OK'"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ SSH connection successful" -ForegroundColor Green
    } else {
        Write-Host "❌ SSH connection failed" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Cannot connect via SSH" -ForegroundColor Red
    exit 1
}

# 检查Docker状态
Write-Header "2. Docker Status"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP @'
echo "Docker version:"
docker --version
echo ""
echo "Docker containers:"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
'@

# 检查容器资源使用
Write-Header "3. Container Resources"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP 'docker stats --no-stream'

# 检查最近日志
Write-Header "4. Recent Logs (Last 50 lines)"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP 'docker logs gulf-property-api --tail 50 2>&1'

# 检查健康状态
Write-Header "5. Health Check"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP @'
echo "Checking health endpoint..."
for port in 3000 80 8080; do
    echo "Trying port $port..."
    response=$(curl -s --max-time 3 "http://127.0.0.1:$port/health" 2>&1)
    if [ $? -eq 0 ]; then
        echo "✅ Port $port: $response"
    else
        echo "❌ Port $port: No response"
    fi
done
'@

# 检查网络连接
Write-Header "6. Network Status"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP @'
echo "Listening ports:"
netstat -tuln | grep LISTEN || ss -tuln | grep LISTEN
echo ""
echo "Docker networks:"
docker network ls
'@

# 检查环境变量
Write-Header "7. Environment Check"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP @'
cd /opt/gulf-property
if [ -f .env ]; then
    echo "✅ .env file exists"
    echo "Environment variables (excluding secrets):"
    grep -E '^(PORT|NODE_ENV|DB_HOST|CORS_ORIGIN)=' .env | sed 's/=.*/=***/'
else
    echo "❌ .env file not found!"
fi
'@

# 检查磁盘空间
Write-Header "8. Disk Space"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP 'df -h'

# 检查数据库连接
Write-Header "9. Database Connectivity"
ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no root@$ServerIP @'
cd /opt/gulf-property
if [ -f .env ]; then
    DB_HOST=$(grep '^DB_HOST=' .env | cut -d '=' -f 2 | tr -d '\r')
    DB_PORT=$(grep '^DB_PORT=' .env | cut -d '=' -f 2 | tr -d '\r' || echo "5432")
    echo "Testing connection to: $DB_HOST:$DB_PORT"
    timeout 5 bash -c "cat < /dev/null > /dev/tcp/$DB_HOST/$DB_PORT" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✅ Database port is reachable"
    else
        echo "❌ Cannot reach database at $DB_HOST:$DB_PORT"
    fi
fi
'@

Write-Host "`n" 
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Diagnosis Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To view live logs, run:" -ForegroundColor Yellow
Write-Host "  ssh -i $SSH_KEY_PATH root@$ServerIP 'docker logs gulf-property-api -f'" -ForegroundColor White
Write-Host ""
Write-Host "To restart the container:" -ForegroundColor Yellow
Write-Host "  ssh -i $SSH_KEY_PATH root@$ServerIP 'cd /opt/gulf-property && docker compose restart'" -ForegroundColor White
Write-Host ""
Write-Host "To access the container:" -ForegroundColor Yellow
Write-Host "  ssh -i $SSH_KEY_PATH root@$ServerIP 'docker exec -it gulf-property-api /bin/sh'" -ForegroundColor White
Write-Host ""
