' start_backend.vbs -- upar wali .cmd ko BINA console window ke chalata hai.
' (schtasks me hidden ka apna flag nahi hai, isliye ye chhota shim.)
Dim sh, p
Set sh = CreateObject("WScript.Shell")
p = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "start_backend.cmd"
sh.Run """" & p & """", 0, False
