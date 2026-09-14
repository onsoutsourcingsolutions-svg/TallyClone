@echo off
title O.N.S. OUTSOURCING SOLUTIONS - local server
cd /d "%~dp0."
rem Fix for spaces in path like ADITYA MISHRA — %~dp0. avoids trailing backslash escaping the quote
echo.
echo  ==================================================
echo    O.N.S. OUTSOURCING SOLUTIONS  - starting here
echo  ==================================================
echo.
echo  Starting from: %CD%
echo   If you see "%CD%" - correct!
echo   If you see "C:\Users\ADITYA MISHRA" alone - WRONG folder!
echo.

rem --- 1. Node.js present? ---
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo  node found:
node -v

rem --- 2. Node new enough? Allow v22+ and v24+ ---
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22){process.exit(1)}" >nul 2>nul
if errorlevel 1 goto :oldnode

rem --- 3. Folder really extracted (writable)? ---
echo test > "%~dp0.wtest" 2>nul
if not exist "%~dp0.wtest" goto :zipped
del "%~dp0.wtest" >nul 2>nul

rem --- 3b. Auto-backup data before start (keeps last 20) — FIX wmic removed in Win11 ---
if exist "data\tally.db" (
  if not exist "data\backups" mkdir "data\backups" >nul 2>nul
  set stamp=
  rem Try PowerShell first (works on Win11, handles space path)
  for /f "delims=" %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss" 2^>nul') do set stamp=%%I
  if not defined stamp (
    for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set dt=%%I
    if defined dt set stamp=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%_%dt:~8,2%-%dt:~10,2%-%dt:~12,2%
  )
  if not defined stamp (
    set stamp=%date:~-4%-%date:~-7,2%-%date:~-10,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%
    set stamp=%stamp: =0%
    set stamp=%stamp:/=-%
  )
  if not defined stamp set stamp=backup
  copy /y "data\tally.db" "data\backups\backup-%stamp%-startup.db" >nul 2>nul
  echo   Auto-backup: data\backups\backup-%stamp%-startup.db
)

rem --- 4. Always make sure packages are installed (fast when already done) — v1.11.27 robust for Node v24 + offline ---
echo.
echo  [step 1/3] Checking packages (first time: 1-3 minutes, needs internet once)...
echo  Packages... %date% %time% > install-log.txt
echo  Node: >> install-log.txt
node -v >> install-log.txt 2>&1
echo  NPM: >> install-log.txt
npm -v >> install-log.txt 2>&1

if exist "node_modules\express\package.json" (
  echo   Packages already present (express found) — skipping install for speed
  goto :buildstep
)

echo   Installing packages... (this needs internet once, then works offline)
call npm install --no-audit --no-fund --prefer-offline >> install-log.txt 2>&1
if errorlevel 1 (
  echo   First install attempt failed, trying without offline flag...
  echo   --- retry without offline --- >> install-log.txt
  call npm install --no-audit --no-fund >> install-log.txt 2>&1
)
if errorlevel 1 (
  echo   Second attempt failed, trying npm cache clean + install...
  echo   --- retry after cache verify --- >> install-log.txt
  call npm cache verify >> install-log.txt 2>&1
  call npm install --no-audit --no-fund >> install-log.txt 2>&1
)
if errorlevel 1 (
  if exist "node_modules\express\package.json" (
    echo   (install had warnings but packages are present — continuing)
    goto :buildstep
  ) else (
    echo.
    echo   --- install-log.txt last 40 lines ---
    powershell -Command "Get-Content install-log.txt -Tail 40" 2>nul
    if errorlevel 1 type install-log.txt
    echo   --- end log ---
    echo.
    goto :installerr
  )
)

