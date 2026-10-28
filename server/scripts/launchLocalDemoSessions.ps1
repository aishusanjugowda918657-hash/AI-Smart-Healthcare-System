# AI Smart Healthcare System - 16 Isolated Chrome Sessions Launcher
# Launches 16 independent Chrome browser sessions with isolated user-data directories
# for concurrent multi-role testing against the local emulator environment.

param (
  [string]$Browser = "chrome",
  [string]$BaseUrl = "http://localhost:3000",
  [string]$BackendUrl = "http://localhost:5000",
  [string]$Group = "all",         # "all", "staff", "doctors", "patients", "admin", or specific identity
  [switch]$SkipHealthCheck = $false
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  SMARTCARE AI - 16 ISOLATED LOCAL DEMO SESSIONS LAUNCHER" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. HARD SAFETY CHECK: VERIFY LOCAL DEMO ENVIRONMENT
if (-not $SkipHealthCheck) {
  Write-Host "1. Verifying Local Demo Environment Health..." -ForegroundColor Yellow
  try {
    $healthResp = Invoke-RestMethod -Uri "$BackendUrl/api/health/env" -Method Get -TimeoutSec 5
    if (-not $healthResp.success -or -not $healthResp.data.isEmulator) {
      Write-Host ""
      Write-Host "[CRITICAL SAFETY VIOLATION] Target backend is NOT running in Emulator mode!" -ForegroundColor Red
      Write-Host "   Detected Project:    $($healthResp.data.projectId)" -ForegroundColor Red
      Write-Host "   isEmulator Flag:     $($healthResp.data.isEmulator)" -ForegroundColor Red
      Write-Host "   Aborting session launch to protect real Firebase data." -ForegroundColor Red
      Write-Host "   Please start the emulator environment with: npm run demo:server" -ForegroundColor Yellow
      Write-Host ""
      exit 1
    }
    Write-Host "   [OK] Backend verified: Running in EMULATOR mode (Project: $($healthResp.data.projectId))" -ForegroundColor Green
  } catch {
    Write-Host ""
    Write-Host "[ERROR] Unable to reach backend health endpoint at $BackendUrl/api/health/env" -ForegroundColor Red
    Write-Host "   Ensure backend is running in emulator mode on Port 5000." -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    Write-Host ""
    exit 1
  }

  try {
    $frontendCheck = Invoke-WebRequest -Uri "$BaseUrl" -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
    Write-Host "   [OK] Frontend verified: Responding on $BaseUrl (HTTP $($frontendCheck.StatusCode))" -ForegroundColor Green
  } catch {
    Write-Host "   [NOTICE] Frontend not responding on $BaseUrl. Continuing, but please verify frontend is running." -ForegroundColor Yellow
  }
  Write-Host ""
}

# 2. Locate Browser Executable
$browserExe = ""
$chromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

foreach ($c in $chromeCandidates) {
  if (Test-Path $c) {
    $browserExe = $c
    break
  }
}

if (-not $browserExe) {
  if (Get-Command chrome.exe -ErrorAction SilentlyContinue) {
    $browserExe = "chrome.exe"
  } elseif (Test-Path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") {
    $browserExe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    Write-Host "[INFO] Google Chrome not found at standard path, falling back to Microsoft Edge." -ForegroundColor Yellow
  } else {
    Write-Host "[ERROR] Neither Google Chrome nor Microsoft Edge could be found on this system." -ForegroundColor Red
    exit 1
  }
}
Write-Host "2. Browser Executable: $browserExe" -ForegroundColor Green

# 3. Base Directory for Isolated Demo Profiles
$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$profilesBaseDir = Join-Path $rootDir "local-demo-profiles"

if (-not (Test-Path $profilesBaseDir)) {
  New-Item -ItemType Directory -Path $profilesBaseDir -Force | Out-Null
}
Write-Host "3. Isolated Profiles Root: $profilesBaseDir" -ForegroundColor Green
Write-Host ""

# 4. Define the 16 Dedicated Demo Identities
$allSessions = @(
  # Admin
  @{
    Id    = "admin"
    Name  = "Demo Administrator"
    Role  = "admin"
    Group = "admin"
    Email = "demo.admin@smartcare.local"
    Dir   = "admin"
    Url   = "$BaseUrl/login?email=demo.admin@smartcare.local"
    Pos   = "0,0"
  },

  # Doctors
  @{
    Id    = "doctor-general1"
    Name  = "Dr. Demo General One"
    Role  = "doctor"
    Group = "doctors"
    Email = "demo.general1@smartcare.local"
    Dir   = "doctor-general1"
    Url   = "$BaseUrl/login?email=demo.general1@smartcare.local"
    Pos   = "100,50"
  },
  @{
    Id    = "doctor-general2"
    Name  = "Dr. Demo General Two"
    Role  = "doctor"
    Group = "doctors"
    Email = "demo.general2@smartcare.local"
    Dir   = "doctor-general2"
    Url   = "$BaseUrl/login?email=demo.general2@smartcare.local"
    Pos   = "200,100"
  },
  @{
    Id    = "doctor-cardiology"
    Name  = "Dr. Demo Cardiology One"
    Role  = "doctor"
    Group = "doctors"
    Email = "demo.cardiology1@smartcare.local"
    Dir   = "doctor-cardiology"
    Url   = "$BaseUrl/login?email=demo.cardiology1@smartcare.local"
    Pos   = "300,150"
  },

  # Staff
  @{
    Id    = "reception"
    Name  = "Demo Reception Staff"
    Role  = "reception"
    Group = "staff"
    Email = "demo.reception@smartcare.local"
    Dir   = "reception"
    Url   = "$BaseUrl/login?email=demo.reception@smartcare.local"
    Pos   = "400,200"
  },
  @{
    Id    = "nurse"
    Name  = "Demo Triage Nurse"
    Role  = "nurse"
    Group = "staff"
    Email = "demo.nurse@smartcare.local"
    Dir   = "nurse"
    Url   = "$BaseUrl/login?email=demo.nurse@smartcare.local"
    Pos   = "500,250"
  },
  @{
    Id    = "pharmacy"
    Name  = "Demo Pharmacy Staff"
    Role  = "pharmacy"
    Group = "staff"
    Email = "demo.pharmacy@smartcare.local"
    Dir   = "pharmacy"
    Url   = "$BaseUrl/login?email=demo.pharmacy@smartcare.local"
    Pos   = "600,300"
  },

  # 10 Patients
  @{ Id = "patient01"; Name = "Demo Patient Alex";    Role = "patient"; Group = "patients"; Email = "demo.patient01@smartcare.local"; Dir = "patient01"; Url = "$BaseUrl/login?email=demo.patient01@smartcare.local"; Pos = "50,50" },
  @{ Id = "patient02"; Name = "Demo Patient Brenda";  Role = "patient"; Group = "patients"; Email = "demo.patient02@smartcare.local"; Dir = "patient02"; Url = "$BaseUrl/login?email=demo.patient02@smartcare.local"; Pos = "100,80" },
  @{ Id = "patient03"; Name = "Demo Patient Charlie"; Role = "patient"; Group = "patients"; Email = "demo.patient03@smartcare.local"; Dir = "patient03"; Url = "$BaseUrl/login?email=demo.patient03@smartcare.local"; Pos = "150,110" },
  @{ Id = "patient04"; Name = "Demo Patient Diana";   Role = "patient"; Group = "patients"; Email = "demo.patient04@smartcare.local"; Dir = "patient04"; Url = "$BaseUrl/login?email=demo.patient04@smartcare.local"; Pos = "200,140" },
  @{ Id = "patient05"; Name = "Demo Patient Ethan";   Role = "patient"; Group = "patients"; Email = "demo.patient05@smartcare.local"; Dir = "patient05"; Url = "$BaseUrl/login?email=demo.patient05@smartcare.local"; Pos = "250,170" },
  @{ Id = "patient06"; Name = "Demo Patient Fiona";   Role = "patient"; Group = "patients"; Email = "demo.patient06@smartcare.local"; Dir = "patient06"; Url = "$BaseUrl/login?email=demo.patient06@smartcare.local"; Pos = "300,200" },
  @{ Id = "patient07"; Name = "Demo Patient George";  Role = "patient"; Group = "patients"; Email = "demo.patient07@smartcare.local"; Dir = "patient07"; Url = "$BaseUrl/login?email=demo.patient07@smartcare.local"; Pos = "350,230" },
  @{ Id = "patient08"; Name = "Demo Patient Hannah";  Role = "patient"; Group = "patients"; Email = "demo.patient08@smartcare.local"; Dir = "patient08"; Url = "$BaseUrl/login?email=demo.patient08@smartcare.local"; Pos = "400,260" },
  @{ Id = "patient09"; Name = "Demo Patient Ian";     Role = "patient"; Group = "patients"; Email = "demo.patient09@smartcare.local"; Dir = "patient09"; Url = "$BaseUrl/login?email=demo.patient09@smartcare.local"; Pos = "450,290" },
  @{ Id = "patient10"; Name = "Demo Patient Julia";   Role = "patient"; Group = "patients"; Email = "demo.patient10@smartcare.local"; Dir = "patient10"; Url = "$BaseUrl/login?email=demo.patient10@smartcare.local"; Pos = "500,320" }
)

# 5. Filter Sessions based on Group parameter
$selectedSessions = @()
if ($Group -eq "all") {
  $selectedSessions = $allSessions
} elseif ($Group -eq "admin") {
  $selectedSessions = $allSessions | Where-Object { $_.Role -eq "admin" }
} elseif ($Group -eq "staff") {
  $selectedSessions = $allSessions | Where-Object { $_.Group -eq "staff" }
} elseif ($Group -eq "doctors") {
  $selectedSessions = $allSessions | Where-Object { $_.Group -eq "doctors" }
} elseif ($Group -eq "patients") {
  $selectedSessions = $allSessions | Where-Object { $_.Group -eq "patients" }
} else {
  $selectedSessions = $allSessions | Where-Object { $_.Id -eq $Group -or $_.Role -eq $Group }
  if ($selectedSessions.Count -eq 0) {
    Write-Host "[NOTICE] Unknown group '$Group'. Defaulting to all sessions." -ForegroundColor Yellow
    $selectedSessions = $allSessions
  }
}

Write-Host "4. Launching $($selectedSessions.Count) Isolated Browser Sessions (Group: $Group):" -ForegroundColor Cyan
Write-Host "   Each session uses its own independent user-data-dir (no shared cookies, no shared localStorage)."
Write-Host ""

$results = @()
$counter = 1

foreach ($s in $selectedSessions) {
  $userDataPath = Join-Path $profilesBaseDir $s.Dir
  if (-not (Test-Path $userDataPath)) {
    New-Item -ItemType Directory -Path $userDataPath -Force | Out-Null
  }

  $argsList = @(
    "--user-data-dir=$userDataPath",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1100,750",
    "--window-position=$($s.Pos)",
    "--new-window",
    $s.Url
  )

  try {
    $proc = Start-Process -FilePath $browserExe -ArgumentList $argsList -PassThru
    Write-Host "   [$counter/$($selectedSessions.Count)] [OK] Launched $($s.Name) ($($s.Role))" -ForegroundColor Green
    Write-Host "        Email:    $($s.Email)" -ForegroundColor Gray
    Write-Host "        Profile:  $userDataPath" -ForegroundColor DarkGray
    $results += [PSCustomObject]@{
      Identity = $s.Name
      Role     = $s.Role
      Email    = $s.Email
      PID      = $proc.Id
      Status   = "LAUNCHED"
    }
  } catch {
    Write-Host "   [$counter/$($selectedSessions.Count)] [FAILED] Could not launch $($s.Name): $($_.Exception.Message)" -ForegroundColor Red
    $results += [PSCustomObject]@{
      Identity = $s.Name
      Role     = $s.Role
      Email    = $s.Email
      PID      = $null
      Status   = "FAILED"
    }
  }

  $counter++
  Start-Sleep -Milliseconds 400
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  LAUNCH SUMMARY" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize

Write-Host "[CREDENTIALS NOTICE]" -ForegroundColor Yellow
Write-Host "   The passwords for all demo identities were generated during seeding."
Write-Host "   To view credentials securely, inspect: server/.local/demo_credentials.json"
Write-Host ""
