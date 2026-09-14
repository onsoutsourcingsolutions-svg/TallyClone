@echo off
title O.N.S. OUTSOURCING SOLUTIONS - start here
cd /d "%~dp0."
echo.
echo  Starting from: %CD%
echo  If you see "C:\Users\ADITYA MISHRA\Desktop\TallyClone" - correct!
echo  If you see "C:\Users\ADITYA MISHRA" alone - WRONG folder!
echo.
call "%~dp0start-windows.bat"
if errorlevel 1 pause
