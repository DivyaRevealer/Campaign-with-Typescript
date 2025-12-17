# Campaign Dashboard Deployment Script - Windows PowerShell
###############################################################################
# This script automates the complete deployment of the Campaign Dashboard
# including database optimization, Redis setup, and verification
###############################################################################

# Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path $ScriptDir "deployment.log"

# Functions
function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Blue
    Write-Host "  $Message" -ForegroundColor Blue
    Write-Host "============================================================" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
    Add-Content -Path $LogFile -Value "$(Get-Date): SUCCESS - $Message"
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
    Add-Content -Path $LogFile -Value "$(Get-Date): ERROR - $Message"
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
    Add-Content -Path $LogFile -Value "$(Get-Date): WARNING - $Message"
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor Cyan
    Add-Content -Path $LogFile -Value "$(Get-Date): INFO - $Message"
}

# Load environment variables
function Load-Environment {
    $EnvFile = Join-Path $ScriptDir ".env"
    if (Test-Path $EnvFile) {
        Get-Content $EnvFile | ForEach-Object {
            if ($_ -match '^\s*([^#][^=]+)=(.+)$') {
                [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
            }
        }
        Write-Success "Environment variables loaded from .env"
    } else {
        Write-Warning-Custom ".env file not found, will prompt for configuration"
    }
}

# Get database credentials
function Get-DatabaseCredentials {
    $script:DB_HOST = $env:DB_HOST
    if (-not $DB_HOST) {
        $DB_HOST = Read-Host "Enter MySQL host [localhost]"
        if ([string]::IsNullOrEmpty($DB_HOST)) { $DB_HOST = "localhost" }
        $script:DB_HOST = $DB_HOST
    }
    
    $script:DB_USER = $env:DB_USER
    if (-not $DB_USER) {
        $script:DB_USER = Read-Host "Enter MySQL username"
    }
    
    $script:DB_PASSWORD = $env:DB_PASSWORD
    if (-not $DB_PASSWORD) {
        $SecurePassword = Read-Host "Enter MySQL password" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
        $script:DB_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    }
    
    $script:DB_NAME = $env:DB_NAME
    if (-not $DB_NAME) {
        $script:DB_NAME = Read-Host "Enter database name"
    }
}

# Check prerequisites
function Check-Prerequisites {
    Write-Header "Checking Prerequisites"
    
    # Check Python
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if ($Python) {
        $PythonVersion = & python --version
        Write-Success "Python installed: $PythonVersion"
    } else {
        Write-Error-Custom "Python not found. Please install Python 3.8+"
        exit 1
    }
    
    # Check pip
    $Pip = Get-Command pip -ErrorAction SilentlyContinue
    if ($Pip) {
        Write-Success "pip is installed"
    } else {
        Write-Error-Custom "pip not found. Please install pip"
        exit 1
    }
    
    # Check MySQL client
    $MySQL = Get-Command mysql -ErrorAction SilentlyContinue
    if ($MySQL) {
        $MySQLVersion = & mysql --version
        Write-Success "MySQL client installed: $MySQLVersion"
    } else {
        Write-Error-Custom "MySQL client not found. Please install MySQL client or add to PATH"
        Write-Info "Download from: https://dev.mysql.com/downloads/installer/"
        exit 1
    }
    
    # Check SQL file (TCM table)
    $SQLFile = Join-Path $ScriptDir "database_indexes_campaign_dashboard_tcm.sql"
    if (Test-Path $SQLFile) {
        Write-Success "Database indexes SQL file for crm_analysis_tcm found"
    } elseif (Test-Path (Join-Path $ScriptDir "scripts\create_tcm_indexes.py")) {
        Write-Success "Python script for creating TCM indexes found"
    } else {
        Write-Warning-Custom "database_indexes_campaign_dashboard_tcm.sql not found, will try Python script"
    }
}

# Install Python dependencies
function Install-Dependencies {
    Write-Header "Installing Python Dependencies"
    
    Push-Location $ScriptDir
    
    $RequirementsFile = Join-Path $ScriptDir "requirements.txt"
    if (Test-Path $RequirementsFile) {
        Write-Info "Installing packages from requirements.txt..."
        pip install -r requirements.txt
        Write-Success "Python dependencies installed"
    } else {
        Write-Error-Custom "requirements.txt not found"
        exit 1
    }
    
    Pop-Location
}

# Create database indexes
function Create-DatabaseIndexes {
    Write-Header "Creating Database Indexes"
    
    Write-Info "Connecting to database: $DB_NAME on $DB_HOST"
    Write-Info "This may take 2-5 minutes depending on data size..."
    
    # Test connection
    $TestConnection = "USE $DB_NAME;"
    echo $TestConnection | mysql -h $DB_HOST -u $DB_USER -p"$DB_PASSWORD" 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Database connection successful"
    } else {
        Write-Error-Custom "Cannot connect to database. Check credentials."
        exit 1
    }
    
    # Check existing indexes for crm_analysis_tcm (the table we're using)
    $CheckIndexesQuery = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'crm_analysis_tcm' AND INDEX_NAME LIKE 'idx_crm_tcm_%';"
    $ExistingIndexes = echo $CheckIndexesQuery | mysql -h $DB_HOST -u $DB_USER -p"$DB_PASSWORD" -D $DB_NAME -s -N 2>$null
    
    if ([int]$ExistingIndexes -gt 0) {
        Write-Warning-Custom "Found $ExistingIndexes existing indexes on crm_analysis_tcm"
        $Recreate = Read-Host "Do you want to recreate them? (y/N)"
        if ($Recreate -ne 'y' -and $Recreate -ne 'Y') {
            Write-Info "Skipping index creation"
            return
        }
    }
    
    # Apply indexes for crm_analysis_tcm (the table currently in use)
    $SQLFile = Join-Path $ScriptDir "database_indexes_campaign_dashboard_tcm.sql"
    if (Test-Path $SQLFile) {
        Write-Info "Creating indexes on crm_analysis_tcm table..."
        Get-Content $SQLFile | mysql -h $DB_HOST -u $DB_USER -p"$DB_PASSWORD" $DB_NAME 2>&1 | Tee-Object -Append -FilePath $LogFile
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Database indexes created successfully on crm_analysis_tcm"
            
            # Verify indexes
            $IndexCount = echo $CheckIndexesQuery | mysql -h $DB_HOST -u $DB_USER -p"$DB_PASSWORD" -D $DB_NAME -s -N 2>$null
            Write-Success "Total indexes created on crm_analysis_tcm: $IndexCount"
        } else {
            Write-Error-Custom "Failed to create database indexes on crm_analysis_tcm"
            exit 1
        }
    } else {
        Write-Warning-Custom "database_indexes_campaign_dashboard_tcm.sql not found, trying Python script..."
        # Fallback to Python script
        Push-Location $ScriptDir
        python scripts/create_tcm_indexes.py 2>&1 | Tee-Object -Append -FilePath $LogFile
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Indexes created via Python script"
        } else {
            Write-Error-Custom "Failed to create indexes. Please run manually: python scripts/create_tcm_indexes.py"
            exit 1
        }
        Pop-Location
    }
}