:buildstep
rem --- 5. Always build the newest version so updates always show ---
echo.
echo  [step 2/3] Building the newest version (about 10-20 seconds)...
echo  Build... %date% %time% > build-log.txt
call npm run build >> build-log.txt 2>&1
if errorlevel 1 (
  if exist "dist\index.html" (
    echo   (build had a problem - using the app files that came with this copy)
    echo   Build failed but dist exists — continuing >> build-log.txt
  ) else (
    echo   Build failed and no dist — see build-log.txt
    type build-log.txt
    goto :installerr
  )
)

rem --- 6. Start server, open browser once it really answers — v1.11.27 AUTO-RESTART NO MANUAL CLOSE ---
:serverloop
echo.
echo  [step 3/3] Starting server... (auto-restart enabled — NO need to close manually on update)
echo.
start "" /b node scripts\open-browser.js
call npm start
set EXITCODE=%errorlevel%
echo.
echo  Server stopped at %date% %time% with code %EXITCODE% >> server.log
echo  Server stopped with code %EXITCODE% — checking if it was an auto-update restart...

rem If update-restart.log exists and was updated in last 2 minutes, it was an update — auto-restart WITHOUT pause
if exist "update-restart.log" (
  for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-Date) - (Get-Item 'update-restart.log').LastWriteTime | Select-Object -ExpandProperty TotalSeconds" 2^>nul') do set AGE=%%a
  if not defined AGE set AGE=9999
  echo   update-restart.log age ~%AGE% sec
  echo   If age ^< 120 sec, this was an auto-update — restarting automatically...
  if not exist "_apply-restart.bat" (
    echo   Detected auto-update restart — new server already running in background — restarting this window in 3 sec (NO manual close needed)...
    timeout /t 3 /nobreak >nul
    goto serverloop
  )
  for /f "tokens=1 delims=." %%b in ("%AGE%") do set AGEINT=%%b
  if %AGEINT% LSS 120 (
    echo   Recent update detected — auto-restarting...
    timeout /t 3 /nobreak >nul
    goto serverloop
  )
)

rem Normal stop (not update) — show message and pause
echo.
echo  The server stopped.
echo  If you stopped it manually, you can close this window.
echo  If it stopped due to an update, it should have auto-restarted above — if not, double-click START_ME.bat again.
echo.
pause
exit /b %EXITCODE%

:nonode
echo.
echo  [ERROR] Node.js was not found.
echo    - Install Node.js v22 LTS or v24 from  https://nodejs.org  (green button)
echo    - If you installed it JUST NOW, close all windows (or restart the
echo      PC once) and double-click this file again.
echo.
pause
exit /b 1

:oldnode
echo.
echo  [ERROR] Your Node.js is too old:  (below v22)
echo    - Install the newest LTS from  https://nodejs.org
echo    - Install over the old one, then run this file again.
echo.
pause
exit /b 1

:zipped
echo.
echo  [ERROR] This folder is read-only - you are running the file from
echo  INSIDE the zip. You must EXTRACT it first:
echo      right-click the .zip  ->  "Extract All..."  ->  Extract
echo  then open the new folder and double-click start-windows.bat there.
echo.
pause
exit /b 1

:installerr
echo.
echo  [ERROR] Installing/building failed. The details are saved in
echo  install-log.txt and build-log.txt (next to this file).
echo  Most common causes:
echo    - no internet connection (this step needs the internet once — use FULL zip if offline)
echo    - antivirus blocking npm - allow it or use ONS-Books-PC-Package-full.zip (has node_modules)
echo    - folder inside zip / not extracted
echo    - Node v24 with old npm cache — try deleting node_modules and package-lock.json then retry
echo  QUICK FIXES:
echo    1) Double-click START_NO_INSTALL.bat if you already have node_modules
echo    2) Use ONS-Books-PC-Package-full.zip (30MB, includes node_modules, no npm install needed)
echo    3) Run KILL_YELLOW_ERROR.bat then try again
echo    4) Fix and try again, or run diagnose.bat and send diag.txt + install-log.txt
echo.
pause
exit /b 1
