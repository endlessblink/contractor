#!/usr/bin/env node
/**
 * Creates a Windows installer batch file that:
 * 1. Downloads the exe from GitHub releases
 * 2. Installs to %LOCALAPPDATA%\Doc Maker
 * 3. Creates Start Menu + Desktop shortcuts
 * 4. Launches the app
 *
 * Output: install.bat (single file, double-click to install)
 */

import { writeFileSync } from 'fs';

const VERSION = '1.1.4';
const REPO = 'endlessblink/contractor';
const EXE_NAME = 'contractor-win-x64.exe';

const script = `@echo off
chcp 65001 >nul 2>&1
title Doc Maker - Installer

echo.
echo   ╔═══════════════════════════════════════╗
echo   ║       Doc Maker - Installer           ║
echo   ║       v${VERSION}                          ║
echo   ╚═══════════════════════════════════════╝
echo.

:: Check for admin (not required, install to user dir)
set "INSTALL_DIR=%LOCALAPPDATA%\\Doc Maker"
set "EXE_NAME=${EXE_NAME}"
set "APP_NAME=Doc Maker"
set "DOWNLOAD_URL=https://github.com/${REPO}/releases/download/v${VERSION}/%EXE_NAME%"

echo   Install location: %INSTALL_DIR%
echo.

:: Create install directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Download executable
echo   Downloading Doc Maker v${VERSION}...
echo   This may take a minute (about 180 MB)
echo.

powershell -Command "& { $ProgressPreference = 'SilentlyContinue'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $wc = New-Object System.Net.WebClient; $wc.DownloadFile('%DOWNLOAD_URL%', '%INSTALL_DIR%\\%EXE_NAME%') } catch { Write-Host '  ERROR: Download failed.' -ForegroundColor Red; Write-Host '  Please check your internet connection.'; Write-Host '  Or download manually from: https://github.com/${REPO}/releases'; exit 1 } }"

if not exist "%INSTALL_DIR%\\%EXE_NAME%" (
    echo.
    echo   Download failed. Please try again or download manually from:
    echo   https://github.com/${REPO}/releases
    echo.
    pause
    exit /b 1
)

echo   Download complete!
echo.

:: Create VBS launcher (runs exe without terminal window)
echo   Creating launcher...
(
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.Run Chr^(34^) ^& "%INSTALL_DIR%\\%EXE_NAME%" ^& Chr^(34^), 0, False
    echo WScript.Sleep 2000
    echo WshShell.Run "http://localhost:6831"
) > "%INSTALL_DIR%\\Doc Maker.vbs"

:: Create Start Menu shortcut
echo   Creating Start Menu shortcut...
set "START_MENU=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs"
powershell -Command "& { $ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%START_MENU%\\Doc Maker.lnk'); $sc.TargetPath = 'wscript.exe'; $sc.Arguments = '\"%INSTALL_DIR%\\Doc Maker.vbs\"'; $sc.IconLocation = '%INSTALL_DIR%\\%EXE_NAME%,0'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Description = 'AI-powered document generator'; $sc.Save() }"

:: Create Desktop shortcut
echo   Creating Desktop shortcut...
powershell -Command "& { $ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\Doc Maker.lnk'); $sc.TargetPath = 'wscript.exe'; $sc.Arguments = '\"%INSTALL_DIR%\\Doc Maker.vbs\"'; $sc.IconLocation = '%INSTALL_DIR%\\%EXE_NAME%,0'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Description = 'AI-powered document generator'; $sc.Save() }"

:: Create uninstaller
echo   Creating uninstaller...
(
    echo @echo off
    echo title Doc Maker - Uninstall
    echo echo.
    echo echo   Uninstalling Doc Maker...
    echo echo.
    echo taskkill /f /im "%EXE_NAME%" 2^>nul
    echo timeout /t 2 /nobreak ^>nul
    echo del "%START_MENU%\\Doc Maker.lnk" 2^>nul
    echo del "%USERPROFILE%\\Desktop\\Doc Maker.lnk" 2^>nul
    echo rmdir /s /q "%INSTALL_DIR%" 2^>nul
    echo echo   Doc Maker has been uninstalled.
    echo echo.
    echo pause
) > "%INSTALL_DIR%\\Uninstall.bat"

echo.
echo   ╔═══════════════════════════════════════╗
echo   ║   Installation complete!              ║
echo   ║                                       ║
echo   ║   Start: Desktop shortcut or          ║
echo   ║          Start Menu ^> Doc Maker       ║
echo   ║                                       ║
echo   ║   Uninstall: %INSTALL_DIR%\\Uninstall.bat  ║
echo   ╚═══════════════════════════════════════╝
echo.

:: Launch the app
set /p LAUNCH="  Launch Doc Maker now? [Y/n]: "
if /i "%LAUNCH%" neq "n" (
    echo   Starting Doc Maker...
    start "" wscript.exe "%INSTALL_DIR%\\Doc Maker.vbs"
)

echo.
echo   Done! You can close this window.
echo.
pause
`;

writeFileSync('install.sh', `#!/bin/bash
# Doc Maker — Linux/macOS Installer v${VERSION}
set -e
echo ""
echo "  📄 Doc Maker — Installer v${VERSION}"
echo ""
INSTALL_DIR="$HOME/.local/share/doc-maker"
mkdir -p "$INSTALL_DIR"
SUFFIX="linux-x64"
[[ "$(uname)" == "Darwin" ]] && SUFFIX="macos-arm64"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/contractor-$SUFFIX"
echo "  Downloading..."
curl -fSL "$URL" -o "$INSTALL_DIR/doc-maker" --progress-bar
chmod +x "$INSTALL_DIR/doc-maker"
# Create symlink
mkdir -p "$HOME/.local/bin"
ln -sf "$INSTALL_DIR/doc-maker" "$HOME/.local/bin/doc-maker"
echo ""
echo "  ✅ Installed! Run with: doc-maker"
echo "  Or: $INSTALL_DIR/doc-maker"
echo ""
read -p "  Launch now? [Y/n]: " launch
[[ "$launch" != "n" ]] && "$INSTALL_DIR/doc-maker" &
`);

writeFileSync('install.bat', script);
console.log('✅ Created install.bat (Windows) and install.sh (Linux/macOS)');
