#!/bin/bash
###############################################################################
# Campaign Dashboard Deployment Script - Linux/Mac
###############################################################################
# This script automates the complete deployment of the Campaign Dashboard
# including database optimization, Redis setup, and verification
###############################################################################

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/deployment.log"

# Functions
print_header() {
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
    echo "$(date): SUCCESS - $1" >> "$LOG_FILE"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
    echo "$(date): ERROR - $1" >> "$LOG_FILE"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    echo "$(date): WARNING - $1" >> "$LOG_FILE"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
    echo "$(date): INFO - $1" >> "$LOG_FILE"
}

# Load environment variables
load_env() {
    if [ -f "$SCRIPT_DIR/.env" ]; then
        export $(cat "$SCRIPT_DIR/.env" | grep -v '^#' | xargs)
        print_success "Environment variables loaded from .env"
    else
        print_warning ".env file not found, will prompt for configuration"
    fi
}

# Prompt for database credentials if not in .env
get_db_credentials() {
    if [ -z "$DB_HOST" ]; then
        read -p "Enter MySQL host [localhost]: " DB_HOST
        DB_HOST=${DB_HOST:-localhost}
    fi
    
    if [ -z "$DB_USER" ]; then
        read -p "Enter MySQL username: " DB_USER
    fi
    
    if [ -z "$DB_PASSWORD" ]; then
        read -sp "Enter MySQL password: " DB_PASSWORD
        echo
    fi
    
    if [ -z "$DB_NAME" ]; then
        read -p "Enter database name: " DB_NAME
    fi
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Python
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version)
        print_success "Python installed: $PYTHON_VERSION"
    else
        print_error "Python 3 not found. Please install Python 3.8+"
        exit 1
    fi
    
    # Check pip
    if command -v pip3 &> /dev/null; then
        print_success "pip3 is installed"
    else
        print_error "pip3 not found. Please install pip"
        exit 1
    fi
    
    # Check MySQL client
    if command -v mysql &> /dev/null; then
        MYSQL_VERSION=$(mysql --version)
        print_success "MySQL client installed: $MYSQL_VERSION"
    else
        print_error "MySQL client not found. Please install mysql-client"
        exit 1
    fi
    
    # Check if database indexes file exists (TCM table)
    if [ -f "$SCRIPT_DIR/database_indexes_campaign_dashboard_tcm.sql" ]; then
        print_success "Database indexes SQL file for crm_analysis_tcm found"
    elif [ -f "$SCRIPT_DIR/scripts/create_tcm_indexes.py" ]; then
        print_success "Python script for creating TCM indexes found"
    else
        print_warning "database_indexes_campaign_dashboard_tcm.sql not found, will try Python script"
    fi
}

# Install Python dependencies
install_dependencies() {
    print_header "Installing Python Dependencies"
    
    cd "$SCRIPT_DIR"
    
    if [ -f "requirements.txt" ]; then
        print_info "Installing packages from requirements.txt..."
        pip3 install -r requirements.txt
        print_success "Python dependencies installed"
    else
        print_error "requirements.txt not found"
        exit 1
    fi
}

# Create database indexes
create_indexes() {
    print_header "Creating Database Indexes"
    
    print_info "Connecting to database: $DB_NAME on $DB_HOST"
    print_info "This may take 2-5 minutes depending on data size..."
    
    # Test connection first
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -e "USE $DB_NAME;" 2>/dev/null
    if [ $? -eq 0 ]; then
        print_success "Database connection successful"
    else
        print_error "Cannot connect to database. Check credentials."
        exit 1
    fi
    
    # Check if indexes already exist for crm_analysis_tcm (the table we're using)
    EXISTING_INDEXES=$(mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -D "$DB_NAME" \
        -se "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'crm_analysis_tcm' AND INDEX_NAME LIKE 'idx_crm_tcm_%';" 2>/dev/null)
    
    if [ "$EXISTING_INDEXES" -gt 0 ]; then
        print_warning "Found $EXISTING_INDEXES existing indexes on crm_analysis_tcm"
        read -p "Do you want to recreate them? (y/N): " RECREATE
        if [[ ! $RECREATE =~ ^[Yy]$ ]]; then
            print_info "Skipping index creation"
            return
        fi
    fi
    
    # Apply indexes for crm_analysis_tcm (the table currently in use)
    if [ -f "$SCRIPT_DIR/database_indexes_campaign_dashboard_tcm.sql" ]; then
        print_info "Creating indexes on crm_analysis_tcm table..."
        mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$SCRIPT_DIR/database_indexes_campaign_dashboard_tcm.sql" 2>&1 | tee -a "$LOG_FILE"
        
        if [ $? -eq 0 ]; then
            print_success "Database indexes created successfully on crm_analysis_tcm"
            
            # Verify indexes
            INDEX_COUNT=$(mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -D "$DB_NAME" \
                -se "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'crm_analysis_tcm' AND INDEX_NAME LIKE 'idx_crm_tcm_%';" 2>/dev/null)
            print_success "Total indexes created on crm_analysis_tcm: $INDEX_COUNT"
        else
            print_error "Failed to create database indexes on crm_analysis_tcm"
            exit 1
        fi
    else
        print_warning "database_indexes_campaign_dashboard_tcm.sql not found, trying Python script..."
        # Fallback to Python script
        cd "$SCRIPT_DIR"
        python3 scripts/create_tcm_indexes.py 2>&1 | tee -a "$LOG_FILE"
        if [ $? -eq 0 ]; then
            print_success "Indexes created via Python script"
        else
            print_error "Failed to create indexes. Please run manually: python scripts/create_tcm_indexes.py"
            exit 1
        fi
    fi
}

