@echo off
title ONS Books - FIX npm start path
echo.
echo  ================================================================
echo    FIX for: npm error path C:\Users\ADITYA MISHRA\package.json
echo  ================================================================
echo.
echo  You typed npm start in the WRONG folder (C:\Users\ADITYA MISHRA)
echo  Your app is in Desktop\TallyClone - this file will go there.
echo.
cd /d "%~dp0."
echo  Current folder now: %CD%
echo.
if not exist package.json (
  echo  [ERROR] package.json NOT found here either!
  echo  Make sure this file is inside C:\Users\ADITYA MISHRA\Desktop\TallyClone
  pause
  exit /b 1
)
echo  Found package.json - good! Starting...
echo.
call npm start
pause
