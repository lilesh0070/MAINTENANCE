# emu-cdp.ps1 — Android emulator me chal rahi APP ke andar seedha JS chalao.
#
# KYA KAAM AATA HAI
# -----------------
# Mobile design ka kaam karte waqt andaza lagane ki zaroorat nahi padti:
# asli app se asli naap milte hain (kaun kitna chaudha, kya kat raha hai,
# kaunsa font kitna bada), aur naya CSS turant daal kar dekha ja sakta hai —
# har baar APK banaye bina.
#
# PEHLE EK BAAR (har baar emulator restart hone par)
# --------------------------------------------------
#   $adb = "D:\dev\android-sdk\platform-tools\adb.exe"
#   # app ka WebView socket dhoondo (PID har baar badalta hai):
#   & $adb shell cat /proc/net/unix | Select-String "webview_devtools"
#   # phir us naam se port jodo:
#   & $adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
#
# CHALANE KA TAREEQA
# ------------------
#   .\emu-cdp.ps1 -Js "innerWidth + ' x ' + innerHeight"
#   .\emu-cdp.ps1 -Js @'
#     (() => {
#       const r = document.querySelector(".md-title").getBoundingClientRect();
#       return { w: Math.round(r.width), font: getComputedStyle(document.querySelector(".md-title")).fontSize };
#     })()
#   '@
#
# NAYA CSS AAZMANE KE LIYE — <style> daal do, turant dikhega:
#   .\emu-cdp.ps1 -Js '(() => { const s=document.createElement("style");
#      s.textContent="body.in-app .md-title{font-size:19px!important}";
#      document.head.appendChild(s); return "laga diya"; })()'
#
# DHYAN: ye sirf chalti hui app me daalta hai — file me kuch nahi likhta.
# Pasand aa jaye to CSS ko `src/responsive.css` me khud likhna padta hai.
param([Parameter(Mandatory=$true)][string]$Js)

$pages = Invoke-RestMethod -Uri "http://localhost:9222/json" -TimeoutSec 10
$ws = ($pages | Where-Object { $_.webSocketDebuggerUrl } | Select-Object -First 1).webSocketDebuggerUrl
if (-not $ws) { Write-Output "koi page nahi mila -- adb forward laga hai kya?"; exit 1 }

$c = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$c.ConnectAsync([Uri]$ws, $ct).Wait(10000) | Out-Null

$msg = @{
  id = 1
  method = "Runtime.evaluate"
  params = @{ expression = $Js; returnByValue = $true; awaitPromise = $true }
} | ConvertTo-Json -Depth 10 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
$seg = New-Object System.ArraySegment[byte] (,$bytes)
$c.SendAsync($seg, 'Text', $true, $ct).Wait(10000) | Out-Null

# jawab tukdon me aata hai -- poora jud jaane tak padho
$sb = New-Object System.Text.StringBuilder
$buf = New-Object byte[] 65536
do {
  $rseg = New-Object System.ArraySegment[byte] (,$buf)
  $t = $c.ReceiveAsync($rseg, $ct)
  $t.Wait(15000) | Out-Null
  $r = $t.Result
  [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
} while (-not $r.EndOfMessage)

$c.CloseAsync('NormalClosure', 'bye', $ct).Wait(3000) | Out-Null
$o = $sb.ToString() | ConvertFrom-Json
if ($o.result.exceptionDetails) {
  Write-Output "JS ERROR: $($o.result.exceptionDetails.exception.description)"
} else {
  $o.result.result.value | ConvertTo-Json -Depth 10
}