# Setup Redis
function Setup-Redis {
    Write-Header "Redis Setup (Optional)"
    
    $InstallRedis = Read-Host "Do you want to install/configure Redis for caching? (Y/n)"
    if ([string]::IsNullOrEmpty($InstallRedis)) { $InstallRedis = 'Y' }
    
    if ($InstallRedis -ne 'Y' -and $InstallRedis -ne 'y') {
        Write-Info "Skipping Redis setup. Dashboard will work without caching."
        return
    }
    
    # Check if Redis is installed
    $RedisPath = "C:\Program Files\Redis\redis-server.exe"
    if (Test-Path $RedisPath) {
        Write-Success "Redis is installed at $RedisPath"
    } else {
        Write-Warning-Custom "Redis not found at $RedisPath"
        Write-Info "You can:"
        Write-Info "1. Download Redis from: https://github.com/microsoftarchive/redis/releases"
        Write-Info "2. Or use Docker: docker run -d -p 6379:6379 --name redis redis:latest"
        Write-Info "3. Or use WSL and install Redis in Linux"
        
        $UseDocker = Read-Host "Do you want to try starting Redis via Docker? (y/N)"
        if ($UseDocker -eq 'Y' -or $UseDocker -eq 'y') {
            $Docker = Get-Command docker -ErrorAction SilentlyContinue
            if ($Docker) {
                docker run -d -p 6379:6379 --name redis redis:latest
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "Redis started in Docker container"
                    Start-Sleep -Seconds 3
                } else {
                    Write-Warning-Custom "Failed to start Redis container"
                }
            } else {
                Write-Warning-Custom "Docker not found"
            }
        }
    }
    
    # Test Redis connection
    try {
        $RedisTest = & redis-cli ping 2>&1
        if ($RedisTest -eq "PONG") {
            Write-Success "Redis is running and responding"
        }
    } catch {
        Write-Warning-Custom "Redis is not responding. Dashboard will work without caching."
        Write-Info "To start Redis manually:"
        Write-Info "- Windows Service: net start Redis"
        Write-Info "- Direct: redis-server.exe"
        Write-Info "- Docker: docker start redis"
    }
    
    # Update .env
    $EnvFile = Join-Path $ScriptDir ".env"
    if (Test-Path $EnvFile) {
        $EnvContent = Get-Content $EnvFile -Raw
        if ($EnvContent -notmatch "REDIS_ENABLED") {
            Add-Content -Path $EnvFile -Value "`n# Redis Configuration"
            Add-Content -Path $EnvFile -Value "REDIS_HOST=localhost"
            Add-Content -Path $EnvFile -Value "REDIS_PORT=6379"
            Add-Content -Path $EnvFile -Value "REDIS_DB=0"
            Add-Content -Path $EnvFile -Value "REDIS_ENABLED=true"
            Write-Success "Redis configuration added to .env"
        }
    }
}

