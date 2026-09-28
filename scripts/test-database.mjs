import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const testSql = await readFile(
  path.join(repositoryRoot, "test", "database-guards.sql"),
  "utf8"
);

const result = spawnSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "lifecycle_kase",
    "-d",
    "lifecycle_kase"
  ],
  {
    cwd: repositoryRoot,
    input: testSql,
    stdio: ["pipe", "inherit", "inherit"]
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
