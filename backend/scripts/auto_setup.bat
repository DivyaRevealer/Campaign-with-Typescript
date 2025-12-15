@echo off
REM Automated setup script for Campaign Dashboard Optimization (Windows)

echo ============================================================
echo Campaign Dashboard Optimization - Automated Setup
echo ============================================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python and try again
    pause
    exit /b 1
)

echo [1/3] Installing Python dependencies...
pip install redis>=5.0.0
if errorlevel 1 (
    echo WARNING: Failed to install redis. Continuing anyway...
    echo (Redis is optional - API works without it)
)

echo.
echo [2/3] Creating database indexes...
python scripts/setup_dashboard_optimization.py
if errorlevel 1 (
    echo ERROR: Failed to create database indexes
    pause
    exit /b 1
)

echo.
echo [3/3] Checking Redis server...
redis-cli ping >nul 2>&1
if errorlevel 1 (
    echo WARNING: Redis server is not running
    echo To enable caching, start Redis:
    echo   1. Download from: https://github.com/microsoftarchive/redis/releases
    echo   2. Run redis-server.exe
    echo.
    echo The API will work without Redis (still optimized with indexes)
) else (
    echo Redis server is running - caching will be enabled
)

echo.
echo ============================================================
echo Setup Complete!
echo ============================================================
echo.
echo Next steps:
echo   1. Restart your FastAPI server
echo   2. Test the dashboard endpoint
echo.
pause

