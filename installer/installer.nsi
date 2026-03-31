!include "MUI2.nsh"

; ── App Info ──
!define APPNAME "Doc Maker"
!define APPEXE "contractor-win-x64.exe"
!define APPVERSION "1.1.4"
!define PUBLISHER "Noam Naumovsky Productions"
!define WEBSITE "https://github.com/endlessblink/contractor"

Name "${APPNAME}"
OutFile "DocMaker-Setup-${APPVERSION}.exe"
InstallDir "$PROGRAMFILES\${APPNAME}"
InstallDirRegKey HKLM "Software\${APPNAME}" "Install_Dir"
RequestExecutionLevel admin

; ── UI ──
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APPNAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install ${APPNAME} ${APPVERSION} on your computer.$\r$\n$\r$\nAI-powered document generator for quotes, contracts and work orders.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APPNAME}"

; ── Pages ──
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Install ──
Section "Install"
  SetOutPath "$INSTDIR"

  ; Main executable
  File "..\dist\executables\${APPEXE}"

  ; VBS launcher (no terminal window)
  FileOpen $0 "$INSTDIR\Doc Maker.vbs" w
  FileWrite $0 'Set WshShell = CreateObject("WScript.Shell")$\r$\n'
  FileWrite $0 'WshShell.Run Chr(34) & "$INSTDIR\${APPEXE}" & Chr(34), 0, False$\r$\n'
  FileWrite $0 'WScript.Sleep 2000$\r$\n'
  FileWrite $0 'WshShell.Run "http://localhost:6831"$\r$\n'
  FileClose $0

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "wscript.exe" '"$INSTDIR\Doc Maker.vbs"' "$INSTDIR\${APPEXE}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "wscript.exe" '"$INSTDIR\Doc Maker.vbs"' "$INSTDIR\${APPEXE}" 0

  ; Registry for Add/Remove Programs
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "URLInfoAbout" "${WEBSITE}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1
SectionEnd

; ── Uninstall ──
Section "Uninstall"
  ; Kill running process
  nsExec::ExecToLog 'taskkill /f /im "${APPEXE}"'

  ; Remove files
  Delete "$INSTDIR\${APPEXE}"
  Delete "$INSTDIR\Doc Maker.vbs"
  Delete "$INSTDIR\Uninstall.exe"

  ; Remove data directory
  RMDir /r "$INSTDIR\data"
  RMDir /r "$INSTDIR\knowledge"
  RMDir /r "$INSTDIR\output"
  RMDir "$INSTDIR"

  ; Remove shortcuts
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"

  ; Remove registry
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKLM "Software\${APPNAME}"
SectionEnd
