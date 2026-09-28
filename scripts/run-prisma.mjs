import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const commandArguments = {
  format: ["format"],
  generate: ["generate"],
  "migrate-deploy": ["migrate", "deploy"],
  validate: ["validate"]
};
if (!command || !(command in commandArguments)) {
  console.error(
    "Usage: node scripts/run-prisma.mjs <format|generate|migrate-deploy|validate>"
  );
  process.exit(2);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const prismaCli = path.join(repositoryRoot, "node_modules", "prisma", "build", "index.js");
const localDevelopmentUrl =
  "postgresql://lifecycle_kase:local_development_only@[::1]:55432/lifecycle_kase?schema=public";

const result = spawnSync(process.execPath, [prismaCli, ...commandArguments[command]], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    DATABASE_URL: process.env["DATABASE_URL"] ?? localDevelopmentUrl
  },
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
