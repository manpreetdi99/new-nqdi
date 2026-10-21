@echo off
echo Starting Performance Insights Application...

echo Starting Backend API...
start "Backend API" /D "%~dp0backend" cmd /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn app:app --reload --host 0.0.0.0 --port 8000"


echo Starting Vite Frontend...
start "Frontend" cmd /k "cd /d "%~dp0" && npm run dev"

echo Both services have been started in separate windows.
