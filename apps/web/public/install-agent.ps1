# pbooth agent installer for Windows (printing). Copy the exact command from the booth page; it looks like:
#   $env:PBOOTH_SERVER='https://pbooth.example.com'; $env:PBOOTH_CODE='XXXX-XXXX'; irm https://pbooth.example.com/install-agent.ps1 | iex
# Run in PowerShell as Administrator. Safe to run again (updates the agent, re-enrolls with a new code).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$server = $env:PBOOTH_SERVER; $code = $env:PBOOTH_CODE
if (-not $server -or -not $code) { throw 'Set PBOOTH_SERVER and PBOOTH_CODE first: copy the whole command from the booth page.' }
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell as Administrator (right-click > Run as administrator) and run it again.' }
$dir = 'C:\pbooth-agent'
$task = 'pbooth agent'
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Step 'Node.js 24'
$hasNode = (Get-Command node -ErrorAction SilentlyContinue) -and ((& node --version) -like 'v24.*')
if (-not $hasNode) {
  $v = (Invoke-RestMethod https://nodejs.org/dist/index.json | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1).version
  $msi = Join-Path $env:TEMP "node-$v-x64.msi"
  Write-Host "Installing Node.js $v (about a minute)..."
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$v/node-$v-x64.msi" -OutFile $msi
  Start-Process msiexec -ArgumentList "/i `"$msi`" /qn" -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
& node --version

Step 'Download the agent'
$zip = Join-Path $env:TEMP 'pbooth-agent.zip'
Invoke-WebRequest -UseBasicParsing "$server/agent.zip" -OutFile $zip
Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue | Stop-ScheduledTask
Expand-Archive $zip $dir -Force
Push-Location $dir
& npm.cmd install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE) { throw 'Installing the agent failed (see above).' }

Step 'Enroll this booth'
& node dist\main.js enroll --server $server --code $code
if ($LASTEXITCODE) { throw 'Enrollment failed. Codes work once and last 30 minutes: make a new one on the booth page and run the new command.' }

Step 'Start with Windows'
$action = New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument "--disable-warning=ExperimentalWarning $dir\dist\main.js run" -WorkingDirectory $dir
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $settings -User SYSTEM -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $task

Step 'Printers Windows sees'
& node dist\main.js doctor
Pop-Location
Write-Host "`nDone. The booth page shows the agent as connected within a minute." -ForegroundColor Green
