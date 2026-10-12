param(
    [ValidatePattern("^$|^localnet-candidate(?:-[a-z0-9-]+)?$")][string]$Profile = "",
    [ValidateRange(1024, 65532)][int]$RpcPort = 19240,
    [ValidateRange(1024, 65535)][int]$DatabasePort = 65485,
    [string]$WslDistribution = "Ubuntu",
    [string]$WslUser = "lifecycle-dev",
    [switch]$Reconciliation
)
$ErrorActionPreference = "Stop"
$savedMode = [Environment]::GetEnvironmentVariable("KASE_CONTROLLED_WORKFLOW", "Process")
$savedWsl = [Environment]::GetEnvironmentVariable("WSLENV", "Process")
$savedReconciliation = [Environment]::GetEnvironmentVariable("KASE_RECONCILIATION_ACCEPTANCE", "Process")
try {
    $env:KASE_CONTROLLED_WORKFLOW = "true"
    if ($Reconciliation) { $env:KASE_RECONCILIATION_ACCEPTANCE = "true" }
    $env:WSLENV = (@($savedWsl, "KASE_CONTROLLED_WORKFLOW", "KASE_RECONCILIATION_ACCEPTANCE") | Where-Object { $_ }) -join ":"
    $runnerArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "test-kase-demo.ps1"),
        "-RpcPort", $RpcPort, "-DatabasePort", $DatabasePort, "-WslDistribution", $WslDistribution, "-WslUser", $WslUser)
    if ($Profile) { $runnerArguments += @("-Profile", $Profile) }
    & powershell @runnerArguments
    if ($LASTEXITCODE -ne 0) { throw "Controlled API workflow failed on disposable infrastructure" }
}
finally {
    [Environment]::SetEnvironmentVariable("KASE_CONTROLLED_WORKFLOW", $savedMode, "Process")
    [Environment]::SetEnvironmentVariable("WSLENV", $savedWsl, "Process")
    [Environment]::SetEnvironmentVariable("KASE_RECONCILIATION_ACCEPTANCE", $savedReconciliation, "Process")
}
