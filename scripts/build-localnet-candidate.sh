#!/usr/bin/env bash
set -euo pipefail
umask 077
if ((EUID == 0)); then
    echo 'Candidate builds must run under a non-root development user' >&2
    exit 1
fi
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
output_name="${CANDIDATE_OUTPUT_NAME:-localnet-candidate}"
if [[ ! "$output_name" =~ ^localnet-candidate-[a-z0-9-]+$ && "$output_name" != localnet-candidate ]]; then
    echo 'CANDIDATE_OUTPUT_NAME must be localnet-candidate or a lowercase localnet-candidate-* name' >&2
    exit 1
fi
output_path="$repo_root/generated/$output_name"
if [[ -e "$output_path" ]]; then
    echo 'Preserve or move previous candidate artifacts before rebuilding' >&2
    exit 1
fi
build_path="$(mktemp -d -p /tmp lifecycle-kase-candidate-build.XXXXXXXX)"
cleanup() {
    if [[ "$build_path" == /tmp/lifecycle-kase-candidate-build.* && -d "$build_path" && ! -L "$build_path" && -O "$build_path" ]]; then
        rm -r -- "$build_path"
    fi
}
trap cleanup EXIT
mkdir "$build_path/idl" "$build_path/types"
# Separate outputs preserve the accepted owner artifact. No wallet is used or program upgraded.
SBF_OUT_PATH="$build_path" anchor build --ignore-keys --provider.cluster localnet --tools-version v1.57 \
    --idl "$build_path/idl" --idl-ts "$build_path/types"
test -s "$build_path/lifecycle_kase.so"
node.exe -e 'const fs=require("node:fs"); const idl=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(idl.address!=="6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo") throw new Error("Unexpected Localnet identity"); for(const name of ["register_entitlement","finalize_calculation","reset_calculation"]) if(!idl.instructions.some(i=>i.name===name)) throw new Error("Missing candidate instruction");' "$(wslpath -w "$build_path/idl/lifecycle_kase.json")"
mkdir -p "$output_path"
cp "$build_path/lifecycle_kase.so" "$build_path/idl/lifecycle_kase.json" "$output_path/"
sha256sum "$output_path/lifecycle_kase.so"
echo 'PASS candidate build; owner artifacts and deployed program preserved'
