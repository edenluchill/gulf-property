# 更新地标照片URL到数据库
# 使用方法: .\update-landmark-images.ps1

Write-Host "🎨 Updating landmark images in database..." -ForegroundColor Cyan

# 检查docker-compose是否运行
$running = docker-compose ps -q db
if (-not $running) {
    Write-Host "❌ Database is not running. Starting docker-compose..." -ForegroundColor Red
    docker-compose up -d db
    Start-Sleep -Seconds 5
}

# 执行SQL更新
Write-Host "📝 Running SQL updates..." -ForegroundColor Yellow

docker-compose exec -T db psql -U postgres -d gulf_property -f - < UPDATE-LANDMARKS-IMAGES.sql

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Landmark images updated successfully!" -ForegroundColor Green
    
    # 显示统计
    Write-Host "`n📊 Statistics:" -ForegroundColor Cyan
    docker-compose exec -T db psql -U postgres -d gulf_property -c "SELECT COUNT(*) as total_landmarks, COUNT(image_url) as landmarks_with_images FROM dubai_landmarks;"
    
    # 清除前端缓存提示
    Write-Host "`n💡 Next steps:" -ForegroundColor Yellow
    Write-Host "1. Clear browser cache or visit http://localhost:5173/clear-cache.html" -ForegroundColor White
    Write-Host "2. Refresh the map page to see updated images" -ForegroundColor White
    Write-Host "3. Visit Editor page to manage landmarks" -ForegroundColor White
} else {
    Write-Host "❌ Failed to update images" -ForegroundColor Red
    exit 1
}
