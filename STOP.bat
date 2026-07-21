@echo off
setlocal enabledelayedexpansion
set "SILENT=%~1"

if /i not "%SILENT%"=="silent" (
    echo ===================================================
    echo   MAINTENANCE SLICE - Stop / Free Ports
    echo   Killing listeners on 8892 [backend] and 9965 [frontend]
    echo ===================================================
    echo.
)

call :killport 8892 Backend
call :killport 9965 Frontend

REM --- also close the named launcher windows, if still open ---
taskkill /F /FI "WINDOWTITLE eq MAINT-BACKEND :8892*"  >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq MAINT-FRONTEND :9965*" >nul 2>nul

if /i not "%SILENT%"=="silent" (
    echo.
    echo Done. Ports 8892 and 9965 are free.
    echo.
    pause
)
exit /b 0

:killport
set "PORT=%~1"
set "NAME=%~2"
set "FOUND="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"[0:]:%PORT% .*LISTENING"') do (
    set "FOUND=1"
    if /i not "%SILENT%"=="silent" echo   Killing %NAME% on port %PORT%  PID=%%a
    taskkill /F /PID %%a >nul 2>nul
)
if not defined FOUND if /i not "%SILENT%"=="silent" echo   No process listening on port %PORT%  [%NAME%]
exit /b 0
