[Setup]
AppName=Contractor
AppVersion=1.2.3
AppPublisher=Noam Naumovsky Productions
AppPublisherURL=https://github.com/endlessblink/contractor
DefaultDirName={userappdata}\Contractor
DefaultGroupName=Contractor
DisableProgramGroupPage=yes
OutputBaseFilename=Contractor-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
WizardStyle=modern
UninstallDisplayIcon={app}\contractor-win-x64.exe
CloseApplications=force
CloseApplicationsFilter=contractor-win-x64.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\executables\contractor-win-x64.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Contractor"; Filename: "wscript.exe"; Parameters: """{app}\Contractor.vbs"""; IconFilename: "{app}\contractor-win-x64.exe"; WorkingDir: "{app}"
Name: "{group}\Uninstall Contractor"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Contractor"; Filename: "wscript.exe"; Parameters: """{app}\Contractor.vbs"""; IconFilename: "{app}\contractor-win-x64.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create Desktop shortcut"; GroupDescription: "Shortcuts:"

[Run]
Filename: "wscript.exe"; Parameters: """{app}\Contractor.vbs"""; Description: "Launch Contractor"; Flags: postinstall nowait skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  VBSContent: String;
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    // Kill running instance before replacing the exe
    Exec('taskkill', '/f /im contractor-win-x64.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('taskkill', '/f /im wscript.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(1000);
  end;
  if CurStep = ssPostInstall then
  begin
    VBSContent := 'Set WshShell = CreateObject("WScript.Shell")' + #13#10 +
                  'WshShell.Run Chr(34) & "' + ExpandConstant('{app}') + '\contractor-win-x64.exe" & Chr(34), 0, False' + #13#10 +
                  'WScript.Sleep 2000' + #13#10 +
                  'WshShell.Run "http://localhost:6831"' + #13#10;
    SaveStringToFile(ExpandConstant('{app}\Contractor.vbs'), VBSContent, False);
  end;
end;
