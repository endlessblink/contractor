@echo off
title Doc Maker - Installer

echo.
echo   ========================================
echo     Doc Maker - Installer v1.1.4
echo   ========================================
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\Doc Maker"
set "EXE_NAME=contractor-win-x64.exe"
set "DOWNLOAD_URL=https://github.com/endlessblink/contractor/releases/download/v1.1.4/%EXE_NAME%"

echo   Install location: %INSTALL_DIR%
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo   Downloading Doc Maker (about 180 MB)...
echo   Please wait...
echo.

powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%INSTALL_DIR%\%EXE_NAME%' -UseBasicParsing"

if not exist "%INSTALL_DIR%\%EXE_NAME%" (
    echo.
    echo   ERROR: Download failed.
    echo   Please download manually from:
    echo   https://github.com/endlessblink/contractor/releases
    echo.
    pause
    exit /b 1
)

echo   Download complete!
echo.
echo   Creating launcher...

echo Set WshShell = CreateObject("WScript.Shell") > "%INSTALL_DIR%\DocMaker.vbs"
echo WshShell.Run Chr(34) ^& "%INSTALL_DIR%\%EXE_NAME%" ^& Chr(34), 0, False >> "%INSTALL_DIR%\DocMaker.vbs"
echo WScript.Sleep 2000 >> "%INSTALL_DIR%\DocMaker.vbs"
echo WshShell.Run "http://localhost:6831" >> "%INSTALL_DIR%\DocMaker.vbs"

echo.
set /p DESKTOP_SC="  Create Desktop shortcut? [Y/n]: "
if /i not "%DESKTOP_SC%"=="n" (
    powershell -NoProfile -Command "try { $ws=New-Object -ComObject WScript.Shell; $desktop=[Environment]::GetFolderPath('Desktop'); $sc=$ws.CreateShortcut(\"$desktop\Doc Maker.lnk\"); $sc.TargetPath='wscript.exe'; $sc.Arguments='\"'+$Env:LOCALAPPDATA+'\Doc Maker\DocMaker.vbs\"'; $sc.IconLocation=$Env:LOCALAPPDATA+'\Doc Maker\contractor-win-x64.exe,0'; $sc.WorkingDirectory=$Env:LOCALAPPDATA+'\Doc Maker'; $sc.Save(); Write-Host '  Desktop shortcut created' } catch { Write-Host '  Warning: Could not create Desktop shortcut' }"
)

set /p STARTMENU_SC="  Create Start Menu shortcut? [Y/n]: "
if /i not "%STARTMENU_SC%"=="n" (
    powershell -NoProfile -Command "try { $ws=New-Object -ComObject WScript.Shell; $programs=[Environment]::GetFolderPath('Programs'); $sc=$ws.CreateShortcut(\"$programs\Doc Maker.lnk\"); $sc.TargetPath='wscript.exe'; $sc.Arguments='\"'+$Env:LOCALAPPDATA+'\Doc Maker\DocMaker.vbs\"'; $sc.IconLocation=$Env:LOCALAPPDATA+'\Doc Maker\contractor-win-x64.exe,0'; $sc.WorkingDirectory=$Env:LOCALAPPDATA+'\Doc Maker'; $sc.Save(); Write-Host '  Start Menu shortcut created' } catch { Write-Host '  Warning: Could not create Start Menu shortcut' }"
)

echo.
echo   Creating uninstaller...

> "%INSTALL_DIR%\Uninstall.bat" (
    echo @echo off
    echo title Doc Maker - Uninstall
    echo echo Uninstalling Doc Maker...
    echo taskkill /f /im contractor-win-x64.exe 2^>nul
    echo timeout /t 2 /nobreak ^>nul
    echo powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Desktop')+'\Doc Maker.lnk') -ErrorAction SilentlyContinue"
    echo powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('Programs')+'\Doc Maker.lnk') -ErrorAction SilentlyContinue"
    echo echo.
    echo echo Doc Maker uninstalled.
    echo echo Delete this folder manually: %%~dp0
    echo pause
)

echo.
echo   ========================================
echo     Installation complete!
echo.
echo     To start: use your shortcut or run
echo     %INSTALL_DIR%\DocMaker.vbs
echo   ========================================
echo.

set /p LAUNCH="  Launch now? [Y/n]: "
if /i not "%LAUNCH%"=="n" (
    start "" wscript.exe "%INSTALL_DIR%\DocMaker.vbs"
)

echo.
echo   Done!
pause
