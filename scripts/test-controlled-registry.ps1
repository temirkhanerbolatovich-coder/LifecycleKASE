param(
    [ValidatePattern("^localnet-candidate(?:-[a-z0-9-]+)?$")][string]$Profile = "",
    [ValidateRange(1024, 65532)][int]$RpcPort = 19180,
    [string]$WslDistribution = "Ubuntu",
    [string]$WslUser = "lifecycle-dev"
)
$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$savedOutputName = $env:CANDIDATE_OUTPUT_NAME
$savedWslEnvironment = $env:WSLENV
Push-Location -LiteralPath $repoRoot
try {
    if ([string]::IsNullOrWhiteSpace($WslUser) -or $WslUser -eq "root") {
        throw "Controlled-registry acceptance requires a non-root WSL user"
    }
    if (-not $Profile) {
        $Profile = "localnet-candidate-controlled-" + (Get-Date -Format "yyyyMMdd-HHmmssfff")
        $env:CANDIDATE_OUTPUT_NAME = $Profile
        $env:WSLENV = (@($savedWslEnvironment, "CANDIDATE_OUTPUT_NAME") | Where-Object { $_ }) -join ":"
        $buildPath = (Join-Path $PSScriptRoot "build-localnet-candidate.sh").Replace("\", "/")
        $linuxBuild = & wsl -d $WslDistribution -u $WslUser -- wslpath -a $buildPath
        if ($LASTEXITCODE -ne 0) { throw "Could not resolve the isolated build script" }
        & wsl -d $WslDistribution -u $WslUser -- bash $linuxBuild
        if ($LASTEXITCODE -ne 0) { throw "Isolated controlled-registry candidate build failed" }
    }
    & npm run build --workspace @lifecycle-kase/solana-client
    if ($LASTEXITCODE -ne 0) { throw "Solana client build failed" }
    $scriptPath = (Join-Path $PSScriptRoot "test-controlled-registry.sh").Replace("\", "/")
    $linuxScript = & wsl -d $WslDistribution -u $WslUser -- wslpath -a $scriptPath
    if ($LASTEXITCODE -ne 0) { throw "Could not resolve the controlled-registry test script" }
    & wsl -d $WslDistribution -u $WslUser -- bash $linuxScript $RpcPort $Profile
    if ($LASTEXITCODE -ne 0) { throw "Controlled-registry protocol acceptance failed; inspect the generated evidence" }
}
finally {
    $env:CANDIDATE_OUTPUT_NAME = $savedOutputName
    $env:WSLENV = $savedWslEnvironment
    Pop-Location
}
