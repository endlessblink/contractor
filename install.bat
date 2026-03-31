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

powershell -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('%DOWNLOAD_URL%','%INSTALL_DIR%\%EXE_NAME%')"

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

echo   Creating shortcuts...

powershell -Command "$ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Doc Maker.lnk'); $sc.TargetPath='wscript.exe'; $sc.Arguments='\"'+$Env:LOCALAPPDATA+'\Doc Maker\DocMaker.vbs\"'; $sc.IconLocation=$Env:LOCALAPPDATA+'\Doc Maker\contractor-win-x64.exe,0'; $sc.WorkingDirectory=$Env:LOCALAPPDATA+'\Doc Maker'; $sc.Description='AI document generator'; $sc.Save()"

powershell -Command "$ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut($Env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Doc Maker.lnk'); $sc.TargetPath='wscript.exe'; $sc.Arguments='\"'+$Env:LOCALAPPDATA+'\Doc Maker\DocMaker.vbs\"'; $sc.IconLocation=$Env:LOCALAPPDATA+'\Doc Maker\contractor-win-x64.exe,0'; $sc.WorkingDirectory=$Env:LOCALAPPDATA+'\Doc Maker'; $sc.Description='AI document generator'; $sc.Save()"

echo   Creating uninstaller...

> "%INSTALL_DIR%\Uninstall.bat" (
    echo @echo off
    echo title Doc Maker - Uninstall
    echo echo Uninstalling Doc Maker...
    echo taskkill /f /im contractor-win-x64.exe 2^>nul
    echo timeout /t 2 /nobreak ^>nul
    echo del "%%USERPROFILE%%\Desktop\Doc Maker.lnk" 2^>nul
    echo del "%%APPDATA%%\Microsoft\Windows\Start Menu\Programs\Doc Maker.lnk" 2^>nul
    echo echo.
    echo echo Doc Maker uninstalled.
    echo echo Delete this folder manually: %%~dp0
    echo pause
)

echo.
echo   ========================================
echo     Installation complete!
echo.
echo     Start: Desktop shortcut or
echo            Start Menu - Doc Maker
echo   ========================================
echo.

set /p LAUNCH="  Launch now? [Y/n]: "
if /i not "%LAUNCH%"=="n" (
    start "" wscript.exe "%INSTALL_DIR%\DocMaker.vbs"
)

echo.
echo   Done!
pause
