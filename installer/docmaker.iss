[Setup]
AppName=Contractor
AppVersion=1.2.0
AppPublisher=Noam Naumovsky Productions
AppPublisherURL=https://github.com/endlessblink/contractor
DefaultDirName={userappdata}\Contractor
DefaultGroupName=Contractor
DisableProgramGroupPage=yes
OutputBaseFilename=Contractor-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
; SetupIconFile requires .ico format — using default for now
WizardStyle=modern
UninstallDisplayIcon={app}\contractor-win-x64.exe

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
begin
  if CurStep = ssPostInstall then
  begin
    VBSContent := 'Set WshShell = CreateObject("WScript.Shell")' + #13#10 +
                  'WshShell.Run Chr(34) & "' + ExpandConstant('{app}') + '\contractor-win-x64.exe" & Chr(34), 0, False' + #13#10 +
                  'WScript.Sleep 2000' + #13#10 +
                  'WshShell.Run "http://localhost:6831"' + #13#10;
    SaveStringToFile(ExpandConstant('{app}\Contractor.vbs'), VBSContent, False);
  end;
end;
