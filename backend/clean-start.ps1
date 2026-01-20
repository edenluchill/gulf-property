# 彻底清理并启动后端服务
# 解决缓存和端口占用问题

$PORT = 3000

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  清理并启动后端服务" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: 杀掉端口占用
Write-Host "[1/4] 检查端口 $PORT..." -ForegroundColor Yellow
$process = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1
if ($process) {
    Write-Host "      发现进程 $process 占用端口，正在终止..." -ForegroundColor Yellow
    Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "      ✓ 端口已清理" -ForegroundColor Green
} else {
    Write-Host "      ✓ 端口可用" -ForegroundColor Green
}
Write-Host ""

# Step 2: 删除 dist 目录（清除旧的编译缓存）
Write-Host "[2/4] 清理编译缓存..." -ForegroundColor Yellow
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
    Write-Host "      ✓ 已删除 dist 目录" -ForegroundColor Green
} else {
    Write-Host "      ✓ 无缓存需要清理" -ForegroundColor Green
}
Write-Host ""

# Step 3: 重新编译（可选，但推荐）
Write-Host "[3/4] 重新编译 TypeScript..." -ForegroundColor Yellow
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "      ✓ 编译成功" -ForegroundColor Green
} else {
    Write-Host "      ⚠ 编译有警告（将使用 ts-node 直接运行）" -ForegroundColor Yellow
}
Write-Host ""

# Step 4: 启动开发服务器
Write-Host "[4/4] 启动开发服务器..." -ForegroundColor Yellow
Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "  🚀 服务器启动中..." -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""

# 直接运行 ts-node-dev，不编译，直接从源码运行
& npx ts-node-dev --respawn --transpile-only --clear src/index.ts
