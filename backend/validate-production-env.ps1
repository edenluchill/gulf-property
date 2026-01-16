#Requires -Version 5.1

<#
.SYNOPSIS
    Validate production environment configuration
    
.DESCRIPTION
    Checks .env.production for required variables and common issues
    Run this before deployment to catch configuration problems early
    
.EXAMPLE
    .\validate-production-env.ps1
#>

$ErrorActionPreference = "Stop"

# Colors
function Write-Check {
    param([string]$Message)
    Write-Host "✓ " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Issue {
    param([string]$Message)
    Write-Host "✗ " -ForegroundColor Red -NoNewline
    Write-Host $Message -ForegroundColor Red
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $Message -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Gulf Property - Production Environment Validator" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Check if file exists
$ENV_FILE = ".env.production"
if (-not (Test-Path $ENV_FILE)) {
    Write-Issue "Production environment file not found: $ENV_FILE"
    Write-Host ""
    Write-Host "Create it from template:" -ForegroundColor Yellow
    Write-Host "  cp env.template .env.production" -ForegroundColor White
    Write-Host ""
    Write-Host "See: PRODUCTION-ENV-SETUP.md for details" -ForegroundColor Yellow
    exit 1
}

Write-Check "Found $ENV_FILE"

# Read file
$envContent = Get-Content $ENV_FILE -Raw
$issues = @()
$warnings = @()

# Required variables
$requiredVars = @(
    @{Name="PORT"; Pattern="PORT=\d+"; Description="Application port"},
    @{Name="NODE_ENV"; Pattern="NODE_ENV=production"; Description="Environment"},
    @{Name="DB_HOST"; Pattern="DB_HOST=.+"; Description="Database host"},
    @{Name="DB_PORT"; Pattern="DB_PORT=\d+"; Description="Database port"},
    @{Name="DB_NAME"; Pattern="DB_NAME=\w+"; Description="Database name"},
    @{Name="DB_USER"; Pattern="DB_USER=\w+"; Description="Database user"},
    @{Name="DB_PASSWORD"; Pattern="DB_PASSWORD=.+"; Description="Database password"},
    @{Name="GEMINI_API_KEY"; Pattern="GEMINI_API_KEY=.+"; Description="Gemini API key"},
    @{Name="CORS_ORIGIN"; Pattern="CORS_ORIGIN=https?://.+"; Description="Frontend URL"}
)

Write-Host ""
Write-Host "Checking required variables..." -ForegroundColor Cyan
Write-Host ""

foreach ($var in $requiredVars) {
    if ($envContent -match $var.Pattern) {
        Write-Check "$($var.Name) - $($var.Description)"
        
        # Extract value for additional checks
        if ($envContent -match "$($var.Name)=(.+)") {
            $value = $matches[1].Trim()
            
            # Check for placeholder values
            $placeholders = @(
                "your-", "your_", "CHANGE", "TODO", "FIXME", "REPLACE",
                "example.com", "localhost", "127.0.0.1"
            )
            
            foreach ($placeholder in $placeholders) {
                if ($value -match $placeholder) {
                    if ($var.Name -eq "DB_HOST" -and $value -match "localhost|127\.0\.0\.1") {
                        $warnings += "$($var.Name) is set to localhost - ensure this is accessible from Hetzner"
                    } else {
                        $issues += "$($var.Name) appears to contain placeholder: $value"
                    }
                    break
                }
            }
            
            # Specific checks
            switch ($var.Name) {
                "DB_PASSWORD" {
                    if ($value.Length -lt 12) {
                        $warnings += "DB_PASSWORD is short (< 12 chars) - consider using a longer password"
                    }
                    if ($value -match "^(password|admin|root|123)") {
                        $issues += "DB_PASSWORD appears to be weak"
                    }
                }
                "CORS_ORIGIN" {
                    if ($value -match "localhost|127\.0\.0\.1") {
                        $warnings += "CORS_ORIGIN is localhost - update with production frontend URL"
                    }
                }
                "GEMINI_API_KEY" {
                    if ($value.Length -lt 20) {
                        $issues += "GEMINI_API_KEY appears to be invalid (too short)"
                    }
                }
                "NODE_ENV" {
                    if ($value -ne "production") {
                        $warnings += "NODE_ENV is not 'production' - this may affect performance"
                    }
                }
            }
        }
    } else {
        $issues += "Missing or invalid: $($var.Name) - $($var.Description)"
    }
}

# Check file permissions (on Unix-like systems)
if ($IsLinux -or $IsMacOS) {
    $perms = (Get-Item $ENV_FILE).UnixMode
    if ($perms -match "....rw") {
        $warnings += "File permissions too open - run: chmod 600 $ENV_FILE"
    }
}

# Optional but recommended variables
Write-Host ""
Write-Host "Checking optional variables..." -ForegroundColor Cyan
Write-Host ""

$optionalVars = @(
    @{Name="CLOUDINARY_CLOUD_NAME"; Description="Cloudinary (recommended for production)"},
    @{Name="CLOUDINARY_API_KEY"; Description="Cloudinary API key"},
    @{Name="CLOUDINARY_API_SECRET"; Description="Cloudinary API secret"},
    @{Name="LOG_LEVEL"; Description="Logging level"},
    @{Name="API_RATE_LIMIT_WINDOW_MS"; Description="Rate limiting"},
    @{Name="API_RATE_LIMIT_MAX_REQUESTS"; Description="Rate limiting"}
)

foreach ($var in $optionalVars) {
    if ($envContent -match "$($var.Name)=.+") {
        Write-Check "$($var.Name) - $($var.Description)"
    } else {
        Write-Warning-Custom "$($var.Name) not set - $($var.Description)"
    }
}

# Check for common issues
Write-Host ""
Write-Host "Additional checks..." -ForegroundColor Cyan
Write-Host ""

# Check for Windows line endings
if ($envContent -match "`r`n") {
    Write-Warning-Custom "File contains Windows line endings (CRLF) - this is OK but Unix (LF) is preferred"
}

# Check for spaces around =
if ($envContent -match "\w+\s*=\s*.+") {
    Write-Check "No spaces around = signs (good)"
}

# Check for quotes
$quotedLines = ($envContent -split "`n" | Where-Object { $_ -match '=".*"' }).Count
if ($quotedLines -gt 0) {
    Write-Warning-Custom "Found $quotedLines variables with quoted values - usually not needed"
}

# Check for comments
$commentLines = ($envContent -split "`n" | Where-Object { $_ -match "^\s*#" }).Count
if ($commentLines -gt 5) {
    Write-Check "Contains helpful comments"
}

# Summary
Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

$hasIssues = $issues.Count -gt 0
$hasWarnings = $warnings.Count -gt 0

if ($hasIssues) {
    Write-Host "❌ ISSUES FOUND ($($issues.Count)):" -ForegroundColor Red
    Write-Host ""
    foreach ($issue in $issues) {
        Write-Host "  • $issue" -ForegroundColor Red
    }
    Write-Host ""
}

if ($hasWarnings) {
    Write-Host "⚠ WARNINGS ($($warnings.Count)):" -ForegroundColor Yellow
    Write-Host ""
    foreach ($warning in $warnings) {
        Write-Host "  • $warning" -ForegroundColor Yellow
    }
    Write-Host ""
}

if (-not $hasIssues -and -not $hasWarnings) {
    Write-Host "✅ All checks passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your production environment is configured correctly." -ForegroundColor White
    Write-Host "Ready to deploy!" -ForegroundColor Green
    Write-Host ""
} elseif (-not $hasIssues) {
    Write-Host "✅ No critical issues found" -ForegroundColor Green
    Write-Host ""
    Write-Host "Warnings are advisory - review them before deploying." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "❌ Please fix the issues above before deploying" -ForegroundColor Red
    Write-Host ""
    Write-Host "See: PRODUCTION-ENV-SETUP.md for configuration help" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Connectivity tests (optional)
Write-Host "Would you like to test database connectivity? (requires psql)" -ForegroundColor Cyan
$testDb = Read-Host "Test database connection? (yes/no)"

if ($testDb -eq "yes") {
    Write-Host ""
    Write-Host "Testing database connection..." -ForegroundColor Cyan
    
    # Extract DB vars
    if ($envContent -match "DB_HOST=(.+)") { $dbHost = $matches[1].Trim() }
    if ($envContent -match "DB_PORT=(.+)") { $dbPort = $matches[1].Trim() }
    if ($envContent -match "DB_NAME=(.+)") { $dbName = $matches[1].Trim() }
    if ($envContent -match "DB_USER=(.+)") { $dbUser = $matches[1].Trim() }
    if ($envContent -match "DB_PASSWORD=(.+)") { $dbPassword = $matches[1].Trim() }
    
    try {
        $env:PGPASSWORD = $dbPassword
        $result = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -c "SELECT version();" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Check "Database connection successful!"
        } else {
            Write-Issue "Database connection failed: $result"
        }
    } catch {
        Write-Warning-Custom "Could not test database (psql not installed?)"
    }
}

Write-Host ""
Write-Host "Validation complete!" -ForegroundColor Cyan
Write-Host ""

if (-not $hasIssues) {
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Review any warnings above" -ForegroundColor White
    Write-Host "  2. Run deployment: .\hetzner-deploy.ps1" -ForegroundColor White
    Write-Host "  3. See: QUICK-DEPLOY.md for deployment guide" -ForegroundColor White
}

Write-Host ""
