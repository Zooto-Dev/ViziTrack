# Waits for the Jarvis backend, then opens the UI as an app window.
$url = 'http://127.0.0.1:8765'
for ($i = 0; $i -lt 120; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "$url/api/health" -TimeoutSec 1 | Out-Null; break }
  catch { Start-Sleep -Milliseconds 500 }
}
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$url", "--window-size=1440,900"
} else {
  Start-Process $url
}
