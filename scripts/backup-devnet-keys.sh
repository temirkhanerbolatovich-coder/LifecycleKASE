#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

if ((EUID == 0)); then
    echo 'Run under the non-root Devnet key owner.' >&2
    exit 1
fi
if [[ $# != 1 || ! -t 0 || ! -t 1 ]]; then
    echo 'Run interactively with one existing offline-backup destination directory. Never pass a password as an argument.' >&2
    exit 1
fi
destination="$(realpath -e -- "$1")"
if [[ ! -d "$destination" || ! -w "$destination" ]]; then
    echo 'The selected backup destination must be an existing writable directory.' >&2
    exit 1
fi
for dependency in gpg tar solana-keygen node.exe; do
    command -v "$dependency" >/dev/null
done
key_dir="$HOME/.local/share/lifecycle-kase/devnet-keys"
if [[ ! -d "$key_dir" || -L "$key_dir" || ! -O "$key_dir" || "$(stat -c '%a' "$key_dir")" != 700 ]]; then
    echo 'The source key directory must be owner-only (700), owned by this user and not a symlink.' >&2
    exit 1
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plan_path="$(wslpath -w "$repo_root/docs/deployment/devnet-plan.json")"
for entry in deployment-wallet.json:feePayer program-id.json:programId; do
    filename="${entry%%:*}"
    field="${entry##*:}"
    source_path="$key_dir/$filename"
    if [[ ! -f "$source_path" || -L "$source_path" || ! -O "$source_path" || "$(stat -c '%a' "$source_path")" != 600 ]]; then
        echo 'Both source keys must be owner-only (600), owned by this user and not symlinks.' >&2
        exit 1
    fi
    expected="$(node.exe -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]])' "$plan_path" "$field" | tr -d '\r')"
    actual="$(solana-keygen pubkey "$source_path")"
    if [[ "$actual" != "$expected" ]]; then
        echo 'A source key does not match the approved public Devnet plan.' >&2
        exit 1
    fi
done

# Only ciphertext is written to the selected drive, even on failure.
backup_dir="$(mktemp -d -p "$destination" lifecycle-kase-devnet-backup.XXXXXXXX)"
archive_path="$backup_dir/keys.tar.gpg"
verified=false
report_failure() {
    if [[ "$verified" != true ]]; then
        echo "Backup NOT VERIFIED. Incomplete encrypted output may remain in: $backup_dir" >&2
    fi
}
trap report_failure EXIT
export GPG_TTY="$(tty)"
echo 'Choose a strong, unique passphrase. Enter it only in the terminal prompt; retain it separately from this drive.'
tar -C "$key_dir" -cf - -- deployment-wallet.json program-id.json \
    | gpg --no-options --no-symkey-cache --pinentry-mode loopback \
        --cipher-algo AES256 --symmetric --output "$archive_path"
echo 'Re-enter the passphrase to verify decryption and byte-for-byte comparison. No plaintext files will be extracted.'
gpg --no-options --no-symkey-cache --pinentry-mode loopback --decrypt "$archive_path" \
    | tar -C "$key_dir" --compare -f -
sync -f "$archive_path"
verified=true
echo 'PASS encrypted backup decrypts and matches both source keys.'
sha256sum "$archive_path"
echo 'Save the checksum separately, safely eject the drive and keep it offline. This backup does not include Phantom recovery material.'
