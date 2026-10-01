#!/usr/bin/env bash
# GnuPG cold-start regression using synthetic data, never Devnet keys.
set -euo pipefail
umask 077
run_path="$(mktemp -d -p /tmp lifecycle-kase-backup-test.XXXXXXXX)"
cleanup() {
    gpgconf --homedir "$run_path/gnupg" --kill gpg-agent 2>/dev/null || true
    if [[ "$run_path" == /tmp/lifecycle-kase-backup-test.* && -d "$run_path" && -O "$run_path" && ! -L "$run_path" ]]; then
        rm -r -- "$run_path"
    fi
}
trap cleanup EXIT
mkdir -m 700 "$run_path/gnupg"
gpg --no-options --homedir "$run_path/gnupg" --batch --list-keys >/dev/null
test -f "$run_path/gnupg/pubring.kbx"
test "$(stat -c '%a' "$run_path/gnupg")" = 700
test_passphrase="$(openssl rand -hex 32)"
printf '%s' 'synthetic-backup-regression-data' \
    | gpg --no-options --homedir "$run_path/gnupg" --batch --no-symkey-cache \
        --pinentry-mode loopback --passphrase-fd 3 --cipher-algo AES256 \
        --symmetric --output "$run_path/fixture.gpg" 3<<<"$test_passphrase"
restored="$(gpg --no-options --homedir "$run_path/gnupg" --batch --no-symkey-cache \
    --pinentry-mode loopback --passphrase-fd 3 --decrypt "$run_path/fixture.gpg" 3<<<"$test_passphrase")"
test "$restored" = 'synthetic-backup-regression-data'
if gpg --no-options --homedir "$run_path/gnupg" --batch --no-symkey-cache \
    --pinentry-mode loopback --passphrase-fd 3 --decrypt "$run_path/fixture.gpg" \
    3<<<'deliberately-wrong-test-passphrase' >/dev/null 2>/dev/null; then
    echo 'FAIL wrong passphrase was accepted' >&2
    exit 1
fi
echo 'PASS GnuPG cold-start initialization, synthetic encryption/decryption and wrong-passphrase rejection.'
