@echo off
title O.N.S. OUTSOURCING SOLUTIONS - diagnostic
cd /d "%~dp0"
echo.
echo  ================================================
echo    O.N.S. OUTSOURCING SOLUTIONS - diagnostic report
echo  ================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found by this window.
  echo.
  echo  If you JUST installed Node.js, this window was opened
  echo  before the install finished. Close everything and open
  echo  a NEW window, or restart the PC once, then run again.
  echo.
  pause
  exit /b 1
)
node scripts\diag.js
echo.
echo  A file named diag.txt was created in this folder.
echo  Send its contents (or the whole file) for help.
echo.
pause