# Install and configure Redis
setup_redis() {
    print_header "Redis Setup (Optional)"
    
    read -p "Do you want to install/configure Redis for caching? (Y/n): " INSTALL_REDIS
    INSTALL_REDIS=${INSTALL_REDIS:-Y}
    
    if [[ ! $INSTALL_REDIS =~ ^[Yy]$ ]]; then
        print_info "Skipping Redis setup. Dashboard will work without caching."
        return
    fi
    
    # Check if Redis is already installed
    if command -v redis-server &> /dev/null; then
        print_success "Redis is already installed"
    else
        print_info "Installing Redis..."
        
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            if command -v apt-get &> /dev/null; then
                sudo apt-get update
                sudo apt-get install -y redis-server
            elif command -v yum &> /dev/null; then
                sudo yum install -y redis
            else
                print_warning "Cannot auto-install Redis on this system"
                print_info "Please install Redis manually: https://redis.io/download"
                return
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            if command -v brew &> /dev/null; then
                brew install redis
            else
                print_warning "Homebrew not found. Please install Redis manually."
                return
            fi
        fi
    fi
    
    # Check if Redis is running
    redis-cli ping &> /dev/null
    if [ $? -eq 0 ]; then
        print_success "Redis is running"
    else
        print_info "Starting Redis..."
        
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            sudo systemctl start redis
            sudo systemctl enable redis
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            brew services start redis
        else
            redis-server --daemonize yes
        fi
        
        sleep 2
        
        redis-cli ping &> /dev/null
        if [ $? -eq 0 ]; then
            print_success "Redis started successfully"
        else
            print_warning "Could not start Redis automatically"
            print_info "Try manually: redis-server --daemonize yes"
        fi
    fi
    
    # Update .env with Redis configuration
    if [ -f "$SCRIPT_DIR/.env" ]; then
        if ! grep -q "REDIS_ENABLED" "$SCRIPT_DIR/.env"; then
            echo "" >> "$SCRIPT_DIR/.env"
            echo "# Redis Configuration" >> "$SCRIPT_DIR/.env"
            echo "REDIS_HOST=localhost" >> "$SCRIPT_DIR/.env"
            echo "REDIS_PORT=6379" >> "$SCRIPT_DIR/.env"
            echo "REDIS_DB=0" >> "$SCRIPT_DIR/.env"
            echo "REDIS_ENABLED=true" >> "$SCRIPT_DIR/.env"
            print_success "Redis configuration added to .env"
        fi
    fi
}

# Verify optimized router
verify_router() {
    print_header "Verifying Backend Configuration"
    
    if [ -f "$SCRIPT_DIR/app/main.py" ]; then
        if grep -q "campaign_dashboard_optimized" "$SCRIPT_DIR/app/main.py"; then
            print_success "Using optimized dashboard router"
        else
            print_warning "Not using optimized router!"
            print_info "Updating main.py to use optimized router..."
            
            # Backup main.py
            cp "$SCRIPT_DIR/app/main.py" "$SCRIPT_DIR/app/main.py.backup"
            
            # Update import
            sed -i.bak 's/from app.api.routes.campaign_dashboard import router/from app.api.routes.campaign_dashboard_optimized import router/g' "$SCRIPT_DIR/app/main.py"
            
            if grep -q "campaign_dashboard_optimized" "$SCRIPT_DIR/app/main.py"; then
                print_success "Router updated successfully"
                rm "$SCRIPT_DIR/app/main.py.bak"
            else
                print_error "Failed to update router automatically"
                print_info "Please manually update app/main.py:"
                print_info "Change: from app.api.routes.campaign_dashboard import router"
                print_info "To: from app.api.routes.campaign_dashboard_optimized import router"
            fi
        fi
    else
        print_warning "app/main.py not found"
    fi
}

