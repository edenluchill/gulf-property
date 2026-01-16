#Requires -Version 5.1

<#
.SYNOPSIS
    Test PDF to Image Conversion Locally
#>

$ErrorActionPreference = "Stop"

Write-Host "Testing PDF Conversion Dependencies" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check GraphicsMagick
Write-Host "Checking GraphicsMagick..." -ForegroundColor Yellow
try {
    $gmPath = Get-Command gm -ErrorAction SilentlyContinue | Where-Object { $_.Source -match "GraphicsMagick" }
    if ($gmPath) {
        $version = & gm version | Select-String "GraphicsMagick" | Select-Object -First 1
        Write-Host "✅ GraphicsMagick installed: $version" -ForegroundColor Green
        $gmInstalled = $true
    } else {
        Write-Host "❌ GraphicsMagick not found" -ForegroundColor Red
        $gmInstalled = $false
    }
} catch {
    Write-Host "❌ GraphicsMagick not found" -ForegroundColor Red
    $gmInstalled = $false
}

# Check ImageMagick
Write-Host "Checking ImageMagick..." -ForegroundColor Yellow
try {
    $magick = Get-Command magick -ErrorAction SilentlyContinue
    if ($magick) {
        $version = & magick --version | Select-String "Version:" | Select-Object -First 1
        Write-Host "✅ ImageMagick installed: $version" -ForegroundColor Green
        $imInstalled = $true
    } else {
        Write-Host "❌ ImageMagick not found" -ForegroundColor Red
        $imInstalled = $false
    }
} catch {
    Write-Host "❌ ImageMagick not found" -ForegroundColor Red
    $imInstalled = $false
}

Write-Host ""

if (-not $gmInstalled -and -not $imInstalled) {
    Write-Host "⚠️  PDF 转图片功能无法使用！" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "需要安装 GraphicsMagick 或 ImageMagick：" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "选项 1：GraphicsMagick (推荐)" -ForegroundColor Green
    Write-Host "  下载：http://www.graphicsmagick.org/download.html"
    Write-Host "  或使用 Chocolatey："
    Write-Host "    choco install graphicsmagick" -ForegroundColor White
    Write-Host ""
    Write-Host "选项 2：ImageMagick" -ForegroundColor Green
    Write-Host "  下载：https://imagemagick.org/script/download.php#windows"
    Write-Host "  或使用 Chocolatey："
    Write-Host "    choco install imagemagick" -ForegroundColor White
    Write-Host ""
    Write-Host "安装后重启 PowerShell/Terminal 并重新测试" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "或者使用 Docker 开发（已配置好所有依赖）：" -ForegroundColor Cyan
    Write-Host "  .\test-docker-local.ps1" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "✅ PDF 转换依赖已就绪！" -ForegroundColor Green
Write-Host ""

# Test with a sample PDF if exists
$samplePDF = "test-sample.pdf"
if (Test-Path $samplePDF) {
    Write-Host "测试 PDF 转换..." -ForegroundColor Yellow
    
    # Simple Node.js test
    $testScript = @"
const { fromPath } = require('pdf2pic');
const path = require('path');

(async () => {
  try {
    const options = {
      density: 100,
      saveFilename: 'test-output',
      savePath: './uploads/tmp-test',
      format: 'png',
      width: 600,
      height: 800
    };

    const convert = fromPath('$samplePDF', options);
    const result = await convert(1, { responseType: 'image' });
    
    if (result && result.path) {
      console.log('✅ PDF 转换成功！');
      console.log('输出文件：' + result.path);
    } else {
      console.log('❌ 转换失败');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 错误：', error.message);
    process.exit(1);
  }
})();
"@
    
    $testScript | Out-File -FilePath "test-pdf-temp.js" -Encoding utf8
    node test-pdf-temp.js
    Remove-Item test-pdf-temp.js -ErrorAction SilentlyContinue
} else {
    Write-Host "💡 创建一个 test-sample.pdf 文件来测试转换功能" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "现在可以启动后端：" -ForegroundColor Green
Write-Host "  npm run dev" -ForegroundColor White
Write-Host ""
