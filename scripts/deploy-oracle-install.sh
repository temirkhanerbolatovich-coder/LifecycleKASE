#!/usr/bin/env bash
set -euo pipefail

# Run only for the explicitly approved host and new LifecycleKASE environment.
archive=${1:?Usage: deploy-oracle-install.sh archive sha256 source_sha public_hostname}
digest=${2:?Missing archive SHA-256}
source_sha=${3:?Missing checked source SHA}
public_hostname=${4:?Missing approved public hostname}
[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
[[ $digest =~ ^[0-9a-f]{64}$ && $source_sha =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid SHA.' >&2; exit 1; }
[[ $public_hostname =~ ^[a-z0-9][a-z0-9.-]+\.duckdns\.org$ ]] || { echo 'Expected an approved DuckDNS hostname.' >&2; exit 1; }
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --status

base=/opt/lifecyclekase
release="$base/releases/$source_sha"
for own_path in "$base" "$base/releases" "$base/config" "$base/submission" "$release"; do
  [[ ! -L "$own_path" ]] || { echo 'Refusing a symlink in the isolated deployment paths.' >&2; exit 1; }
done
if [[ -e "$base/current" && ! -L "$base/current" ]]; then
  echo 'Refusing to replace a non-symlink current path.' >&2; exit 1
fi
install -d -m 755 "$base" "$base/releases" "$base/submission"
install -d -m 700 "$base/config"
if [[ -e "$release" ]]; then
  echo 'Release directory already exists; inspect it before retrying.' >&2; exit 1
fi
install -d -m 755 "$release"
tar -xzf "$archive" -C "$release"
manifest_sha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source"])' "$release/release-manifest.json")
[[ $manifest_sha == "$source_sha" ]] || { echo 'Release source mismatch.' >&2; exit 1; }

# Docker build happens before secrets are linked into the release context.
# The shared 1GB host must retain capacity for the live site and Telegram bot.
# This VPS currently uses Docker's legacy builder; BuildKit ignores these build
# resource flags, so keep this explicit until images are built outside the VPS.
DOCKER_BUILDKIT=0 docker build --memory=384m --memory-swap=384m \
  --cpu-period=100000 --cpu-quota=50000 \
  --tag "lifecyclekase-runtime:$source_sha" "$release"
umask 077
if [[ ! -f "$base/config/database-password" ]]; then
  openssl rand -hex 24 > "$base/config/database-password"
fi
database_password=$(cat "$base/config/database-password")
[[ $database_password =~ ^[0-9a-f]{48}$ ]] || { echo 'Invalid isolated database password format.' >&2; exit 1; }
cat > "$base/config/runtime.env" <<EOF
NODE_ENV=production
PORT=4000
API_LISTEN_HOST=127.0.0.1
DATABASE_URL=postgresql://lifecyclekase_submission:$database_password@127.0.0.1:65432/lifecyclekase_submission?schema=public&connection_limit=8
AUTH_ENABLED=true
AUTH_DOMAIN=$public_hostname
AUTH_ALLOWED_ORIGINS=https://$public_hostname
AUTH_COOKIE_SECURE=true
AUTH_CHALLENGE_RATE_LIMIT=5
AUTH_VERIFY_RATE_LIMIT=10
MUTATION_RATE_LIMIT=20
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_RATE_LIMIT_MAX_CLIENTS=10000
TRUST_PROXY_HOPS=1
LOCALNET_PROGRAM_UPGRADE_ENABLED=false
ACTION_APPROVAL_RESERVE_ENABLED=false
COUPON_EXECUTION_ENABLED=false
ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED=false
REDEMPTION_EXECUTION_ENABLED=false
EXACT_TARGET_REDEMPTION_ENABLED=false
CONTROLLED_REGISTRY_ENABLED=false
RECONCILIATION_WORKER_ENABLED=false
EOF
cat > "$base/config/compose.env" <<EOF
RELEASE_SHA=$source_sha
PUBLIC_HOSTNAME=$public_hostname
DATABASE_PASSWORD=$database_password
EOF
ln -s "$base/config/runtime.env" "$release/deploy/oracle/runtime.env"
ln -s "$base/config/compose.env" "$release/deploy/oracle/.env"
cd "$release/deploy/oracle"
docker compose config --quiet
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
docker compose up -d postgres
for attempt in {1..40}; do
  if docker compose exec -T postgres pg_isready -U lifecyclekase_submission -d lifecyclekase_submission >/dev/null 2>&1; then break; fi
  sleep 2
done
docker compose exec -T postgres pg_isready -U lifecyclekase_submission -d lifecyclekase_submission >/dev/null
docker compose --profile maintenance run --rm --no-deps migrate
# Only this project's symlink and service are changed. Other Compose projects,
# existing PostgreSQL volumes and Telegram services are never inspected for data.
ln -sfn "$release" "$base/current"
install -m 644 "$release/deploy/oracle/lifecyclekase.service" /etc/systemd/system/lifecyclekase.service
systemctl daemon-reload
systemctl enable lifecyclekase.service
# An active oneshot unit does not rerun ExecStart after the release symlink
# changes. Apply the new image explicitly to this named project, then start the
# unit only if it was inactive; no other project's unit is restarted.
docker compose up -d postgres api web caddy
systemctl start lifecyclekase.service
docker compose ps --format json
systemctl is-active timschedulebot.service
echo 'LifecycleKASE isolated runtime installed. Verify public HTTPS, health, DNS and media before submission.'
