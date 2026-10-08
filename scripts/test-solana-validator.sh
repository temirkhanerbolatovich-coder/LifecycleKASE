#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

rpc_port="${1:-18899}"
startup_timeout_seconds="${2:-30}"

if [[ ! "$rpc_port" =~ ^[0-9]+$ ]] || ((10#$rpc_port < 1 || 10#$rpc_port > 65532)); then
    echo "RPC port must be an integer between 1 and 65532 (RPC, websocket, faucet and gossip use adjacent ports)" >&2
    exit 1
fi
if [[ ! "$startup_timeout_seconds" =~ ^[0-9]+$ ]] || ((10#$startup_timeout_seconds < 1)); then
    echo "Startup timeout must be a positive integer" >&2
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

if ! command -v solana-test-validator >/dev/null 2>&1; then
    echo "solana-test-validator is missing from the WSL PATH" >&2
    exit 1
fi

run_path="$(mktemp -d -p /tmp lifecycle-kase-validator.XXXXXXXX)"
validator_pid=""

cleanup() {
    if [[ -n "$validator_pid" ]]; then
        kill "$validator_pid" 2>/dev/null || true
        wait "$validator_pid" 2>/dev/null || true
    fi
    if [[ "$run_path" == /tmp/lifecycle-kase-validator.* ]]; then
        rm -r -- "$run_path"
    fi
}
trap cleanup EXIT

solana-test-validator \
    --ledger "$run_path/ledger" \
    --reset \
    --quiet \
    --rpc-port "$rpc_port" \
    --faucet-port "$faucet_port" \
    --gossip-port "$gossip_port" \
    >"$run_path/validator.stdout.log" \
    2>"$run_path/validator.stderr.log" &
validator_pid=$!

deadline=$((SECONDS + startup_timeout_seconds))
while ((SECONDS < deadline)); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
        echo "Solana validator exited before becoming healthy:" >&2
        sed -n '1,40p' "$run_path/validator.stdout.log" >&2
        sed -n '1,40p' "$run_path/validator.stderr.log" >&2
        if [[ -f "$run_path/ledger/validator.log" ]]; then
            tail -n 30 "$run_path/ledger/validator.log" >&2
        fi
        exit 1
    fi

    if curl --silent --show-error --max-time 2 \
        --header 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
        "http://127.0.0.1:$rpc_port" 2>/dev/null \
        | grep -Eq '"result"[[:space:]]*:[[:space:]]*"ok"'; then
        echo "PASS Solana validator responded healthy at http://127.0.0.1:$rpc_port"
        exit 0
    fi
    sleep 0.5
done

echo "Solana validator did not become healthy within $startup_timeout_seconds seconds" >&2
sed -n '1,40p' "$run_path/validator.stdout.log" >&2
sed -n '1,40p' "$run_path/validator.stderr.log" >&2
exit 1
