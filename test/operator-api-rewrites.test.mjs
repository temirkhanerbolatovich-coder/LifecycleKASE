import assert from "node:assert/strict";
import test from "node:test";
import { operatorApiRewrites } from "../apps/web/next.config.mjs";

test("proxies only the eight implemented operator routes to the fixed server origin", () => {
  const routes = operatorApiRewrites({ API_SERVER_URL: "https://api.example.com", NEXT_PUBLIC_API_URL: "https://ignored.example" });
  assert.equal(routes.length, 8);
  assert.equal(routes.find((route) => route.source === "/api/v1/auth/session").destination, "https://api.example.com/api/v1/auth/session");
  assert.ok(routes.every((route) => !route.source.includes(":path")));
  assert.equal(routes[6].destination, "https://api.example.com/api/v1/investors");
  assert.equal(routes[7].destination, "https://api.example.com/api/v1/investors/:id/wallets");
  assert.ok(routes.every((route) => route.destination.startsWith("https://api.example.com/api/v1/")));
  assert.equal(routes[4].destination, "https://api.example.com/api/v1/corporate-actions/:id/snapshot/prepare");
  assert.equal(operatorApiRewrites({})[0].destination, "http://127.0.0.1:4000/api/v1/auth/challenge");
  assert.equal(operatorApiRewrites({ API_INTERNAL_URL: "http://localhost:4010/" })[0].destination, "http://localhost:4010/api/v1/auth/challenge");
});

test("rejects credentialed, path/query-bearing, unsafe and malformed upstream configuration", () => {
  for (const API_SERVER_URL of ["https://user:secret@example.com", "https://api.example.com/private", "https://api.example.com/?target=evil", "https://api.example.com/#fragment", "http://api.example.com", "file:///etc/passwd", "invalid"]) {
    assert.throws(() => operatorApiRewrites({ API_SERVER_URL }));
  }
});
