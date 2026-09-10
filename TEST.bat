@echo off
title O.N.S. OUTSOURCING SOLUTIONS
cd /d "%~dp0."
node -e "const s=require('http').createServer((q,r)=>r.end('ONS-Books-OK'));s.listen(8080,()=>{require('http').get('http://localhost:8080',x=>{console.log('TEST OK: this batch file CAN run the app server');process.exit(0)})})"
if errorlevel 1 (
  echo.
  echo  TEST FAILED. Copy the error text above and send it.
  echo.
  pause
)
