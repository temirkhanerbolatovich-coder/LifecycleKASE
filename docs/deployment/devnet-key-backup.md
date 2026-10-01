# Owner-controlled Devnet key backup

This procedure covers only the CLI deployment payer and program identity keys. It does not back up Phantom, authorize a transaction or make this demo production custody. The original WSL JSON keys remain unencrypted, protected by local permissions only.

The owner selects an existing directory on a separate USB drive. Verify the drive identity in Windows first. For the currently inspected `D:\KASE` USB destination, run in your own interactive PowerShell terminal:

```powershell
wsl -d Ubuntu -u lifecycle-dev -- bash /mnt/c/Users/Админ/Documents/ChatGPT/LifecycleKASE/scripts/backup-devnet-keys.sh /mnt/d/KASE
```

The script requires a non-root terminal, source ownership/permissions and public identities matching `devnet-plan.json`. It creates a unique backup subdirectory without overwriting prior backups. The two JSON files pass directly through a tar/GnuPG pipeline: only an AES-256 encrypted archive is written to the destination. Enter a strong unique passphrase privately at the terminal prompts; never put it in command arguments, chat, logs, Git or environment variables. Keep the passphrase separately from the drive. GnuPG's symmetric passphrase cache is disabled for encryption and the subsequent verification; see the [official GnuPG options](https://www.gnupg.org/documentation/manuals/gnupg/GPG-Esoteric-Options.html).

Verification decrypts into `tar --compare`, not into files. Only `PASS encrypted backup decrypts and matches both source keys` with successful command exit proves this immediate comparison; an existing `.gpg` file alone does not. Save the reported SHA-256 separately, then safely eject the disk and keep it offline. Windows/WSL may retain runtime buffers; this procedure does not promise forensic erasure, protect a compromised computer or replace a later independent restore drill. The checksum detects change, not successful decryption or password recovery.

On failure/cancellation, an incomplete encrypted archive may remain in the newly printed directory; do not treat it as a verified backup. The script does not delete existing data or source keys. Losing the passphrase makes the encrypted copy unusable. Phantom recovery must be handled separately by its owner, never through this script or chat.

Validation on 2026-10-01: Bash syntax and non-interactive/root refusal checked. Actual encryption/password entry/decryption of the real keys remains owner-controlled and pending; do not mark the checklist complete until the owner confirms successful verification and offline storage.
