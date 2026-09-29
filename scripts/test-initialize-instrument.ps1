param(
    [int]$RpcPort = 18898,
    [string]$WslDistribution = "Ubuntu"
)

$ErrorActionPreference = "Stop"

if ($null -eq (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
    throw "WSL 2 is required for the on-chain integration test."
}

$scriptPath = (Join-Path $PSScriptRoot "test-initialize-instrument.sh").Replace('\', '/')
$linuxScriptPath = & wsl -d $WslDistribution -- wslpath -a $scriptPath
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxScriptPath)) {
    throw "Could not resolve the integration test path inside WSL/$WslDistribution."
}

& wsl -d $WslDistribution -- bash $linuxScriptPath $RpcPort
if ($LASTEXITCODE -ne 0) {
    throw "Local-validator integration test failed in WSL/$WslDistribution."
}
