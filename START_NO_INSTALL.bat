@echo off
title O.N.S. OUTSOURCING SOLUTIONS - no install needed
cd /d "%~dp0."
echo Starting server directly (no npm install)...
node server/run.js
pause
