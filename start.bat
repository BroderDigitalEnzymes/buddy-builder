@echo off
cd /d "%~dp0"
taskkill /f /im "Buddy Builder.exe" >nul 2>&1
call node scripts\build.js
call npx electron-builder --win --dir
start "" "release\win-unpacked\Buddy Builder.exe"
