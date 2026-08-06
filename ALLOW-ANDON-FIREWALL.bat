@echo off
REM ===================================================================
REM   MES ANDON — Firewall allow (ek baar chalao, ADMIN se)
REM   Is PC (192.168.30.11) par TCP port 9000 inbound allow karta hai
REM   taaki ANDON ke ESP32 boards is backend se connect ho sakein.
REM   Right-click is file par -> "Run as administrator"
REM ===================================================================
title MES ANDON - Firewall Setup (port 9000)

REM --- Admin check ---
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] Ye ADMIN se chalana hai.
  echo       Is file par right-click -^> "Run as administrator"
  echo.
  pause
  exit /b 1
)

echo Purana rule (agar ho) hata raha hoon...
netsh advfirewall firewall delete rule name="MES-ANDON-9000" >nul 2>&1

echo Naya inbound rule add kar raha hoon (TCP 9000)...
netsh advfirewall firewall add rule name="MES-ANDON-9000" dir=in action=allow protocol=TCP localport=9000

if errorlevel 1 (
  echo.
  echo   [X] Rule add nahi hua.
) else (
  echo.
  echo   [OK] Ho gaya. Ab port 9000 par ESP is backend se jud sakte hain.
  echo        ESP on karo -^> Andon page par data aane lagega.
  echo.
  echo   Check: neeche ESP judne par ESTABLISHED dikhega
  netsh advfirewall firewall show rule name="MES-ANDON-9000" | findstr /I "Rule LocalPort Action Enabled"
)
echo.
pause
