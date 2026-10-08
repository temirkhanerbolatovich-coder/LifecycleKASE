import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/confirm-localnet-snapshot.mjs", import.meta.url));
const actionId = "464a832a-2c55-4e22-bb7a-6be93b429c78";
const operationId = "73bcf302-2322-47cb-927d-a3db7429128b";
const environment = {
  ...process.env, LOCALNET_CONFIRM_DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/lifecycle_kase",
  LOCALNET_OPERATOR_WALLET: "11111111111111111111111111111111", SOLANA_CLUSTER: "localnet",
  SOLANA_RPC_URL: "http://127.0.0.1:1", SOLANA_GENESIS_HASH: "11111111111111111111111111111111",
  WALLET_NETWORK: "SOLANA_LOCALNET"
};

function rejects(args, env, message) {
  const result = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout: 10_000 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
  assert.equal(result.stdout, "");
}

test("controlled Localnet tool rejects unsupported decisions and invalid identifiers before database access", () => {
  for (const args of [["invalid", operationId], [actionId, operationId, "APPROVE"], [actionId, operationId, "prepare-review", "extra"]]) {
    rejects(args, environment, /Usage:/);
  }
});

test("controlled Localnet tool requires explicit operator and database settings", () => {
  for (const key of ["LOCALNET_CONFIRM_DATABASE_URL", "LOCALNET_OPERATOR_WALLET"]) {
    const env = { ...environment }; delete env[key];
    rejects([actionId, operationId], env, /Explicit LOCALNET_CONFIRM_DATABASE_URL and LOCALNET_OPERATOR_WALLET are required/);
  }
});

test("controlled Localnet tool rejects external or unrelated databases and RPC endpoints", () => {
  for (const changes of [
    { LOCALNET_CONFIRM_DATABASE_URL: "postgresql://synthetic:synthetic@db.example:5432/lifecycle_kase" },
    { LOCALNET_CONFIRM_DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/production" },
    { LOCALNET_CONFIRM_DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1/lifecycle_kase" },
    { SOLANA_RPC_URL: "http://rpc.example:8899" }
  ]) for (const mode of ["prepare-review", "prepare-funding", "confirm-funding"]) {
    rejects([actionId, operationId, mode], { ...environment, ...changes }, /requires explicit loopback/);
  }
});

test("controlled Localnet tool rejects public Devnet", () => {
  for (const mode of [undefined, "prepare-review", "prepare-funding", "confirm-funding"]) {
    rejects([actionId, operationId, ...(mode ? [mode] : [])], { ...environment, SOLANA_CLUSTER: "devnet", WALLET_NETWORK: "SOLANA_DEVNET" }, /requires explicit loopback/);
  }
});
