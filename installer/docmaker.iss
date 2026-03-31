[Setup]
AppName=Doc Maker
AppVersion=1.1.4
AppPublisher=Noam Naumovsky Productions
AppPublisherURL=https://github.com/endlessblink/contractor
DefaultDirName={userappdata}\Doc Maker
DefaultGroupName=Doc Maker
DisableProgramGroupPage=yes
OutputBaseFilename=DocMaker-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
SetupIconFile=..\assets\logo.png
WizardStyle=modern
UninstallDisplayIcon={app}\contractor-win-x64.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\executables\contractor-win-x64.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Doc Maker"; Filename: "wscript.exe"; Parameters: """{app}\DocMaker.vbs"""; IconFilename: "{app}\contractor-win-x64.exe"; WorkingDir: "{app}"
Name: "{group}\Uninstall Doc Maker"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Doc Maker"; Filename: "wscript.exe"; Parameters: """{app}\DocMaker.vbs"""; IconFilename: "{app}\contractor-win-x64.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create Desktop shortcut"; GroupDescription: "Shortcuts:"

[Run]
Filename: "wscript.exe"; Parameters: """{app}\DocMaker.vbs"""; Description: "Launch Doc Maker"; Flags: postinstall nowait skipifsilent

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
    SaveStringToFile(ExpandConstant('{app}\DocMaker.vbs'), VBSContent, False);
  end;
end;
