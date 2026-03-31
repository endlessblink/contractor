@echo off
title Doc Maker
start /min "" "%~dp0contractor-win-x64.exe"
timeout /t 2 /nobreak >nul
start http://localhost:6831
