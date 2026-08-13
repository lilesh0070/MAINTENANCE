@echo off
REM ===================================================================
REM   MES ANDON - Firewall (ab kuch karne ki zaroorat NAHI)
REM
REM   ANDON ab Mitsubishi PLC se OUTBOUND (MC-protocol) connect karta hai:
REM   backend khud PLC se jud kar uske bits padhta hai.  Koi device is PC
REM   par INBOUND connect nahi karta, isliye port 9000 (ya koi bhi inbound
REM   firewall rule) ki ab zaroorat NAHI hai.
REM
REM   (Pehle ESP32 raw-TCP :9000 par INBOUND aata tha - wo hata diya gaya.)
REM ===================================================================
title MES ANDON - Firewall (no inbound rule needed)

echo.
echo   ANDON ab OUTBOUND PLC connection use karta hai (MC-protocol).
echo   Is PC par koi inbound port kholne ki zaroorat NAHI hai.
echo.
echo   Backend ko LAN se kholna ho to sirf 8892 (HTTP) allow karein -
echo   uske liye ANDON-FIREWALL-ON.bat hai.
echo.

REM Purana ESP wala inbound rule (agar bana ho) hata dete hain - ab bekaar hai.
netsh advfirewall firewall delete rule name="MES-ANDON-9000" >nul 2>&1

pause
