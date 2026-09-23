@echo off
echo Starting Air India Flight Tracker Dashboard...
start "Flight Tracker Server" cmd /k "node server.js"
timeout /t 2 >nul
start http://localhost:3000
echo Flight Tracker is now running at http://localhost:3000
