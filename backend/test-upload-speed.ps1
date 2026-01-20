# Test Upload Speed
# 测试上传速度和进度跟踪

param(
    [string]$ApiUrl = "https://api.gulf-property.com",
    [string]$TestFile = ""
)

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "PDF Upload Speed Test" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if test file provided
if (-not $TestFile) {
    Write-Host "Usage: .\test-upload-speed.ps1 -TestFile 'path/to/test.pdf'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Green
    Write-Host "  .\test-upload-speed.ps1 -TestFile 'C:\Users\Desktop\test.pdf'" -ForegroundColor Green
    Write-Host "  .\test-upload-speed.ps1 -ApiUrl 'http://localhost:3000' -TestFile 'test.pdf'" -ForegroundColor Green
    exit
}

# Check if file exists
if (-not (Test-Path $TestFile)) {
    Write-Host "Error: File not found: $TestFile" -ForegroundColor Red
    exit
}

$fileInfo = Get-Item $TestFile
$fileSizeMB = [math]::Round($fileInfo.Length / 1MB, 2)

Write-Host "Test Configuration:" -ForegroundColor White
Write-Host "  API URL: $ApiUrl" -ForegroundColor Gray
Write-Host "  Test File: $TestFile" -ForegroundColor Gray
Write-Host "  File Size: $fileSizeMB MB" -ForegroundColor Gray
Write-Host ""

# Prepare multipart form data
$boundary = [System.Guid]::NewGuid().ToString()
$fileBytes = [System.IO.File]::ReadAllBytes($TestFile)

# Create multipart content
$bodyLines = @(
    "--$boundary",
    "Content-Disposition: form-data; name=`"files`"; filename=`"$($fileInfo.Name)`"",
    "Content-Type: application/pdf",
    "",
    [System.Text.Encoding]::GetEncoding("iso-8859-1").GetString($fileBytes),
    "--$boundary--"
)

$body = $bodyLines -join "`r`n"

Write-Host "Starting upload test..." -ForegroundColor Yellow
Write-Host ""

$startTime = Get-Date

try {
    # Upload file
    $uri = "$ApiUrl/api/langgraph-progress/start"
    
    Write-Host "Uploading to: $uri" -ForegroundColor Cyan
    
    $response = Invoke-WebRequest -Uri $uri `
        -Method POST `
        -ContentType "multipart/form-data; boundary=$boundary" `
        -Body ([System.Text.Encoding]::GetEncoding("iso-8859-1").GetBytes($body)) `
        -TimeoutSec 300
    
    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalSeconds
    
    Write-Host ""
    Write-Host "==================================" -ForegroundColor Green
    Write-Host "Upload Successful!" -ForegroundColor Green
    Write-Host "==================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Results:" -ForegroundColor White
    Write-Host "  Duration: $([math]::Round($duration, 2)) seconds" -ForegroundColor Gray
    Write-Host "  Speed: $([math]::Round($fileSizeMB / $duration, 2)) MB/s" -ForegroundColor Gray
    Write-Host "  Response Code: $($response.StatusCode)" -ForegroundColor Gray
    Write-Host ""
    
    $responseData = $response.Content | ConvertFrom-Json
    Write-Host "Response Data:" -ForegroundColor White
    Write-Host "  Job ID: $($responseData.jobId)" -ForegroundColor Gray
    Write-Host "  Message: $($responseData.message)" -ForegroundColor Gray
    Write-Host ""
    
    # Performance rating
    $uploadSpeed = $fileSizeMB / $duration
    if ($uploadSpeed -gt 1) {
        Write-Host "Performance: Excellent (>1 MB/s)" -ForegroundColor Green
    } elseif ($uploadSpeed -gt 0.5) {
        Write-Host "Performance: Good (0.5-1 MB/s)" -ForegroundColor Yellow
    } else {
        Write-Host "Performance: Slow (<0.5 MB/s)" -ForegroundColor Red
        Write-Host "Consider implementing R2 direct upload for better performance" -ForegroundColor Yellow
    }
    
} catch {
    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalSeconds
    
    Write-Host ""
    Write-Host "==================================" -ForegroundColor Red
    Write-Host "Upload Failed!" -ForegroundColor Red
    Write-Host "==================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Error Details:" -ForegroundColor White
    Write-Host "  Duration: $([math]::Round($duration, 2)) seconds" -ForegroundColor Gray
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
}

Write-Host ""
Write-Host "Test completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
