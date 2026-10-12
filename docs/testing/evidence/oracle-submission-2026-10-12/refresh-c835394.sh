#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]]
archive=${1:?Missing release archive}
digest=64ca353f54f63c530bfc190b0291ee76229096a429532ba016fb4ffb602dbd92
source_sha=c835394fb881fed7086cb59c8a3adcf86c857584
base=/opt/lifecyclekase
previous="$base/releases/f51be252295af181ed931f00dba1ee89c35aedef"
release="$base/releases/$source_sha"
reviewed_image=sha256:57c7b1f5d9d3d82b382c8f5cc2177fec1ffe0be32558d9af9bc81b3bfee9742d
[[ $(readlink -f "$base/current") == "$previous" ]]
[[ $(docker inspect --format '{{.Image}}' lifecyclekase-api-1) == "$reviewed_image" ]]
[[ $(docker inspect --format '{{.Image}}' lifecyclekase-web-1) == "$reviewed_image" ]]
for own_path in "$base" "$base/releases" "$base/config" "$release"; do [[ ! -L "$own_path" ]]; done
[[ ! -e "$release" ]]
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --status
install -d -m 755 "$release"
tar -xzf "$archive" -C "$release"
[[ $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source"])' "$release/release-manifest.json") == "$source_sha" ]]

# Reuse only immutable Linux dependency layers whose inputs match this release.
# No host npm/apt installation is needed for the unchanged lockfile/schema.
docker run --rm --network=none --memory=128m --cpus=0.25 \
  --volume "$release:/expected:ro" --entrypoint node "$reviewed_image" \
  --max-old-space-size=64 -e '
const fs=require("node:fs"),assert=require("node:assert/strict");
const files=["package.json","package-lock.json","prisma/schema.prisma","apps/api/package.json","apps/web/package.json","packages/domain/package.json","packages/solana-client/package.json"];
function visit(relative){for(const item of fs.readdirSync("/expected/"+relative,{withFileTypes:true})){const file=relative+"/"+item.name;if(item.isDirectory())visit(file);else{assert.ok(item.isFile());files.push(file);}}}
visit("prisma/migrations");
for(const file of files)assert.ok(fs.readFileSync("/app/"+file).equals(fs.readFileSync("/expected/"+file)),"Dependency/schema input mismatch: "+file);
console.log("Immutable base dependency/schema inputs match ("+files.length+" files)");'
docker tag "$reviewed_image" "lifecyclekase-reviewed-base:$source_sha"
dockerfile="/tmp/lifecyclekase-copy-$source_sha.Dockerfile"
cat > "$dockerfile" <<EOF
FROM lifecyclekase-reviewed-base:$source_sha
USER root
RUN rm -rf /app/apps/web/.next /app/apps/api/dist /app/packages/domain/dist /app/packages/solana-client/dist
COPY --chown=node:node . /app
LABEL org.opencontainers.image.revision=$source_sha
USER node
EOF
DOCKER_BUILDKIT=0 docker build --memory=384m --memory-swap=384m --cpu-period=100000 --cpu-quota=50000 \
  --file "$dockerfile" --tag "lifecyclekase-runtime:$source_sha" "$release"
umask 077
activation_backup="$base/backups/activate-$source_sha"
[[ ! -e "$activation_backup" ]]
install -d -m 700 "$activation_backup"
cp -a "$base/config/compose.env" "$activation_backup/compose.env"
printf '%s\n' "$previous" > "$activation_backup/previous-release"
switched=false
rollback(){
  local failure=$?
  trap - ERR
  if [[ $switched == true ]]; then
    cp -a "$activation_backup/compose.env" "$base/config/compose.env"
    ln -sfn "$previous" "$base/current"
    (cd "$previous/deploy/oracle" && docker compose up -d --no-deps api web caddy)
    echo 'Candidate health failed; previous release restored.' >&2
  fi
  exit "$failure"
}
trap rollback ERR
switched=true
sed -i "s/^RELEASE_SHA=.*/RELEASE_SHA=$source_sha/" "$base/config/compose.env"
ln -s "$base/config/runtime.env" "$release/deploy/oracle/runtime.env"
ln -s "$base/config/compose.env" "$release/deploy/oracle/.env"
cd "$release/deploy/oracle"
docker compose config --quiet
[[ $(docker compose exec -T postgres psql -U lifecyclekase_submission -d lifecyclekase_submission -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL') == 23 ]]
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
ln -sfn "$release" "$base/current"
docker compose up -d --no-deps api web caddy
healthy=false
for attempt in {1..30}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:4000/api/v1/health/ready >/dev/null && \
     curl --fail --silent --max-time 3 http://127.0.0.1:3000/health/live >/dev/null; then healthy=true; break; fi
  sleep 3
done
[[ $healthy == true ]]
trap - ERR
systemctl is-enabled lifecyclekase.service
systemctl is-active lifecyclekase.service timschedulebot.service
docker inspect --format '{{.Name}} image={{.Image}} restart={{.HostConfig.RestartPolicy.Name}} oom={{.State.OOMKilled}}' lifecyclekase-api-1 lifecyclekase-web-1
echo "Checked prebuilt runtime activated: $source_sha"