# Verify router configuration
function Verify-Router {
    Write-Header "Verifying Backend Configuration"
    
    $MainPy = Join-Path $ScriptDir "app\main.py"
    if (Test-Path $MainPy) {
        $Content = Get-Content $MainPy -Raw
        if ($Content -match "campaign_dashboard_optimized") {
            Write-Success "Using optimized dashboard router"
        } else {
            Write-Warning-Custom "Not using optimized router!"
            Write-Info "Updating main.py to use optimized router..."
            
            # Backup
            Copy-Item $MainPy "$MainPy.backup"
            
            # Update
            $Content = $Content -replace "from app\.api\.routes\.campaign_dashboard import router", "from app.api.routes.campaign_dashboard_optimized import router"
            Set-Content -Path $MainPy -Value $Content
            
            $UpdatedContent = Get-Content $MainPy -Raw
            if ($UpdatedContent -match "campaign_dashboard_optimized") {
                Write-Success "Router updated successfully"
            } else {
                Write-Error-Custom "Failed to update router automatically"
                Write-Info "Please manually update app/main.py"
            }
        }
    } else {
        Write-Warning-Custom "app\main.py not found"
    }
}

# Generate deployment report
function Generate-Report {
    Write-Header "Deployment Summary"
    
    $ReportFile = Join-Path $ScriptDir "deployment_report.txt"
    
    $Report = @"
═══════════════════════════════════════════════════════════
Campaign Dashboard Deployment Report
═══════════════════════════════════════════════════════════
Date: $(Get-Date)
Server: $env:COMPUTERNAME
User: $env:USERNAME

DATABASE CONFIGURATION
───────────────────────────────────────────────────────────
Host: $DB_HOST
Database: $DB_NAME
User: $DB_USER

DEPLOYMENT STATUS
───────────────────────────────────────────────────────────
"@
    
    # Check indexes for crm_analysis_tcm
    $CheckIndexesQuery = "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'crm_analysis_tcm' AND INDEX_NAME LIKE 'idx_crm_tcm_%';"
    $IndexCount = echo $CheckIndexesQuery | mysql -h $DB_HOST -u $DB_USER -p"$DB_PASSWORD" -D $DB_NAME -s -N 2>$null
    $Report += "✓ Database Indexes (crm_analysis_tcm): $IndexCount created`n"
    
    # Check Python packages
    $RedisPackage = pip show redis 2>&1
    if ($LASTEXITCODE -eq 0) {
        $Report += "✓ Redis Python package: Installed`n"
    } else {
        $Report += "✗ Redis Python package: Not installed`n"
    }
    
    # Check Redis server
    try {
        $RedisTest = & redis-cli ping 2>&1
        if ($RedisTest -eq "PONG") {
            $Report += "✓ Redis Server: Running`n"
        } else {
            $Report += "⚠ Redis Server: Not running (optional)`n"
        }
    } catch {
        $Report += "⚠ Redis Server: Not running (optional)`n"
    }
    
    # Check router
    $MainPy = Join-Path $ScriptDir "app\main.py"
    if (Test-Path $MainPy) {
        $Content = Get-Content $MainPy -Raw
        if ($Content -match "campaign_dashboard_optimized") {
            $Report += "✓ Backend Router: Using optimized version`n"
        } else {
            $Report += "⚠ Backend Router: Check configuration`n"
        }
    }
    
    $Report += @"

NEXT STEPS
───────────────────────────────────────────────────────────
1. Start the backend server:
   cd backend
   python -m uvicorn app.main:app --reload

2. Start the frontend (in another terminal):
   cd frontend
   npm run dev

3. Access the dashboard:
   http://localhost:3000/campaign/dashboard

4. Expected Performance:
   - First load: 3-10 seconds (uncached)
   - Cached load: <100ms (if Redis is enabled)

MONITORING
───────────────────────────────────────────────────────────
- Check logs: $LogFile
- Monitor Redis: redis-cli monitor
- Database performance: SHOW INDEX FROM crm_analysis_tcm;

TROUBLESHOOTING
───────────────────────────────────────────────────────────
If dashboard is slow:
  - Verify indexes: SHOW INDEX FROM crm_analysis_tcm;
  - Check Redis: redis-cli ping
  - Review logs: $LogFile

If Redis errors occur:
  - Dashboard works without Redis (just slower)
  - Start Redis: net start Redis (or redis-server.exe)
  - Or use Docker: docker start redis

═══════════════════════════════════════════════════════════
Deployment completed successfully!
═══════════════════════════════════════════════════════════
"@
    
    Set-Content -Path $ReportFile -Value $Report
    Write-Host $Report
    Write-Success "Deployment report saved to: $ReportFile"
}

