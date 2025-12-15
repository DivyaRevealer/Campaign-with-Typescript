#!/bin/bash
# Automated setup script for Campaign Dashboard Optimization (Linux/Mac)

echo "============================================================"
echo "Campaign Dashboard Optimization - Automated Setup"
echo "============================================================"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed"
    exit 1
fi

echo "[1/3] Installing Python dependencies..."
pip3 install redis>=5.0.0 || {
    echo "WARNING: Failed to install redis. Continuing anyway..."
    echo "(Redis is optional - API works without it)"
}

echo ""
echo "[2/3] Creating database indexes..."
python3 scripts/setup_dashboard_optimization.py || {
    echo "ERROR: Failed to create database indexes"
    exit 1
}

echo ""
echo "[3/3] Checking Redis server..."
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis server is running - caching will be enabled"
    else
        echo "⚠️  Redis server is not running"
        echo "To enable caching, start Redis:"
        echo "   redis-server"
        echo ""
        echo "The API will work without Redis (still optimized with indexes)"
    fi
else
    echo "⚠️  Redis CLI not found"
    echo "To enable caching, install Redis:"
    echo "   Ubuntu/Debian: sudo apt-get install redis-server"
    echo "   macOS: brew install redis"
    echo ""
    echo "The API will work without Redis (still optimized with indexes)"
fi

echo ""
echo "============================================================"
echo "Setup Complete!"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Restart your FastAPI server"
echo "  2. Test the dashboard endpoint"
echo ""

