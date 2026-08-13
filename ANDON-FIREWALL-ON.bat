@echo off
REM ===================================================================
REM   MES ANDON - Firewall wapas ON (backend LAN se khule)
REM   Right-click is file par -> "Run as administrator"
REM
REM   Ye kya karta hai:
REM     1) Backend python ke liye inbound ALLOW rule
REM     2) TCP 8892 (backend HTTP) allow
REM     3) Purani galti se bani BLOCK rules hataata hai (ye ALLOW rules
REM        ko harati hain - Windows me BLOCK hamesha ALLOW se upar hai)
REM     4) Firewall wapas ON
REM ===================================================================
title MES ANDON - Firewall ON

REM  "auto" argument = START.bat se chali hai -> aakhir me pause mat karo
set "AUTO=%~1"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] Ye ADMIN se chalana hai.
  echo       Is file par right-click -^> "Run as administrator"
  echo.
  if /i not "%AUTO%"=="auto" pause
  exit /b 1
)

set PY=D:\mainmtenance\maintainence\Phase2\.venv\Scripts\python.exe

echo.
echo [1/4] Backend python ke liye ALLOW rule...
netsh advfirewall firewall delete rule name="MES-BACKEND-PY-TCP" >nul 2>&1
netsh advfirewall firewall add rule name="MES-BACKEND-PY-TCP" dir=in action=allow program="%PY%" protocol=TCP enable=yes profile=any >nul
if errorlevel 1 (echo     [X] fail) else (echo     [OK])

echo [2/4] Backend HTTP TCP 8892 allow...
netsh advfirewall firewall delete rule name="MES-BACKEND-8892" >nul 2>&1
netsh advfirewall firewall add rule name="MES-BACKEND-8892" dir=in action=allow protocol=TCP localport=8892 enable=yes profile=any >nul
if errorlevel 1 (echo     [X] fail) else (echo     [OK])

echo [3/4] Galti se bani purani BLOCK rules hata raha hoon...
REM Ye tab banti hain jab Windows ka "allow access?" prompt aaye aur
REM Cancel/Block daba diya jaye. Inhe hatane se kuch khulta NAHI --
REM Windows me inbound waise bhi by-default band hai. Ye sirf ALLOW
REM rules ko override karna band kar deti hain.
powershell -NoProfile -Command "Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | ForEach-Object { $r=$_; $p=($r|Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program; if ($p -match 'python|powershell|node\.exe|\\code\.exe|postman|mdns-discovery|\.venv') { Write-Host ('     hata raha: ' + $r.DisplayName + '  [' + $p + ']'); Remove-NetFirewallRule -Name $r.Name -ErrorAction SilentlyContinue } }"
echo     [OK]

echo [4/4] Firewall wapas ON...
netsh advfirewall set allprofiles state on >nul
if errorlevel 1 (echo     [X] fail) else (echo     [OK])

echo.
echo ===================== NATIJA =====================
netsh advfirewall show allprofiles state | findstr /I "Profile State"
echo.
echo ==================================================
echo.
if /i "%AUTO%"=="auto" (
  echo Firewall set ho gaya. Ye window band ho rahi hai...
  timeout /t 4 /nobreak >nul
) else (
  echo Ho gaya. Ab START.bat chala dein.
  echo.
  pause
)
