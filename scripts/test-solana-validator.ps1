param(
    [int]$RpcPort = 18899,
    [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

$validatorCommand = Get-Command "solana-test-validator" -ErrorAction SilentlyContinue
if ($null -eq $validatorCommand) {
    throw "solana-test-validator is not installed or not available on PATH. Install the project-approved Solana CLI toolchain, then rerun npm run solana:smoke."
}

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$runPath = Join-Path $temporaryRoot ("lifecycle-kase-validator-{0}" -f [Guid]::NewGuid().ToString("N"))
$ledgerPath = Join-Path $runPath "ledger"
$stdoutPath = Join-Path $runPath "validator.stdout.log"
$stderrPath = Join-Path $runPath "validator.stderr.log"
$validatorProcess = $null

try {
    New-Item -ItemType Directory -Path $runPath | Out-Null

    $validatorProcess = Start-Process `
        -FilePath $validatorCommand.Source `
        -ArgumentList @("--ledger", $ledgerPath, "--reset", "--quiet", "--rpc-port", $RpcPort) `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath

    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $rpcUri = "http://127.0.0.1:$RpcPort"
    $requestBody = '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

    while ([DateTime]::UtcNow -lt $deadline) {
        if ($validatorProcess.HasExited) {
            $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
            throw "solana-test-validator exited before becoming healthy. $stderr"
        }

        try {
            $response = Invoke-RestMethod -Method Post -Uri $rpcUri -ContentType "application/json" -Body $requestBody -TimeoutSec 2
            if ($response.result -eq "ok") {
                Write-Output ("PASS Solana validator responded healthy at {0}" -f $rpcUri)
                exit 0
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Solana validator did not become healthy within $StartupTimeoutSeconds seconds."
}
finally {
    if ($null -ne $validatorProcess -and -not $validatorProcess.HasExited) {
        Stop-Process -Id $validatorProcess.Id -Force
        $validatorProcess.WaitForExit()
    }

    if (Test-Path -LiteralPath $runPath) {
        $resolvedRunPath = [System.IO.Path]::GetFullPath($runPath)
        if (-not $resolvedRunPath.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove validator files outside the system temporary directory: $resolvedRunPath"
        }

        Remove-Item -LiteralPath $resolvedRunPath -Recurse -Force
    }
}
