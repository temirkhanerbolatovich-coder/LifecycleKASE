ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY . .
# Keep the pinned Prisma CLI for a separate, explicit migration job.
# Next.js and TypeScript are already built on the release workstation.
RUN NODE_OPTIONS=--max-old-space-size=192 npm ci --include=dev --no-audit --no-fund \
    && node scripts/run-prisma.mjs generate \
    && npm cache clean --force \
    && chown -R node:node /app
# Debian slim does not provide OpenSSL by default. Regenerate after installing
# it so Prisma chooses Debian's supported OpenSSL 3 engine rather than 1.1.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && node scripts/run-prisma.mjs generate
USER node
CMD ["node", "apps/api/dist/main.js"]
