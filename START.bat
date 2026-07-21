@echo off
setlocal
cd /d "%~dp0"
echo ===================================================
echo   MAINTENANCE SLICE - Starting Everything
echo   Backend  : http://localhost:8892
echo   Frontend : http://localhost:9965
echo ===================================================
echo.

REM --- free the ports first (kill any stale listeners) ---
call "%~dp0STOP.bat" silent

REM --- sanity checks: are deps installed? ---
if not exist "%~dp0Phase2\.venv\Scripts\python.exe" (
    echo   [ERROR] Backend venv missing. Run INSTALL.bat first.
    pause
    exit /b 1
)
if not exist "%~dp0mes-frontend\node_modules" (
    echo   [ERROR] Frontend node_modules missing. Run INSTALL.bat first.
    pause
    exit /b 1
)

REM --- launch BACKEND in its own window ---
echo Starting backend (uvicorn :8892)...
start "MAINT-BACKEND :8892" /D "%~dp0Phase2" cmd /k ".venv\Scripts\python.exe -u -m uvicorn main:app --host 0.0.0.0 --port 8892"

REM --- launch FRONTEND in its own window ---
echo Starting frontend (vite :9965)...
start "MAINT-FRONTEND :9965" /D "%~dp0mes-frontend" cmd /k "npm run dev"

echo.
echo ===================================================
echo   Both services launched in separate windows.
echo.
echo   Open in browser:  http://localhost:9965
echo.
echo   To stop everything: run STOP.bat
echo   (or just close the two new windows)
echo ===================================================
echo.
timeout /t 3 /nobreak >nul
