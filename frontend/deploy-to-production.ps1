# Nextway Frontend - Production Deployment Script
# 此脚本用于构建和部署前端到生产环境

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('vercel', 'cloudflare', 'netlify', 'local')]
    [string]$Platform = 'vercel',
    
    [Parameter(Mandatory=$false)]
    [string]$ApiUrl = 'https://api.gulf-property.com'
)

$ErrorActionPreference = "Stop"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Nextway Frontend Deployment" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

# 检查 npm
try {
    $npmVersion = npm --version
    Write-Host "[OK] npm: v$npmVersion" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] npm not found." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Deployment Configuration:" -ForegroundColor Yellow
Write-Host "  Platform: $Platform" -ForegroundColor White
Write-Host "  API URL: $ApiUrl" -ForegroundColor White
Write-Host ""

# 确认继续
$confirm = Read-Host "Continue with deployment? (y/n)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "[1/5] Installing dependencies..." -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Failed to install dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "[2/5] Running linter..." -ForegroundColor Cyan
npm run lint --if-present
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Linter warnings found (continuing...)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3/5] Setting production environment..." -ForegroundColor Cyan

# 创建临时 .env.production 文件
$envContent = "VITE_API_URL=$ApiUrl"
$envContent | Out-File -FilePath ".env.production" -Encoding utf8 -Force
Write-Host "[OK] Environment configured" -ForegroundColor Green

Write-Host ""
Write-Host "[4/5] Building application..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Build failed" -ForegroundColor Red
    Remove-Item ".env.production" -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "[OK] Build completed" -ForegroundColor Green

Write-Host ""
Write-Host "[5/5] Deploying to $Platform..." -ForegroundColor Cyan

switch ($Platform) {
    'vercel' {
        # 检查 vercel CLI
        try {
            $null = Get-Command vercel -ErrorAction Stop
        } catch {
            Write-Host "[INFO] Installing Vercel CLI..." -ForegroundColor Yellow
            npm i -g vercel
        }
        
        Write-Host "[INFO] Deploying to Vercel..." -ForegroundColor Blue
        vercel --prod
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Deployed to Vercel" -ForegroundColor Green
            Write-Host ""
            Write-Host "Next steps:" -ForegroundColor Yellow
            Write-Host "  1. Go to Vercel Dashboard: https://vercel.com/dashboard" -ForegroundColor White
            Write-Host "  2. Settings -> Environment Variables" -ForegroundColor White
            Write-Host "  3. Add: VITE_API_URL = $ApiUrl" -ForegroundColor White
            Write-Host "  4. Settings -> Domains -> Add gulf-property.com" -ForegroundColor White
        } else {
            Write-Host "[FAIL] Vercel deployment failed" -ForegroundColor Red
            exit 1
        }
    }
    
    'cloudflare' {
        # 检查 wrangler CLI
        try {
            $null = Get-Command wrangler -ErrorAction Stop
        } catch {
            Write-Host "[INFO] Installing Wrangler CLI..." -ForegroundColor Yellow
            npm i -g wrangler
        }
        
        Write-Host "[INFO] Deploying to Cloudflare Pages..." -ForegroundColor Blue
        wrangler pages deploy dist --project-name=gulf-property
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Deployed to Cloudflare Pages" -ForegroundColor Green
            Write-Host ""
            Write-Host "Next steps:" -ForegroundColor Yellow
            Write-Host "  1. Go to Cloudflare Pages Dashboard" -ForegroundColor White
            Write-Host "  2. Settings -> Environment variables" -ForegroundColor White
            Write-Host "  3. Add: VITE_API_URL = $ApiUrl" -ForegroundColor White
            Write-Host "  4. Custom domains -> Add gulf-property.com" -ForegroundColor White
        } else {
            Write-Host "[FAIL] Cloudflare deployment failed" -ForegroundColor Red
            exit 1
        }
    }
    
    'netlify' {
        # 检查 netlify CLI
        try {
            $null = Get-Command netlify -ErrorAction Stop
        } catch {
            Write-Host "[INFO] Installing Netlify CLI..." -ForegroundColor Yellow
            npm i -g netlify-cli
        }
        
        Write-Host "[INFO] Deploying to Netlify..." -ForegroundColor Blue
        netlify deploy --prod --dir=dist
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Deployed to Netlify" -ForegroundColor Green
            Write-Host ""
            Write-Host "Next steps:" -ForegroundColor Yellow
            Write-Host "  1. Go to Netlify Dashboard" -ForegroundColor White
            Write-Host "  2. Site settings -> Environment variables" -ForegroundColor White
            Write-Host "  3. Add: VITE_API_URL = $ApiUrl" -ForegroundColor White
            Write-Host "  4. Domain settings -> Add gulf-property.com" -ForegroundColor White
        } else {
            Write-Host "[FAIL] Netlify deployment failed" -ForegroundColor Red
            exit 1
        }
    }
    
    'local' {
        Write-Host "[INFO] Local build completed" -ForegroundColor Blue
        Write-Host "[OK] Build artifacts in: dist/" -ForegroundColor Green
        Write-Host ""
        Write-Host "To deploy manually:" -ForegroundColor Yellow
        Write-Host "  1. Upload dist/ folder to your server" -ForegroundColor White
        Write-Host "  2. Configure nginx or Apache" -ForegroundColor White
        Write-Host "  3. Setup SSL certificate" -ForegroundColor White
    }
}

# 清理临时文件
Remove-Item ".env.production" -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Testing checklist:" -ForegroundColor Yellow
Write-Host "  [ ] Frontend loads at https://gulf-property.com" -ForegroundColor White
Write-Host "  [ ] API requests go to $ApiUrl" -ForegroundColor White
Write-Host "  [ ] Map displays correctly" -ForegroundColor White
Write-Host "  [ ] Search functionality works" -ForegroundColor White
Write-Host "  [ ] Property details page loads" -ForegroundColor White
Write-Host "  [ ] No CORS errors in console" -ForegroundColor White
Write-Host ""
