@echo off
setlocal
cd /d "%~dp0"
echo ===================================================
echo   MAINTENANCE SLICE - Dependency Installer
echo   Backend  : Python venv + pip  (port 8892)
echo   Frontend : npm install        (port 9965)
echo ===================================================
echo.

REM ===================== BACKEND =====================
echo [1/2] Backend (Phase2) - setting up Python venv...
cd /d "%~dp0Phase2"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py -3.12" )
if not defined PY (
    echo.
    echo   [ERROR] Python not found on PATH.
    echo   Install Python 3.12 from https://www.python.org/downloads/
    echo   ^(tick "Add python.exe to PATH"^) and re-run INSTALL.bat
    echo.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo   Creating virtual environment [.venv]...
    %PY% -m venv .venv
    if errorlevel 1 (
        echo   [ERROR] Failed to create venv.
        pause
        exit /b 1
    )
)

echo   Upgrading pip ^(non-fatal if offline^)...
".venv\Scripts\python.exe" -m pip install --upgrade pip

echo   Installing backend requirements ^(this can take a few minutes^)...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo   [ERROR] pip install failed. Check your internet connection.
    echo.
    pause
    exit /b 1
)
echo   Backend dependencies installed.
echo.

REM ===================== FRONTEND ====================
echo [2/2] Frontend (mes-frontend) - npm install...
cd /d "%~dp0mes-frontend"

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [ERROR] npm / Node.js not found on PATH.
    echo   Install Node.js LTS from https://nodejs.org/ and re-run INSTALL.bat
    echo.
    pause
    exit /b 1
)

call npm install
if errorlevel 1 (
    echo.
    echo   [ERROR] npm install failed.
    echo.
    pause
    exit /b 1
)
echo   Frontend dependencies installed.
echo.

echo ===================================================
echo   ALL DEPENDENCIES INSTALLED SUCCESSFULLY
echo.
echo   Next step:  double-click  START.bat
echo   Then open:  http://localhost:9965
echo ===================================================
echo.
pause
