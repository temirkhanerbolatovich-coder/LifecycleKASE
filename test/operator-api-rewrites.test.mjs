import assert from "node:assert/strict";
import test from "node:test";
import { operatorApiRewrites } from "../apps/web/next.config.mjs";

test("proxies only the implemented operator routes to the fixed server origin", () => {
  const routes = operatorApiRewrites({ API_SERVER_URL: "https://api.example.com", NEXT_PUBLIC_API_URL: "https://ignored.example" });
  assert.equal(routes.length, 51);
  assert.equal(routes.find((route) => route.source === "/api/v1/auth/session").destination, "https://api.example.com/api/v1/auth/session");
  assert.ok(routes.every((route) => !route.source.includes(":path")));
  assert.equal(routes[6].destination, "https://api.example.com/api/v1/instruments");
  assert.equal(routes[7].destination, "https://api.example.com/api/v1/instruments/:id/deploy/prepare");
  assert.equal(routes[8].destination, "https://api.example.com/api/v1/instruments/:id/deploy/submit");
  assert.equal(routes[9].destination, "https://api.example.com/api/v1/instruments/:id/deploy/confirm");
  assert.equal(routes[10].destination, "https://api.example.com/api/v1/investors");
  assert.equal(routes[15].destination, "https://api.example.com/api/v1/investors/:id/wallets/:walletId/verification/verify");
  assert.equal(routes[16].destination, "https://api.example.com/api/v1/corporate-actions");
  assert.equal(routes[17].destination, "https://api.example.com/api/v1/corporate-actions/:id");
  assert.deepEqual(routes.slice(18, 23).map(route => route.destination), ["prepare", "submit", "confirm", "cancel", "snapshot/submit"]
    .map(path => "https://api.example.com/api/v1/corporate-actions/:id/" + path));
  assert.deepEqual(routes.slice(23, 26).map(route => route.destination), ["entitlements", "entitlements/calculate", "entitlements/review"]
    .map(path => "https://api.example.com/api/v1/corporate-actions/:id/" + path));
  assert.deepEqual(routes.slice(26, 29).map(route => route.destination), ["entitlements/onchain/prepare", "entitlements/onchain/submit", "entitlements/onchain/confirm"]
    .map(path => `https://api.example.com/api/v1/corporate-actions/:id/${path}`));
  assert.deepEqual(routes.slice(29, 33).map(route => route.destination), ["coupon/budget", "coupon/funding/prepare", "coupon/funding/submit", "coupon/funding/confirm"]
    .map(path => "https://api.example.com/api/v1/corporate-actions/:id/" + path));
  assert.ok(routes.every((route) => route.destination.startsWith("https://api.example.com/api/v1/")));
  assert.deepEqual(routes.slice(33, 37).map(route => route.destination), ["", "/prepare", "/submit", "/confirm"]
    .map(path => "https://api.example.com/api/v1/program-upgrade" + path));
  assert.equal(routes[4].destination, "https://api.example.com/api/v1/corporate-actions/:id/snapshot/prepare");
  assert.equal(routes[37].destination, "https://api.example.com/api/v1/corporate-actions/:id/snapshot/check-window");
  assert.deepEqual(routes.slice(38, 42).map(route => route.destination), ["", "/prepare", "/submit", "/confirm"]
    .map(path => "https://api.example.com/api/v1/corporate-actions/:id/approval" + path));
  assert.deepEqual(routes.slice(42, 46).map(route => route.destination), ["", "/prepare", "/submit", "/confirm"]
    .map(path => "https://api.example.com/api/v1/corporate-actions/:id/coupon/execution" + path));
  assert.deepEqual(routes.slice(46).map(route => route.destination), ["corporate-actions/:id/receipt", "transactions", "transactions/:signature", "audit", "corporate-actions/:id/audit"]
    .map(path => "https://api.example.com/api/v1/" + path));
  assert.equal(operatorApiRewrites({})[0].destination, "http://127.0.0.1:4000/api/v1/auth/challenge");
  assert.equal(operatorApiRewrites({ API_INTERNAL_URL: "http://localhost:4010/" })[0].destination, "http://localhost:4010/api/v1/auth/challenge");
});

test("rejects credentialed, path/query-bearing, unsafe and malformed upstream configuration", () => {
  for (const API_SERVER_URL of ["https://user:secret@example.com", "https://api.example.com/private", "https://api.example.com/?target=evil", "https://api.example.com/#fragment", "http://api.example.com", "file:///etc/passwd", "invalid"]) {
    assert.throws(() => operatorApiRewrites({ API_SERVER_URL }));
  }
});
