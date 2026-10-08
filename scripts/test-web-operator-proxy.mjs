import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const nextCli = path.join(root, "node_modules/next/dist/bin/next");
const seen = [];
const backend = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  seen.push({ path: request.url, method: request.method, origin: request.headers.origin, cookie: request.headers.cookie, body });
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/api/v1/auth/verify") {
    response.setHeader("Set-Cookie", "lifecyclekase_session=synthetic-smoke-only; Path=/api/v1; HttpOnly; Secure; SameSite=Strict");
  }
  response.end(JSON.stringify({ status: "synthetic-upstream" }));
});

function nextProcess(args, environment) {
  return spawn(process.execPath, [nextCli, ...args], { cwd: path.join(root, "apps/web"), env: environment, stdio: ["ignore", "pipe", "pipe"] });
}

let web;
try {
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const apiUrl = `http://127.0.0.1:${backend.address().port}`;
  const environment = { ...process.env, API_SERVER_URL: apiUrl };
  const build = nextProcess(["build"], environment);
  let buildOutput = "";
  build.stdout.on("data", (chunk) => { buildOutput += chunk; });
  build.stderr.on("data", (chunk) => { buildOutput += chunk; });
  const [buildCode] = await once(build, "exit");
  assert.equal(buildCode, 0, buildOutput);
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const webOrigin = `http://127.0.0.1:${port}`;
  web = nextProcess(["start", "--hostname", "127.0.0.1", "--port", String(port)], environment);
  web.stdout.resume(); web.stderr.resume();
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(webOrigin + "/health/live", { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Isolated production web server did not start");
  const verify = await fetch(webOrigin + "/api/v1/auth/verify", {
    method: "POST", headers: { Origin: webOrigin, "Content-Type": "application/json" }, body: '{"synthetic":true}'
  });
  assert.equal(verify.status, 200);
  const cookies = verify.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /Path=\/api\/v1; HttpOnly; Secure; SameSite=Strict/);
  await fetch(webOrigin + "/api/v1/auth/session", { headers: { Cookie: "lifecyclekase_session=synthetic-smoke-only" } });
  const actionId = "00000000-0000-4000-8000-000000000001";
  await fetch(webOrigin + `/api/v1/corporate-actions/${actionId}/snapshot/prepare`, { method: "POST", headers: { Origin: webOrigin }, body: "{}" });
  assert.equal((await fetch(webOrigin + "/api/v1/investors")).status, 200);
  assert.equal(seen.at(-1).path, "/api/v1/investors");
  for (const phaseRoute of ["prepare", "submit", "confirm"]) {
    const route = `/api/v1/instruments/${actionId}/deploy/${phaseRoute}`;
    const body = JSON.stringify({ phase: "MINT_SETUP", synthetic: true });
    const response = await fetch(webOrigin + route, {
      method: "POST", headers: { Origin: webOrigin, Cookie: "lifecyclekase_session=synthetic-smoke-only" }, body
    });
    assert.equal(response.status, 200);
    assert.deepEqual(seen.at(-1), { path: route, method: "POST", origin: webOrigin,
      cookie: "lifecyclekase_session=synthetic-smoke-only", body });
  }
  for (const suffix of ["", `/${actionId}`, `/${actionId}/prepare`, `/${actionId}/submit`, `/${actionId}/confirm`, `/${actionId}/cancel`, `/${actionId}/snapshot/submit`,
    `/${actionId}/entitlements`, `/${actionId}/entitlements/calculate`, `/${actionId}/entitlements/review`,
    `/${actionId}/entitlements/onchain/prepare`, `/${actionId}/entitlements/onchain/submit`, `/${actionId}/entitlements/onchain/confirm`,
    `/${actionId}/coupon/budget`, `/${actionId}/coupon/funding/prepare`, `/${actionId}/coupon/funding/submit`, `/${actionId}/coupon/funding/confirm`]) {
    const route = "/api/v1/corporate-actions" + suffix;
    const method = suffix === "" || suffix === `/${actionId}` || suffix === `/${actionId}/entitlements` || suffix === `/${actionId}/coupon/budget` ? "GET" : "POST";
    const body = method === "POST" ? '{"synthetic":true}' : undefined;
    const response = await fetch(webOrigin + route, { method,
      headers: { Origin: webOrigin, Cookie: "lifecyclekase_session=synthetic-smoke-only" }, ...(body ? { body } : {}) });
    assert.equal(response.status, 200);
    assert.equal(seen.at(-1).path, route); assert.equal(seen.at(-1).method, method);
    assert.equal(seen.at(-1).cookie, "lifecyclekase_session=synthetic-smoke-only");
  }
  const beforeUnknown = seen.length;
  assert.equal((await fetch(webOrigin + "/api/v1/unimplemented-route")).status, 404);
  assert.equal(seen.length, beforeUnknown, "Unknown endpoints must not reach the backend");
  assert.equal(seen[0].origin, webOrigin);
  assert.equal(seen[0].body, '{"synthetic":true}');
  assert.equal(seen[1].cookie, "lifecyclekase_session=synthetic-smoke-only");
  assert.equal(seen[2].path, `/api/v1/corporate-actions/${actionId}/snapshot/prepare`);
  console.log("PASS production proxy: Origin/body, Strict HttpOnly cookies, action/snapshot/registry/deployment routes, unknown-route isolation");
} finally {
  if (web && web.exitCode === null) { web.kill(); await once(web, "exit"); }
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
}
