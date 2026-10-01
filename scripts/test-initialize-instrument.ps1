param(
    [ValidateRange(1, 65535)][int]$RpcPort = 18898,
    [string]$WslDistribution = "Ubuntu",
    [string]$WslUser = "",
    [ValidateSet("localnet", "devnet")][string]$Profile = "localnet"
)

$ErrorActionPreference = "Stop"

& npm run build --workspace @lifecycle-kase/solana-client
if ($LASTEXITCODE -ne 0) {
    throw "Solana client build failed before the integration test."
}

if ($null -eq (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
    throw "WSL 2 is required for the on-chain integration test."
}

$scriptPath = (Join-Path $PSScriptRoot "test-initialize-instrument.sh").Replace('\', '/')
$wslArguments = @("-d", $WslDistribution)
if (-not [string]::IsNullOrWhiteSpace($WslUser)) {
    $wslArguments += @("-u", $WslUser)
}
$linuxScriptPath = & wsl @wslArguments -- wslpath -a $scriptPath
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($linuxScriptPath)) {
    throw "Could not resolve the integration test path inside WSL/$WslDistribution."
}

& wsl @wslArguments -- bash $linuxScriptPath $RpcPort $Profile
if ($LASTEXITCODE -ne 0) {
    throw "Local-validator integration test failed in WSL/$WslDistribution."
}
