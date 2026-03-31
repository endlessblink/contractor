Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\contractor-win-x64.exe" & Chr(34), 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:6831"
