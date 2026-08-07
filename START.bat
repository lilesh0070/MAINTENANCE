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
REM .env gitignored hai - nayi machine par ye file hoti hi nahi.  Bina iske
REM backend chal to jaata hai par DB se jud nahi paata.  Yahin rok dete hain.
if not exist "%~dp0Phase2\.env" (
    echo   [ERROR] Phase2\.env missing.
    echo           copy Phase2\.env.example Phase2\.env
    echo           phir usme DB_PASS aur JWT_SECRET_KEY bhar dein.
    pause
    exit /b 1
)

REM --- launch BACKEND in its own window ---
echo Starting backend (uvicorn :8892)...
start "MAINT-BACKEND :8892" /D "%~dp0Phase2" cmd /k ".venv\Scripts\python.exe -u -m uvicorn main:app --host 0.0.0.0 --port 8892"

REM --- launch FRONTEND in its own window ---
echo Starting frontend (vite :9965)...
start "MAINT-FRONTEND :9965" /D "%~dp0mes-frontend" cmd /k "npm run dev"

REM --- backend ke ready hone ka INTEZAAR karo, phir status dikhao ---
REM   Pehle yahan 15 second ka fixed wait tha.  Machine busy ho (ya DB slow ho)
REM   to backend usse zyada le leta tha aur STATUS jhooti "[X] nahi chala"
REM   dikha deta tha — jabki wo 2 second baad chalu ho jaata.  Ab har 2 sec
REM   check karte hain, 60 second tak.  Jaldi ready ho gaya to jaldi aage.
echo.
echo Waiting for backend to come up...
set /a _try=0
:waitbackend
netstat -an | findstr /R /C:"[0:]:8892 .*LISTENING" >nul 2>&1
if not errorlevel 1 goto backendup
set /a _try+=1
if %_try% geq 30 goto backendup
ping -n 3 127.0.0.1 >nul 2>&1
goto waitbackend
:backendup

REM ESP har 3 sec me khud judta hai — use thoda mauka do (12 sec tak)
echo Waiting for ESP to connect...
set /a _try=0
:waitesp
netstat -an | findstr ":9000" | findstr "ESTABLISHED" >nul 2>&1
if not errorlevel 1 goto espup
set /a _try+=1
if %_try% geq 6 goto espup
ping -n 3 127.0.0.1 >nul 2>&1
goto waitesp
:espup

echo.
echo ===================================================
echo   STATUS
echo ===================================================
netstat -an | findstr /R /C:"[0:]:8892 .*LISTENING" >nul 2>&1
if errorlevel 1 (echo   Backend  :8892   [X] nahi chala) else (echo   Backend  :8892   [OK])
netstat -an | findstr /R /C:"[0:]:9000 .*LISTENING" >nul 2>&1
if errorlevel 1 (echo   ANDON    :9000   [X] nahi chala) else (echo   ANDON    :9000   [OK] ESP ka intezaar)
netstat -an | findstr ":9000" | findstr "ESTABLISHED" >nul 2>&1
if errorlevel 1 (
  echo   ESP juda         [..] abhi nahi - ESP har 3 sec me khud judta hai
) else (
  echo   ESP juda         [OK]
  netstat -an | findstr ":9000" | findstr "ESTABLISHED"
)
echo.
echo   Open in browser:  http://localhost:9965
echo.
echo   To stop everything: run STOP.bat
echo   (or just close the two new windows)
echo ===================================================
echo.
ping -n 4 127.0.0.1 >nul 2>&1
