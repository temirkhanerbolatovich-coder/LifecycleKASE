param(
    [ValidatePattern("^localnet-candidate(?:-[a-z0-9-]+)?$")][string]$Profile = "",
    [ValidateRange(1024, 65532)][int]$RpcPort = 19060,
    [ValidateRange(1024, 65535)][int]$DatabasePort = 65479,
    [string]$WslDistribution = "Ubuntu",
    [string]$WslUser = "lifecycle-dev",
    [switch]$Video,
    [string]$PlaywrightModule = "",
    [string]$ChromiumExecutable = ""
)
$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$containerName = "lifecycle-kase-demo-" + [Guid]::NewGuid().ToString("N")
$containerId = $null
$savedEnvironment = @{}
foreach ($key in @("ACTION_TEST_DATABASE_URL", "KASE_DEMO_ACCEPTANCE", "WSLENV", "CANDIDATE_OUTPUT_NAME", "KASE_DEMO_VIDEO", "KASE_PLAYWRIGHT_MODULE", "KASE_CHROMIUM_EXECUTABLE")) {
    $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}
Push-Location -LiteralPath $repoRoot
try {
    if (-not $Profile) {
        $Profile = "localnet-candidate-kase-" + (Get-Date -Format "yyyyMMdd-HHmmssfff")
        $env:CANDIDATE_OUTPUT_NAME = $Profile
        $buildPath = (Join-Path $PSScriptRoot "build-localnet-candidate.sh").Replace("\", "/")
        $linuxBuild = & wsl -d $WslDistribution -u $WslUser -- wslpath -a $buildPath
        if ($LASTEXITCODE -ne 0) { throw "Could not resolve the isolated build script" }
        $env:WSLENV = (@($savedEnvironment["WSLENV"], "CANDIDATE_OUTPUT_NAME") | Where-Object { $_ }) -join ":"
        & wsl -d $WslDistribution -u $WslUser -- bash -lc "bash '$linuxBuild'"
        if ($LASTEXITCODE -ne 0) { throw "Isolated candidate build failed" }
    }
    $candidateDirectory = [IO.Path]::GetFullPath((Join-Path $repoRoot "generated/$Profile"))
    if (-not $candidateDirectory.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate must stay inside this workspace"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $candidateDirectory "lifecycle_kase.so"))) { throw "Build this candidate profile first" }
    $containerId = & docker run --rm -d --name $containerName -p ("127.0.0.1:" + $DatabasePort + ":5432") -e POSTGRES_DB=lifecycle_kase -e POSTGRES_USER=lifecycle_kase -e POSTGRES_PASSWORD=local_demo_only postgres:17-alpine
    if ($LASTEXITCODE -ne 0 -or $containerId -notmatch "^[0-9a-f]{64}$") { throw "Could not start disposable demo PostgreSQL" }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker exec $containerId pg_isready -U lifecycle_kase -d lifecycle_kase *> $null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }
    if ($LASTEXITCODE -ne 0) { throw "Disposable PostgreSQL did not become ready" }
    $env:ACTION_TEST_DATABASE_URL = "postgresql://lifecycle_kase:local_demo_only@127.0.0.1:" + $DatabasePort + "/lifecycle_kase?schema=public"
    $env:KASE_DEMO_ACCEPTANCE = "true"
    if ($Video) {
        if (-not (Test-Path -LiteralPath $PlaywrightModule -PathType Leaf)) { throw "Video needs -PlaywrightModule with an installed Playwright entry point" }
        $env:KASE_DEMO_VIDEO = "true"
        $env:KASE_PLAYWRIGHT_MODULE = [IO.Path]::GetFullPath($PlaywrightModule)
        if ($ChromiumExecutable) {
            if (-not (Test-Path -LiteralPath $ChromiumExecutable -PathType Leaf)) { throw "ChromiumExecutable must be an existing browser executable" }
            $env:KASE_CHROMIUM_EXECUTABLE = [IO.Path]::GetFullPath($ChromiumExecutable)
        }
        & node (Join-Path $PSScriptRoot "capture-kase-demo.mjs") --check-browser
        if ($LASTEXITCODE -ne 0) { throw "Video browser preflight failed" }
    }
    else { $env:KASE_DEMO_VIDEO = "false" }
    $env:WSLENV = (@($savedEnvironment["WSLENV"], "ACTION_TEST_DATABASE_URL", "KASE_DEMO_ACCEPTANCE", "KASE_DEMO_VIDEO", "KASE_PLAYWRIGHT_MODULE", "KASE_CHROMIUM_EXECUTABLE") | Where-Object { $_ }) -join ":"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-initialize-instrument.ps1") -RpcPort $RpcPort -WslDistribution $WslDistribution -WslUser $WslUser -Profile $Profile
    if ($LASTEXITCODE -ne 0) { throw "Three-action acceptance failed; retained owner state was not used" }
}
finally {
    if ($containerId -match "^[0-9a-f]{64}$") {
        # Stop only this invocation's container; --rm removes its disposable data.
        & docker stop $containerId *> $null
    }
    foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], "Process") }
    Pop-Location
}
