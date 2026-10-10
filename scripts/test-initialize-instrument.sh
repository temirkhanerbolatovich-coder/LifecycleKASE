#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
umask 077

rpc_port="${1:-18898}"
if [[ ! "$rpc_port" =~ ^[0-9]+$ ]] || ((10#$rpc_port < 1 || 10#$rpc_port > 65532)); then
    echo "RPC port must be an integer between 1 and 65532 (RPC, websocket, faucet and gossip use adjacent ports)" >&2
    exit 1
fi
rpc_port=$((10#$rpc_port))
faucet_port=$((rpc_port + 2))
gossip_port=$((rpc_port + 3))
for port in "$rpc_port" "$((rpc_port + 1))" "$faucet_port" "$gossip_port"; do
    if (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1; then
        echo "Validator port $port is already in use" >&2
        exit 1
    fi
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${2:-localnet}"
upgrade_candidate_profile="${3:-}"
case "$profile" in
    localnet)
        program_path="$repo_root/target/deploy/lifecycle_kase.so"
        idl_path="$repo_root/target/idl/lifecycle_kase.json"
        ;;
    devnet)
        if ((EUID == 0)); then
            echo "Use a non-root WSL account for the Devnet-profile local test" >&2
            exit 1
        fi
        program_path="$repo_root/generated/devnet-build/lifecycle_kase.so"
        idl_path="$repo_root/generated/devnet-build/lifecycle_kase.json"
        ;;
    localnet-candidate|localnet-candidate-*)
        program_path="$repo_root/generated/$profile/lifecycle_kase.so"
        idl_path="$repo_root/generated/$profile/lifecycle_kase.json"
        ;;
    *) echo "Profile must be localnet, devnet or a localnet-candidate[-name]" >&2; exit 1 ;;
esac
upgrade_candidate_path=""
if [[ -n "$upgrade_candidate_profile" ]]; then
    if [[ "$profile" != localnet ]]; then
        echo "An upgrade candidate can only be tested from the retained localnet artifact" >&2
        exit 1
    fi
    if [[ ! "$upgrade_candidate_profile" =~ ^localnet-candidate-[a-z0-9-]+$ && "$upgrade_candidate_profile" != localnet-candidate ]]; then
        echo "Upgrade candidate profile must be localnet-candidate or a localnet-candidate-* name" >&2
        exit 1
    fi
    upgrade_candidate_path="$repo_root/generated/$upgrade_candidate_profile/lifecycle_kase.so"
    idl_path="$repo_root/generated/$upgrade_candidate_profile/lifecycle_kase.json"
    if [[ ! -f "$upgrade_candidate_path" || ! -f "$idl_path" ]]; then
        echo "Build the selected $upgrade_candidate_profile artifacts before the upgrade test" >&2
        exit 1
    fi
fi
if [[ ! -f "$program_path" || ! -f "$idl_path" ]]; then
    echo "Build the selected $profile artifacts before the local-validator integration test" >&2
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
if [[ "$profile" == devnet ]]; then
    node.exe "$(wslpath -w "$repo_root/scripts/check-program-identity.mjs")" \
        "$(wslpath -w "$idl_path")" "$(wslpath -w "$program_path")"
fi
if [[ "${COUPON_ACCEPTANCE:-false}" == true ]]; then
    # Coupon acceptance verifies the browser parser against real API plans; compile it without requiring a prior web build.
    node.exe "$(wslpath -w "$repo_root/node_modules/typescript/bin/tsc")" -p "$(wslpath -w "$repo_root/apps/web/tsconfig.test.json")"
fi
program_id="$(node.exe -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).address)' "$(wslpath -w "$idl_path")" | tr -d '\r')"
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
upgrade_pid=""
cleanup() {
    if [[ -n "$upgrade_pid" ]]; then
        kill "$upgrade_pid" 2>/dev/null || true
        wait "$upgrade_pid" 2>/dev/null || true
    fi
    if [[ -n "$validator_pid" ]]; then
        kill "$validator_pid" 2>/dev/null || true
        wait "$validator_pid" 2>/dev/null || true
    fi
    if [[ "$run_path" == /tmp/lifecycle-kase-integration.* && -d "$run_path" && -O "$run_path" && ! -L "$run_path" ]]; then
        rm -r -- "$run_path"
    fi
}
trap cleanup EXIT

# Genesis loading accepts a public program ID; no persistent program keypair is needed.
solana-keygen new --no-bip39-passphrase --silent --outfile "$run_path/admin.json" >/dev/null 2>&1
administrator_pubkey="$(solana-keygen pubkey "$run_path/admin.json")"
if [[ -n "$upgrade_candidate_path" ]]; then
    echo "Testing retained $profile artifact -> $upgrade_candidate_profile upgrade at $program_id on a disposable local validator"
else
    echo "Testing $profile artifact at $program_id on a disposable local validator"
fi
solana-test-validator \
    --ledger "$run_path/ledger" \
    --reset \
    --quiet \
    --rpc-port "$rpc_port" \
    --faucet-port "$faucet_port" \
    --gossip-port "$gossip_port" \
    --bind-address "$wsl_ip" \
    --upgradeable-program "$program_id" "$program_path" "$administrator_pubkey" \
    >"$run_path/validator.stdout.log" \
    2>"$run_path/validator.stderr.log" &
validator_pid=$!

if [[ -n "$upgrade_candidate_path" ]]; then
    (
        while [[ ! -f "$run_path/upgrade.request" ]]; do
            if ! kill -0 "$validator_pid" 2>/dev/null; then
                exit 1
            fi
            sleep 0.2
        done
        solana-keygen new --no-bip39-passphrase --silent --outfile "$run_path/buffer.json" >/dev/null 2>&1
        buffer_pubkey="$(solana-keygen pubkey "$run_path/buffer.json")"
        if solana program write-buffer \
            --url "http://$wsl_ip:$rpc_port" \
            --ws "ws://$wsl_ip:$((rpc_port + 1))" \
            --commitment finalized \
            --use-rpc \
            --keypair "$run_path/admin.json" \
            --fee-payer "$run_path/admin.json" \
            --buffer "$run_path/buffer.json" \
            --buffer-authority "$run_path/admin.json" \
            --output json \
            "$upgrade_candidate_path" \
            >"$run_path/upgrade.stdout.log" \
            2>"$run_path/upgrade.stderr.log" && \
            node.exe "$(wslpath -w "$repo_root/tools/solana-integration/upgrade-program.mjs")" \
                "http://$wsl_ip:$rpc_port" "$(wslpath -w "$run_path/admin.json")" \
                "$program_id" "$buffer_pubkey" "$(wslpath -w "$upgrade_candidate_path")" \
                >>"$run_path/upgrade.stdout.log" 2>>"$run_path/upgrade.stderr.log"; then
            cat "$run_path/upgrade.stdout.log"
            touch "$run_path/upgrade.success"
        else
            touch "$run_path/upgrade.failed"
        fi
    ) &
    upgrade_pid=$!
fi

deadline=$((SECONDS + 45))
while ((SECONDS < deadline)); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
        echo "Validator exited before becoming healthy:" >&2
        sed -n '1,60p' "$run_path/validator.stdout.log" >&2
        sed -n '1,60p' "$run_path/validator.stderr.log" >&2
        exit 1
    fi
    if curl --silent --show-error --max-time 2 \
        --header 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
        "http://$wsl_ip:$rpc_port" 2>/dev/null \
        | grep -Eq '"result"[[:space:]]*:[[:space:]]*"ok"'; then
        cd "$repo_root"
        client_status=0
        node.exe "$(wslpath -w "$repo_root/tools/solana-integration/test-initialize-instrument.mjs")" \
            "http://$wsl_ip:$rpc_port" "$(wslpath -w "$run_path/admin.json")" "$(wslpath -w "$idl_path")" \
            "$([[ -n "$upgrade_candidate_path" ]] && wslpath -w "$run_path" || true)" || client_status=$?
        if [[ -f "$run_path/upgrade.failed" ]]; then
            echo "Disposable program upgrade failed:" >&2
            sed -n '1,120p' "$run_path/upgrade.stdout.log" >&2
            sed -n '1,120p' "$run_path/upgrade.stderr.log" >&2
            exit 1
        fi
        exit "$client_status"
    fi
    sleep 0.5
done

echo "Validator did not become healthy within 45 seconds" >&2
sed -n '1,60p' "$run_path/validator.stdout.log" >&2
sed -n '1,60p' "$run_path/validator.stderr.log" >&2
exit 1
