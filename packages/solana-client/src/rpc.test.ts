import assert from "node:assert/strict";
import test from "node:test";

import { HttpSolanaRpc, SolanaRpcError } from "./rpc.js";

test("requires a safe RPC endpoint and positive timeout", () => {
  assert.throws(() => new HttpSolanaRpc("not a URL"), /endpoint URL is invalid/);
  assert.throws(() => new HttpSolanaRpc("http://rpc.example.com"), /HTTPS or local HTTP/);
  assert.throws(() => new HttpSolanaRpc("https://user:secret@rpc.example.com"), /credentials/);
  assert.throws(() => new HttpSolanaRpc("https://rpc.example.com/#fragment"), /fragment/);
  assert.throws(() => new HttpSolanaRpc("https://rpc.example.com", 0), /timeout/);
});

test("posts JSON-RPC without following redirects", async () => {
  let observedUrl = "";
  let observedOptions: RequestInit | undefined;
  const fetchRequest: typeof fetch = async (url, options) => {
    observedUrl = String(url);
    observedOptions = options;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { slot: 42 } }), {
      status: 200
    });
  };
  const rpc = new HttpSolanaRpc("http://127.0.0.1:8899/", 1000, fetchRequest);
  assert.deepEqual(await rpc.request("getSlot", [{ commitment: "finalized" }]), { slot: 42 });
  assert.equal(observedUrl, "http://127.0.0.1:8899/");
  assert.equal(observedOptions?.method, "POST");
  assert.equal(observedOptions?.redirect, "error");
  assert.deepEqual(JSON.parse(String(observedOptions?.body)), {
    jsonrpc: "2.0",
    id: 1,
    method: "getSlot",
    params: [{ commitment: "finalized" }]
  });
});

test("rejects transport, HTTP, and malformed JSON-RPC responses", async () => {
  const rejectedFetch: typeof fetch = async () => {
    throw new Error("internal transport details");
  };
  const transport = new HttpSolanaRpc("https://rpc.example.com", 1000, rejectedFetch);
  await assert.rejects(transport.request("getSlot", []), (error: unknown) => {
    assert.ok(error instanceof SolanaRpcError);
    assert.equal(error.code, "RPC_TRANSPORT_FAILED");
    assert.doesNotMatch(error.message, /internal transport details/);
    return true;
  });

  for (const [response, code] of [
    [new Response("unavailable", { status: 503 }), "RPC_HTTP_ERROR"],
    [new Response("not json"), "INVALID_RPC_RESPONSE"],
    [new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: 1 })), "INVALID_RPC_RESPONSE"],
    [new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1 } })), "RPC_METHOD_FAILED"]
  ] as const) {
    const rpc = new HttpSolanaRpc("https://rpc.example.com", 1000, async () => response);
    await assert.rejects(rpc.request("getSlot", []), (error: unknown) => {
      assert.ok(error instanceof SolanaRpcError);
      assert.equal(error.code, code);
      return true;
    });
  }
});
