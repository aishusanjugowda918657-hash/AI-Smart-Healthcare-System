# AI Smart Healthcare System - 6 Isolated Browser Session Launcher
# Launches 6 isolated browser sessions with independent storage (IndexedDB / localStorage)
# so login states never overwrite each other.

param (
  [string]$Browser = "auto", # "auto", "edge", or "chrome"
  [string]$BaseUrl = "http://localhost:3000"
)

# 1. Determine Browser Executable
$browserExe = ""
if ($Browser -eq "chrome" -or ($Browser -eq "auto" -and (Get-Command chrome.exe -ErrorAction SilentlyContinue))) {
  $browserExe = "chrome.exe"
} elseif ($Browser -eq "edge" -or ($Browser -eq "auto" -and (Get-Command msedge.exe -ErrorAction SilentlyContinue))) {
  $browserExe = "msedge.exe"
} else {
  # Direct path fallbacks
  $edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  $chromePath = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
  if (Test-Path $edgePath) {
    $browserExe = $edgePath
  } elseif (Test-Path $chromePath) {
    $browserExe = $chromePath
  } else {
    Write-Error "Neither Microsoft Edge nor Google Chrome was found on this system."
    exit 1
  }
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  AI Smart Healthcare System - 6 Isolated Sessions Launcher" -ForegroundColor Cyan
Write-Host "  Browser: $browserExe" -ForegroundColor Cyan
Write-Host "  Target:  $BaseUrl" -ForegroundColor Cyan
Write-Host "=================================================================`n"

# 2. Base directory for isolated session data
$sessionsDir = Join-Path $env:TEMP "smartcare_sessions"
if (!(Test-Path $sessionsDir)) {
  New-Item -ItemType Directory -Path $sessionsDir | Out-Null
}

$sessions = @(
  @{ Name = "Admin";    Role = "Admin";     Dir = "session_admin";    Url = "$BaseUrl/login" },
  @{ Name = "Doctor 1"; Role = "Doctor";    Dir = "session_doctor1";  Url = "$BaseUrl/login" },
  @{ Name = "Doctor 2"; Role = "Doctor";    Dir = "session_doctor2";  Url = "$BaseUrl/login" },
  @{ Name = "Patient 1"; Role = "Patient";  Dir = "session_patient1"; Url = "$BaseUrl/login" },
  @{ Name = "Patient 2"; Role = "Patient";  Dir = "session_patient2"; Url = "$BaseUrl/login" },
  @{ Name = "Patient 3"; Role = "Patient";  Dir = "session_patient3"; Url = "$BaseUrl/login" }
)

foreach ($s in $sessions) {
  $userDataPath = Join-Path $sessionsDir $s.Dir
  Write-Host "🚀 Launching [$($s.Name)] session ($($s.Role))..." -ForegroundColor Green
  Write-Host "   Data Directory: $userDataPath" -ForegroundColor Gray
  
  $argsList = @(
    "--user-data-dir=$userDataPath",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    $s.Url
  )
  
  Start-Process -FilePath $browserExe -ArgumentList $argsList
  Start-Sleep -Milliseconds 800
}

Write-Host "`n✅ All 6 isolated browser sessions have been launched!" -ForegroundColor Cyan
Write-Host "   Each window has its own independent IndexedDB and localStorage."
Write-Host "   Logging in or logging out in one window will NEVER affect the others.`n"
