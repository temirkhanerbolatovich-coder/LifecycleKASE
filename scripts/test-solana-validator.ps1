param(
    [int]$RpcPort = 18899,
    [int]$StartupTimeoutSeconds = 30,
    [string]$WslDistribution = "Ubuntu"
)

$ErrorActionPreference = "Stop"

if ($null -eq (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
    throw "WSL 2 is required to run the Solana local-validator smoke test."
}

$scriptPath = (Join-Path $PSScriptRoot "test-solana-validator.sh").Replace('\', '/')
$linuxScriptPath = & wsl -d $WslDistribution -- wslpath -a $scriptPath
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxScriptPath)) {
    throw "Could not resolve the validator smoke-test path inside WSL/$WslDistribution."
}

& wsl -d $WslDistribution -- bash $linuxScriptPath $RpcPort $StartupTimeoutSeconds
if ($LASTEXITCODE -ne 0) {
    throw "Solana local-validator smoke test failed in WSL/$WslDistribution."
}
