@echo off
echo Starting Performance Insights Application...

echo Starting Backend API...
start "Backend API" cmd /k "call .venv\Scripts\activate && cd backend && uvicorn app:app --reload --host 0.0.0.0 --port 8000 --workers 4"


echo Starting Vite Frontend...
start "Frontend" cmd /k "npm run dev"

echo Both services have been started in separate windows.
