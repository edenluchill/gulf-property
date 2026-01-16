#Requires -Version 5.1

<#
.SYNOPSIS
    Clean up old LangGraph job outputs
    
.DESCRIPTION
    Removes old job directories from uploads/langgraph-output
    Keeps the most recent N jobs (default: 3)
    
.PARAMETER KeepRecent
    Number of recent jobs to keep (default: 3)
    
.PARAMETER DryRun
    Show what would be deleted without actually deleting
    
.EXAMPLE
    .\cleanup-old-jobs.ps1
    
.EXAMPLE
    .\cleanup-old-jobs.ps1 -KeepRecent 5
    
.EXAMPLE
    .\cleanup-old-jobs.ps1 -DryRun
#>

param(
    [int]$KeepRecent = 3,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "🧹 LangGraph Job Cleanup" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

# Check if running in Docker or local
$isDocker = Test-Path "/.dockerenv"
$uploadsDir = if ($isDocker) { "/app/uploads/langgraph-output" } else { "uploads/langgraph-output" }

if (-not (Test-Path $uploadsDir)) {
    Write-Host "❌ Directory not found: $uploadsDir" -ForegroundColor Red
    exit 1
}

# Get all job directories
$jobDirs = Get-ChildItem -Path $uploadsDir -Directory -Filter "job_*" | Sort-Object CreationTime -Descending

$totalJobs = $jobDirs.Count
Write-Host "📁 Found $totalJobs job directories" -ForegroundColor Yellow

if ($totalJobs -le $KeepRecent) {
    Write-Host "✅ All jobs are recent (keeping $totalJobs jobs)" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# Calculate what to delete
$toKeep = $jobDirs | Select-Object -First $KeepRecent
$toDelete = $jobDirs | Select-Object -Skip $KeepRecent

Write-Host ""
Write-Host "Keeping (most recent $KeepRecent):" -ForegroundColor Green
$toKeep | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "  ✓ $($_.Name) - $([math]::Round($size, 2)) MB" -ForegroundColor Green
}

Write-Host ""
Write-Host "Will delete ($($toDelete.Count) old jobs):" -ForegroundColor Yellow
$totalSize = 0
$toDelete | ForEach-Object {
    $size = (Get-ChildItem $_.FullName -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    $totalSize += $size
    Write-Host "  ✗ $($_.Name) - $([math]::Round($size, 2)) MB" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Total space to free: $([math]::Round($totalSize, 2)) MB" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host ""
    Write-Host "🔍 DRY RUN - No files deleted" -ForegroundColor Cyan
    Write-Host "Run without -DryRun to actually delete" -ForegroundColor Yellow
    exit 0
}

# Confirm deletion
Write-Host ""
$confirmation = Read-Host "Delete these $($toDelete.Count) old jobs? (yes/no)"

if ($confirmation -ne 'yes') {
    Write-Host "❌ Cancelled" -ForegroundColor Yellow
    exit 0
}

# Delete old jobs
Write-Host ""
Write-Host "Deleting..." -ForegroundColor Yellow
$deleted = 0
$toDelete | ForEach-Object {
    try {
        Remove-Item $_.FullName -Recurse -Force
        Write-Host "  ✓ Deleted: $($_.Name)" -ForegroundColor Green
        $deleted++
    } catch {
        Write-Host "  ✗ Failed: $($_.Name) - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ Cleanup complete!" -ForegroundColor Green
Write-Host "   Deleted: $deleted jobs" -ForegroundColor White
Write-Host "   Freed: $([math]::Round($totalSize, 2)) MB" -ForegroundColor White
Write-Host ""
