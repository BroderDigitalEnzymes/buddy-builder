@echo off
cd /d "%~dp0"
call node scripts\build.js
call npx electron dist\main.cjs
