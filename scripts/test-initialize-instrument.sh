#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

rpc_port="${1:-18898}"
if [[ ! "$rpc_port" =~ ^[0-9]+$ ]] || ((10#$rpc_port < 1 || 10#$rpc_port > 65535)); then
    echo "RPC port must be an integer between 1 and 65535" >&2
    exit 1
fi
if (echo > "/dev/tcp/127.0.0.1/$rpc_port") >/dev/null 2>&1; then
    echo "RPC port $rpc_port is already in use" >&2
    exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
program_path="$repo_root/target/deploy/lifecycle_kase.so"
if [[ ! -f "$program_path" || ! -f "$repo_root/target/idl/lifecycle_kase.json" ]]; then
    echo "Run anchor build before the local-validator integration test" >&2
    exit 1
fi
if ! command -v node.exe >/dev/null 2>&1; then
    echo "Windows Node.js is required for the integration test client" >&2
    exit 1
fi
if [[ ! -d "$repo_root/tools/solana-integration/node_modules" ]]; then
    echo "Run npm ci --prefix tools/solana-integration before the local-validator integration test" >&2
    exit 1
fi
program_id="$(cd "$repo_root" && node.exe -p "require('./target/idl/lifecycle_kase.json').address" | tr -d '\r')"
if [[ ! "$program_id" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
    echo "The built Anchor IDL does not contain a valid program address" >&2
    exit 1
fi
wsl_ip="$(hostname -I | awk '{print $1}')"
if [[ -z "$wsl_ip" ]]; then
    echo "Could not determine the WSL private IP address" >&2
    exit 1
fi

run_path="$(mktemp -d -p /tmp lifecycle-kase-integration.XXXXXXXX)"
validator_pid=""
cleanup() {
    if [[ -n "$validator_pid" ]]; then
        kill "$validator_pid" 2>/dev/null || true
        wait "$validator_pid" 2>/dev/null || true
    fi
    if [[ "$run_path" == /tmp/lifecycle-kase-integration.* ]]; then
        rm -r -- "$run_path"
    fi
}
trap cleanup EXIT

solana-test-validator \
    --ledger "$run_path/ledger" \
    --reset \
    --quiet \
    --rpc-port "$rpc_port" \
    --bind-address "$wsl_ip" \
    >"$run_path/validator.stdout.log" \
    2>"$run_path/validator.stderr.log" &
validator_pid=$!

deadline=$((SECONDS + 45))
while ((SECONDS < deadline)); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
        echo "Validator exited before becoming healthy:" >&2
        sed -n '1,60p' "$run_path/validator.stderr.log" >&2
        exit 1
    fi
    if curl --silent --show-error --max-time 2 \
        --header 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
        "http://$wsl_ip:$rpc_port" 2>/dev/null \
        | grep -Eq '"result"[[:space:]]*:[[:space:]]*"ok"'; then
        solana-keygen new --no-bip39-passphrase --silent --outfile "$run_path/admin.json" >/dev/null
        administrator_pubkey="$(solana-keygen pubkey "$run_path/admin.json")"
        solana airdrop 10 "$administrator_pubkey" --url "http://$wsl_ip:$rpc_port" >/dev/null
        solana program deploy "$program_path" \
            --program-id "$repo_root/target/deploy/lifecycle_kase-keypair.json" \
            --upgrade-authority "$run_path/admin.json" \
            --keypair "$run_path/admin.json" \
            --url "http://$wsl_ip:$rpc_port" >/dev/null
        cd "$repo_root"
        node.exe "$(wslpath -w "$repo_root/tools/solana-integration/test-initialize-instrument.mjs")" \
            "http://$wsl_ip:$rpc_port" "$(wslpath -w "$run_path/admin.json")"
        exit 0
    fi
    sleep 0.5
done

echo "Validator did not become healthy within 45 seconds" >&2
sed -n '1,60p' "$run_path/validator.stderr.log" >&2
exit 1