# Test dashboard
function Test-Dashboard {
    Write-Header "Testing Dashboard"
    
    $TestServer = Read-Host "Do you want to start the server and test? (Y/n)"
    if ([string]::IsNullOrEmpty($TestServer)) { $TestServer = 'Y' }
    
    if ($TestServer -ne 'Y' -and $TestServer -ne 'y') {
        Write-Info "Skipping server test"
        return
    }
    
    Write-Info "Starting FastAPI server..."
    Write-Info "Server will run on http://localhost:8000"
    Write-Warning-Custom "Press Ctrl+C to stop the server"
    
    Push-Location $ScriptDir
    python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    Pop-Location
}

# Main execution
function Main {
    Clear-Host
    Write-Header "Campaign Dashboard Deployment"
    Write-Host "Starting deployment at $(Get-Date)"
    Write-Host "Logs will be saved to: $LogFile"
    Write-Host ""
    
    # Initialize log
    "═══════════════════════════════════════════════════════════" | Out-File $LogFile
    "Campaign Dashboard Deployment Log - $(Get-Date)" | Out-File $LogFile -Append
    "═══════════════════════════════════════════════════════════" | Out-File $LogFile -Append
    
    # Run deployment
    Load-Environment
    Get-DatabaseCredentials
    Check-Prerequisites
    Install-Dependencies
    Create-DatabaseIndexes
    Setup-Redis
    Verify-Router
    Generate-Report
    
    Write-Host ""
    Write-Success "Deployment completed successfully!"
    Write-Host ""
    
    Test-Dashboard
}

# Run
Main

