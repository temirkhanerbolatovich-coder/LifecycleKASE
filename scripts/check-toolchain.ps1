$ErrorActionPreference = "Stop"

$requiredCommands = @(
    @{ Name = "node"; Arguments = @("--version") },
    @{ Name = "npm"; Arguments = @("--version") },
    @{ Name = "docker"; Arguments = @("--version") },
    @{ Name = "rustc"; Arguments = @("--version") },
    @{ Name = "cargo"; Arguments = @("--version") },
    @{ Name = "solana"; Arguments = @("--version") },
    @{ Name = "solana-test-validator"; Arguments = @("--version") },
    @{ Name = "anchor"; Arguments = @("--version") }
)

$missingCommands = @()

foreach ($command in $requiredCommands) {
    $resolvedCommand = Get-Command $command.Name -ErrorAction SilentlyContinue
    if ($null -eq $resolvedCommand) {
        Write-Output ("MISSING {0}" -f $command.Name)
        $missingCommands += $command.Name
        continue
    }

    $version = & $resolvedCommand.Source @($command.Arguments) 2>&1 | Select-Object -First 1
    Write-Output ("OK      {0}: {1}" -f $command.Name, $version)
}

if ($missingCommands.Count -gt 0) {
    Write-Error ("Missing required development tools: {0}" -f ($missingCommands -join ", "))
}
