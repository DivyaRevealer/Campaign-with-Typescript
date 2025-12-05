# run_server.py
import uvicorn
from app.main import app

if __name__ == "__main__":
    # Backend API will use port 3235 in hosting server
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=3235,
        log_level="info",
    )
