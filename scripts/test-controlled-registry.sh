#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
umask 077
if ((EUID == 0)); then
    echo "Controlled-registry acceptance requires a non-root WSL user" >&2
    exit 1
fi
rpc_port="${1:-19180}"
profile="${2:-}"
if [[ ! "$rpc_port" =~ ^[0-9]+$ ]] || ((10#$rpc_port < 1024 || 10#$rpc_port > 65532)); then
    echo "RPC port must be between 1024 and 65532" >&2
    exit 1
fi
rpc_port=$((10#$rpc_port))
if [[ ! "$profile" =~ ^localnet-candidate(-[a-z0-9-]+)?$ ]]; then
    echo "Only an isolated localnet-candidate profile is accepted" >&2
    exit 1
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
candidate_path="$repo_root/generated/$profile"
program_path="$candidate_path/lifecycle_kase.so"
idl_path="$candidate_path/lifecycle_kase.json"
if [[ ! -f "$program_path" || ! -f "$idl_path" ]]; then
    echo "Build the isolated candidate before acceptance" >&2
    exit 1
fi
if ! command -v node.exe >/dev/null 2>&1 || [[ ! -d "$repo_root/tools/solana-integration/node_modules" ]]; then
    echo "Windows Node.js and the existing tools/solana-integration dependencies are required" >&2
    exit 1
fi
wsl_ip="$(hostname -I | awk '{print $1}')"
if [[ -z "$wsl_ip" ]]; then echo "Could not determine the WSL private IP" >&2; exit 1; fi
for port in "$rpc_port" "$((rpc_port + 1))" "$((rpc_port + 2))" "$((rpc_port + 3))"; do
    for host in 127.0.0.1 "$wsl_ip"; do
        if (echo > "/dev/tcp/$host/$port") >/dev/null 2>&1; then
            echo "Validator port $port is already in use on $host" >&2
            exit 1
        fi
    done
done
program_id="$(node.exe -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).address)' "$(wslpath -w "$idl_path")" | tr -d '\r')"
if [[ ! "$program_id" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
    echo "Candidate IDL has no valid program address" >&2
    exit 1
fi
run_path="$(mktemp -d -p /tmp lifecycle-kase-controlled.XXXXXXXX)"
validator_pid=""
cleanup() {
    if [[ -n "$validator_pid" ]]; then
        kill "$validator_pid" 2>/dev/null || true
        wait "$validator_pid" 2>/dev/null || true
    fi
    # The resolved target must remain this invocation's owned temporary directory.
    local resolved_run_path
    resolved_run_path="$(realpath -e -- "$run_path" 2>/dev/null || true)"
    if [[ "$resolved_run_path" == "$run_path" && "$resolved_run_path" == /tmp/lifecycle-kase-controlled.* && -d "$resolved_run_path" && -O "$resolved_run_path" && ! -L "$run_path" ]]; then
        rm -r -- "$resolved_run_path"
    fi
}
trap cleanup EXIT
solana-keygen new --no-bip39-passphrase --silent --outfile "$run_path/admin.json" >/dev/null 2>&1
administrator_pubkey="$(solana-keygen pubkey "$run_path/admin.json")"
evidence_directory="$repo_root/generated/controlled-registry-$(date -u +%Y%m%d-%H%M%S)-$(basename "$run_path")"
mkdir -m 700 "$evidence_directory"
echo "Testing $profile on a fresh disposable controlled-registry Localnet validator"
solana-test-validator --ticks-per-slot 8 --ledger "$run_path/ledger" --reset --quiet \
    --rpc-port "$rpc_port" --faucet-port "$((rpc_port + 2))" --gossip-port "$((rpc_port + 3))" \
    --bind-address "$wsl_ip" --upgradeable-program "$program_id" "$program_path" "$administrator_pubkey" \
    >"$run_path/validator.stdout.log" 2>"$run_path/validator.stderr.log" &
validator_pid=$!
deadline=$((SECONDS + 45))
while ((SECONDS < deadline)); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
        echo "Disposable validator exited before becoming healthy" >&2
        sed -n '1,60p' "$run_path/validator.stdout.log" >&2
        sed -n '1,60p' "$run_path/validator.stderr.log" >&2
        exit 1
    fi
    if curl --silent --show-error --max-time 2 --header 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://$wsl_ip:$rpc_port" 2>/dev/null \
        | grep -Eq '"result"[[:space:]]*:[[:space:]]*"ok"'; then
        cd "$repo_root"
        node.exe "$(wslpath -w "$repo_root/scripts/test-controlled-registry.mjs")" \
            "http://$wsl_ip:$rpc_port" "$(wslpath -w "$run_path/admin.json")" \
            "$(wslpath -w "$idl_path")" "$(wslpath -w "$program_path")" "$(wslpath -w "$evidence_directory")"
        exit "$?"
    fi
    sleep 0.5
done
echo "Disposable validator did not become healthy within 45 seconds" >&2
exit 1
