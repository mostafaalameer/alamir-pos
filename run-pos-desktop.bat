@echo off
chcp 65001 >nul
title Alamir Market POS Desktop Launcher
echo ========================================================
echo   ماركت الأمير - نظام الكاشير ونقطة البيع (Desktop App)
echo ========================================================

REM 1. Ensure POS Backend API is running on port 4000
netstat -ano | findstr ":4000 " | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [1/3] Starting POS Backend API Server on port 4000...
    start "Alamir POS Backend" /min cmd /c "cd /d "%~dp0backend" && npm.cmd run dev"
) else (
    echo [1/3] POS Backend API Server is already running on port 4000.
)

REM 2. Ensure POS Frontend is running on port 5173
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [2/3] Starting POS Desktop UI Server on port 5173...
    start "Alamir POS Frontend" /min cmd /c "cd /d "%~dp0frontend" && npm.cmd run dev"
    timeout /t 4 /nobreak >nul
) else (
    echo [2/3] POS Desktop UI Server is already running on port 5173.
)

REM 3. Launch Standalone Native Desktop Window (WebView2 / Chrome App Mode)
echo [3/3] Opening Alamir Market POS Desktop Window...
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:5173 --window-size=1280,800
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:5173 --window-size=1280,800
) else (
    start http://localhost:5173
)
exit

