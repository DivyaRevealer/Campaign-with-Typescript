# Restart Server Instructions

## To Restart the Backend Server:

1. **Stop the current server** (if running):
   - Find the process using port 8000:
     ```powershell
     netstat -ano | findstr :8000
     ```
   - Kill the process (replace PID with the actual process ID):
     ```powershell
     taskkill /PID <PID> /F
     ```

2. **Start the server**:
   ```powershell
   cd "C:\IMS\IMS Taken before RBAC 27Nov2025 2123Hrs\IMS\backend"
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
   ```

3. **Verify the server is running**:
   - Check http://127.0.0.1:8000/api/healthz (should return `{"status":"ok"}`)
   - Check http://127.0.0.1:8000/docs (FastAPI docs should show campaign endpoints)

## Campaign Dashboard Endpoints:

After restart, these endpoints should be available:
- `GET /api/campaign/dashboard` - Main dashboard data
- `GET /api/campaign/dashboard/filters` - Filter options

## Troubleshooting:

If you still get "Not Found" errors:
1. Check server logs for any import errors
2. Verify the routes are registered: Look for "campaign" in the FastAPI docs at `/docs`
3. Check browser console for the exact API call being made
4. Verify authentication token is valid

