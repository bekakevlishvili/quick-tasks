' Double-click to start Quick Tasks without a console window.
' (Runs the same thing as "npm start" from this folder.)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron isn't installed yet." & vbCrLf & vbCrLf & "Open a terminal in this folder and run:  npm install", vbExclamation, "Quick Tasks"
  WScript.Quit
End If
' Make sure Electron runs as an app even if a parent process set this variable.
Set env = sh.Environment("PROCESS")
env.Remove "ELECTRON_RUN_AS_NODE"
sh.Run """" & exe & """ """ & here & """", 0, False