# Test dashboard performance
test_dashboard() {
    print_header "Testing Dashboard Performance"
    
    read -p "Do you want to start the server and test the dashboard? (Y/n): " TEST_SERVER
    TEST_SERVER=${TEST_SERVER:-Y}
    
    if [[ ! $TEST_SERVER =~ ^[Yy]$ ]]; then
        print_info "Skipping dashboard test"
        return
    fi
    
    print_info "Starting FastAPI server..."
    print_info "Server will run on http://localhost:8000"
    print_warning "Press Ctrl+C to stop the server"
    
    cd "$SCRIPT_DIR"
    python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
}

# Generate deployment report
generate_report() {
    print_header "Deployment Summary"
    
    REPORT_FILE="$SCRIPT_DIR/deployment_report.txt"
    
    cat > "$REPORT_FILE" << EOF
═══════════════════════════════════════════════════════════
Campaign Dashboard Deployment Report
═══════════════════════════════════════════════════════════
Date: $(date)
Server: $(hostname)
User: $(whoami)

DATABASE CONFIGURATION
───────────────────────────────────────────────────────────
Host: $DB_HOST
Database: $DB_NAME
User: $DB_USER

DEPLOYMENT STATUS
───────────────────────────────────────────────────────────
EOF
    
    # Check indexes for crm_analysis_tcm
    INDEX_COUNT=$(mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -D "$DB_NAME" \
        -se "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME = 'crm_analysis_tcm' AND INDEX_NAME LIKE 'idx_crm_tcm_%';" 2>/dev/null)
    echo "✓ Database Indexes (crm_analysis_tcm): $INDEX_COUNT created" >> "$REPORT_FILE"
    
    # Check Python packages
    if pip3 show redis &> /dev/null; then
        echo "✓ Redis Python package: Installed" >> "$REPORT_FILE"
    else
        echo "✗ Redis Python package: Not installed" >> "$REPORT_FILE"
    fi
    
    # Check Redis server
    if redis-cli ping &> /dev/null; then
        echo "✓ Redis Server: Running" >> "$REPORT_FILE"
    else
        echo "⚠ Redis Server: Not running (optional)" >> "$REPORT_FILE"
    fi
    
    # Check router configuration
    if grep -q "campaign_dashboard_optimized" "$SCRIPT_DIR/app/main.py" 2>/dev/null; then
        echo "✓ Backend Router: Using optimized version" >> "$REPORT_FILE"
    else
        echo "⚠ Backend Router: Check configuration" >> "$REPORT_FILE"
    fi
    
    cat >> "$REPORT_FILE" << EOF

NEXT STEPS
───────────────────────────────────────────────────────────
1. Start the backend server:
   cd backend
   python3 -m uvicorn app.main:app --reload

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
- Check logs: $LOG_FILE
- Monitor Redis: redis-cli monitor
- Database performance: SHOW INDEX FROM crm_analysis_tcm;

TROUBLESHOOTING
───────────────────────────────────────────────────────────
If dashboard is slow:
  - Verify indexes: SHOW INDEX FROM crm_analysis_tcm;
  - Check Redis: redis-cli ping
  - Review logs: $LOG_FILE

If Redis errors occur:
  - Dashboard works without Redis (just slower)
  - Check Redis status: systemctl status redis
  - Restart Redis: systemctl restart redis

═══════════════════════════════════════════════════════════
Deployment completed successfully!
═══════════════════════════════════════════════════════════
EOF
    
    cat "$REPORT_FILE"
    print_success "Deployment report saved to: $REPORT_FILE"
}

# Main execution
main() {
    clear
    print_header "Campaign Dashboard Deployment"
    echo "Starting deployment at $(date)"
    echo "Logs will be saved to: $LOG_FILE"
    echo ""
    
    # Initialize log file
    echo "═══════════════════════════════════════════════════════════" > "$LOG_FILE"
    echo "Campaign Dashboard Deployment Log - $(date)" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════" >> "$LOG_FILE"
    
    # Run deployment steps
    load_env
    get_db_credentials
    check_prerequisites
    install_dependencies
    create_indexes
    setup_redis
    verify_router
    generate_report
    
    echo ""
    print_success "Deployment completed successfully!"
    echo ""
    
    test_dashboard
}

# Run main function
main "$@"

