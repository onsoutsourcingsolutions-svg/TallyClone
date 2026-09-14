@echo off
title O.N.S. OUTSOURCING SOLUTIONS - local server
cd /d "%~dp0."
rem Fix for spaces in path like ADITYA MISHRA — %~dp0. avoids trailing backslash escaping the quote
echo.
echo  ==================================================
echo    O.N.S. OUTSOURCING SOLUTIONS  - starting here
echo  ==================================================
echo.

rem --- 1. Node.js present? ---
where node >nul 2>nul
if errorlevel 1 goto :nonode
echo  node found:
node -v

rem --- 2. Node new enough? ---
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<5)){process.exit(1)}" >nul 2>nul
if errorlevel 1 goto :oldnode

rem --- 3. Folder really extracted (writable)? ---
echo test > "%~dp0.wtest" 2>nul
if not exist "%~dp0.wtest" goto :zipped
del "%~dp0.wtest" >nul 2>nul

rem --- 3b. Auto-backup data before start (keeps last 20) ---
if exist "data\tally.db" (
  if not exist "data\backups" mkdir "data\backups" >nul 2>nul
  for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set dt=%%I
  if defined dt (
    set stamp=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%_%dt:~8,2%-%dt:~10,2%-%dt:~12,2%
  ) else (
    set stamp=%date:~-4%-%date:~-7,2%-%date:~-10,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%
    set stamp=%stamp: =0%
  )
  copy /y "data\tally.db" "data\backups\backup-%stamp%-startup.db" >nul 2>nul
  echo   Auto-backup: data\backups\backup-%stamp%-startup.db
)

rem --- 4. Always make sure packages are installed (fast when already done) ---
echo.
echo  [step 1/3] Checking packages (first time: 1-3 minutes)...
echo  Packages... %date% %time% > install-log.txt
call npm install --no-audit --no-fund --prefer-offline >> install-log.txt 2>&1
if errorlevel 1 (
  if exist node_modules (
    echo   (internet problem? continuing with the packages already present)
  ) else (
    goto :installerr
  )
)

rem --- 5. Always build the newest version so updates always show ---
echo.
echo  [step 2/3] Building the newest version (about 10-20 seconds)...
echo  Build... %date% %time% > install-log.txt
call npm run build >> install-log.txt 2>&1
if errorlevel 1 (
  if exist "dist\index.html" (
    echo   (build had a problem - using the app files that came with this copy)
  ) else (
    goto :installerr
  )
)

rem --- 6. Start server, open browser once it really answers ---
echo.
echo  [step 3/3] Starting server...
echo.
start "" /b node scripts\open-browser.js
call npm start
echo.
echo  The server stopped.
echo.
pause
exit /b 0

:nonode
echo.
echo  [ERROR] Node.js was not found.
echo    - Install Node.js v22 LTS from  https://nodejs.org  (green button)
echo    - If you installed it JUST NOW, close all windows (or restart the
echo      PC once) and double-click this file again.
echo.
pause
exit /b 1

:oldnode
echo.
echo  [ERROR] Your Node.js is too old:  ^(below v22.5^)
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
echo  install-log.txt (next to this file).
echo  Most common causes:
echo    - no internet connection (this step needs the internet once)
echo    - antivirus blocking npm - allow it
echo    - folder inside zip / not extracted
echo  Fix and try again, or run diagnose.bat and send diag.txt.
echo.
pause
exit /b 1
