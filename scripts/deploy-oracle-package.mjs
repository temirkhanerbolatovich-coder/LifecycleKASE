import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, lstat, mkdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const changedRuntime = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "apps", "packages", "prisma", "package.json", "package-lock.json"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(name => name && !name.endsWith(".md")).join("\n");
assert.equal(changedRuntime, "", "Commit runtime changes and validate them before creating a release package");
const output = path.resolve(root, process.argv[2] ?? `.local-oracle-release-${sha.slice(0, 12)}`);
const outputRelative = path.relative(root, output);
assert.ok(outputRelative && !outputRelative.startsWith(`..${path.sep}`) && outputRelative !== ".." &&
  !path.isAbsolute(outputRelative) && path.basename(output).startsWith(".local-"),
"Output must be a new ignored .local- directory inside the checkout");
try { await stat(output); throw new Error("Output directory already exists; use a fresh .local- release directory"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(output, { recursive: true });
async function safeCopy(source, destination, extraFilter = () => true) {
  await cp(source, destination, { recursive: true, filter: async item => {
    assert.ok(!(await lstat(item)).isSymbolicLink(), `Release source must not contain symlinks: ${path.relative(root, item)}`);
    const name = path.basename(item);
    assert.ok(!/^\.env(?:\.|$)/.test(name) && !["runtime.env", "database-password"].includes(name) &&
      !/\.(?:pem|key)$/i.test(name), `Release source must not contain secret files: ${path.relative(root, item)}`);
    return extraFilter(item);
  } });
}
// Bind deployable API/domain/client output to this clean runtime source rather
// than trusting dist files left by a previous checkout or local experiment.
let npmCommand = "npm";
let npmArguments = ["run", "build", "--workspace", "@lifecycle-kase/api"];
if (process.platform === "win32") {
  const npmWrapper = execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  const npmCli = path.join(path.dirname(npmWrapper), "node_modules", "npm", "bin", "npm-cli.js");
  await stat(npmCli);
  npmCommand = process.execPath;
  npmArguments = [npmCli, ...npmArguments];
}
const apiBuild = spawn(npmCommand, npmArguments, {
  cwd: root, stdio: ["ignore", "pipe", "pipe"]
});
let apiBuildLog = "";
apiBuild.stdout.on("data", chunk => { apiBuildLog += chunk; process.stdout.write(chunk); });
apiBuild.stderr.on("data", chunk => { apiBuildLog += chunk; process.stderr.write(chunk); });
const apiBuildCode = await new Promise((resolve, reject) => { apiBuild.on("error", reject); apiBuild.on("exit", resolve); });
await writeFile(path.join(output, "api-build.log"), apiBuildLog);
assert.equal(apiBuildCode, 0, "Fresh API/domain/client build failed");
const payload = path.join(output, "payload");
const isolatedWeb = path.join(output, "build", "apps", "web");
await mkdir(isolatedWeb, { recursive: true });
for (const item of ["app", "public", "package.json", "tsconfig.json", "next.config.mjs", "postcss.config.mjs"]) {
  await safeCopy(path.join(root, "apps", "web", item), path.join(isolatedWeb, item));
}
await cp(path.join(root, "tsconfig.base.json"), path.join(output, "build", "tsconfig.base.json"));
// The copied workspace resolves dependencies from this checkout's node_modules.
const next = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: isolatedWeb,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", API_SERVER_URL: "http://127.0.0.1:4000" },
  stdio: ["ignore", "pipe", "pipe"]
});
let buildLog = "";
next.stdout.on("data", chunk => { buildLog += chunk; process.stdout.write(chunk); });
next.stderr.on("data", chunk => { buildLog += chunk; process.stderr.write(chunk); });
const buildCode = await new Promise((resolve, reject) => { next.on("error", reject); next.on("exit", resolve); });
await writeFile(path.join(output, "web-build.log"), buildLog);
assert.equal(buildCode, 0, "Isolated production web build failed");
const migrations = execFileSync("git", ["ls-files", "prisma/migrations"], { cwd: root, encoding: "utf8" })
  .trim().split(/\r?\n/).filter(name => name.endsWith(".sql") || name.endsWith("migration_lock.toml"));
const copies = ["package.json", "package-lock.json", "prisma/schema.prisma", ...migrations, "scripts/run-prisma.mjs",
  ...["Dockerfile", ".dockerignore", "compose.yaml", "Caddyfile", "lifecyclekase.service"].map(name => `deploy/oracle/${name}`)];
for (const workspace of ["apps/api", "apps/web", "packages/domain", "packages/solana-client"]) {
  copies.push(`${workspace}/package.json`);
  if (workspace !== "apps/web") copies.push(`${workspace}/dist`);
}
for (const item of copies) {
  await mkdir(path.dirname(path.join(payload, item)), { recursive: true });
  await safeCopy(path.join(root, item), path.join(payload, item), source =>
    !/\.test\.(?:js|d\.ts|js\.map)$/.test(source) && path.basename(source) !== "node_modules" &&
    !path.basename(source).startsWith(".local-"));
}
for (const item of ["public", "next.config.mjs", ".next"]) {
  await safeCopy(path.join(isolatedWeb, item), path.join(payload, "apps", "web", item),
    source => !["cache", "trace", "diagnostics", "types"].includes(path.basename(source)));
}
await cp(path.join(root, "deploy", "oracle", "Dockerfile"), path.join(payload, "Dockerfile"));
await cp(path.join(root, "deploy", "oracle", ".dockerignore"), path.join(payload, ".dockerignore"));
const manifest = { schema: "oracle-prebuilt-release-v1", source: sha, builtAt: new Date().toISOString(),
  webUpstream: "http://127.0.0.1:4000", node: process.version, containsSecrets: false,
  scope: "PREBUILT_JS_NEW_ISOLATED_DATABASE_NO_OWNER_STATE" };
await writeFile(path.join(payload, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const archive = path.join(output, "release.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", payload, "."], { stdio: "inherit" });
const { readFile } = await import("node:fs/promises");
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(path.join(output, "release.sha256"), `${digest}  release.tar.gz\n`);
console.log(JSON.stringify({ archive, sha256: digest, source: sha }, null, 2));
