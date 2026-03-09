@echo off
cd /d "%~dp0"
call node scripts\build.js
call npx electron-builder --win --dir
start "" "release\win-unpacked\Buddy Builder.exe"
