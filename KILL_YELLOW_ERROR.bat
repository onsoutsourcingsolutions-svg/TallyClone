@echo off
title FIX Yellow Error \C:\Users\ADITYA
echo.
echo  ================================================================
echo    FIXING Yellow Error: Windows cannot find '\C:\Users\ADITYA'
echo  ================================================================
echo.
echo  This error is from old v1.11.6 _apply-restart.bat with space bug.
echo  Deleting broken file and starting v1.11.19...
echo.
cd /d "%~dp0."
echo  Current folder: %CD%
echo.
if exist "_apply-restart.bat" (
  del /f /q "_apply-restart.bat"
  echo  Deleted _apply-restart.bat - broken file removed.
) else (
  echo  No _apply-restart.bat found - good.
)
if exist "_update_stage" rmdir /s /q "_update_stage" >nul 2>nul
echo.
echo  Starting server (v1.11.19 should show, no more yellow popup)...
echo.
call npm start
pause
