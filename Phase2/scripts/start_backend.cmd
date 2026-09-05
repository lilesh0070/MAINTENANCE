@echo off
REM ===================================================================
REM  start_backend.cmd -- laptop on hote hi backend chalu kar deta hai,
REM  taaki app ka "Update" laptop se mil sake bina kuch kiye.
REM
REM  Scheduled task "MES Backend 8892" ise logon par chalata hai.
REM  Task hatana ho:  schtasks /delete /tn "MES Backend 8892" /f
REM
REM  DO BACHAAV neeche hain -- inhe mat hatana, dono ki wajah likhi hai.
REM ===================================================================
cd /d "%~dp0.."

REM --- Bachaav 1: pehle se chal raha ho to doosra mat chalao ------------
REM  8892 pehle se bandha ho aur hum doosra uvicorn chala den to wo turant
REM  mar jaata hai aur log me bekaar ki error bharti rehti hai.
netstat -ano | findstr /R /C:"LISTENING" | findstr ":8892 " >nul
if %ERRORLEVEL%==0 (
  echo [%DATE% %TIME%] 8892 pehle se chal raha hai -- kuch nahi kiya. >> logs\backend_autostart.log
  exit /b 0
)

REM --- Bachaav 2: ANDON poller BAND hona chahiye -----------------------
REM  17 August 2026: is laptop ka backend production ke saath wahi PLC poll
REM  kar raha tha.  Do poller ek hi MC-connection par lade -> ANDON call
REM  baar-baar khulti-bandh hoti rahi (8-10 phantom call/min) aur
REM  andon_system par deadlock.  364 phantom row delete karni padi thi.
REM  Isliye: .env me ANDON_POLL_ENABLED=0 na ho to chalao MAT.
findstr /R /C:"^ANDON_POLL_ENABLED=0" .env >nul
if not %ERRORLEVEL%==0 (
  echo [%DATE% %TIME%] RUKA: .env me ANDON_POLL_ENABLED=0 nahi hai. >> logs\backend_autostart.log
  echo    Bina iske ye backend production ke PLC poller se ladega.  >> logs\backend_autostart.log
  exit /b 1
)

echo [%DATE% %TIME%] backend chalu kar rahe hain... >> logs\backend_autostart.log
".venv\Scripts\python.exe" -u -m uvicorn main:app --host 0.0.0.0 --port 8892 >> logs\backend_autostart.log 2>&1
