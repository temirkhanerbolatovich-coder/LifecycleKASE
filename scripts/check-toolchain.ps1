param(
    [string]$WslDistribution = "Ubuntu"
)

$ErrorActionPreference = "Stop"

$missingCommands = @()

foreach ($name in @("node", "npm", "docker")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        Write-Output "MISSING Windows: $name"
        $missingCommands += $name
        continue
    }

    $version = & $command.Source --version 2>&1 | Select-Object -First 1
    Write-Output ("OK      Windows: {0}: {1}" -f $name, $version)
}

if ($null -eq (Get-Command "wsl" -ErrorAction SilentlyContinue)) {
    Write-Output "MISSING WSL 2"
    $missingCommands += "wsl"
}
else {
    foreach ($name in @("rustc", "cargo", "solana", "solana-test-validator", "anchor")) {
        # Anchor builds inside WSL; checking the Windows PATH gives a false negative.
        $linuxCommand = "$name --version 2>/dev/null"
        $output = & wsl -d $WslDistribution -- bash -lc $linuxCommand 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Output ("MISSING WSL/{0}: {1}" -f $WslDistribution, $name)
            $missingCommands += $name
            continue
        }

        $version = $output | Select-Object -First 1
        Write-Output ("OK      WSL/{0}: {1}: {2}" -f $WslDistribution, $name, $version)
    }
}

if ($missingCommands.Count -gt 0) {
    Write-Error ("Missing required development tools: {0}" -f ($missingCommands -join ", "))
}
