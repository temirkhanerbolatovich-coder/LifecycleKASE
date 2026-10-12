import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { decodePublicKey, deriveCorporateActionAddresses } from "@lifecycle-kase/solana-client";

/** Real HTTP/PostgreSQL acceptance with a controlled RPC fixture; never sends a chain transaction. */
export async function testSnapshotWindowFlow({ database, request, administrator, auditor, outsider, instrument }) {
  const previousRpc = process.env.SOLANA_RPC_URL;
  const genesis = process.env.SOLANA_GENESIS_HASH;
  const recordAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 600_000);
  let wrongGenesis = false; let invalidClock = false; let wrongAction = false; let raceAction = false;
  const methods = [];
  const chainActions = new Map();
  async function seed() {
    const action = await database.corporateAction.create({ data: {
      instrumentId: instrument.id, type: "COUPON_PAYMENT", intent: "Synthetic missed-window acceptance",
      createdById: administrator.userId, status: "SCHEDULED", version: 3, recordAt,
      executeAt: new Date(recordAt.getTime() + 1_200_000)
    } });
    const addresses = await deriveCorporateActionAddresses(instrument.programId,
      Buffer.from(instrument.id.replaceAll("-", ""), "hex"), Buffer.from(action.id.replaceAll("-", ""), "hex"));
    const data = Buffer.alloc(190);
    createHash("sha256").update("account:CorporateAction").digest().subarray(0, 8).copy(data);
    data[8] = 1; Buffer.from(action.id.replaceAll("-", ""), "hex").copy(data, 9);
    Buffer.from(decodePublicKey(addresses.instrumentAddress)).copy(data, 25);
    data.writeBigInt64LE(BigInt(recordAt.getTime() / 1000), 58);
    data.writeBigInt64LE(BigInt(action.executeAt.getTime() / 1000), 66);
    data.writeBigInt64LE(BigInt(recordAt.getTime() / 1000 - 60), 149);
    data[158] = 254;
    chainActions.set(addresses.actionAddress, { action, data });
    return action;
  }
  const rpcServer = createServer(async (incoming, outgoing) => {
    try {
      let content = ""; for await (const chunk of incoming) content += chunk;
      const rpc = JSON.parse(content); methods.push(rpc.method);
      let result;
      if (rpc.method === "getGenesisHash") result = wrongGenesis ? instrument.programId : genesis;
      else if (rpc.method === "getAccountInfo") {
        assert.equal(rpc.params[1].commitment, "finalized");
        const isClock = rpc.params[0] === "SysvarC1ock11111111111111111111111111111111";
        let data;
        if (isClock) {
          data = Buffer.alloc(40); data.writeBigUInt64LE(100n);
          data.writeBigInt64LE(BigInt(recordAt.getTime() / 1000 + 601), 32);
        } else {
          assert.equal(rpc.params[1].minContextSlot, 100);
          const fixture = chainActions.get(rpc.params[0]); assert.ok(fixture);
          data = Buffer.from(fixture.data);
          if (wrongAction) data[148] = 2;
          if (raceAction) {
            raceAction = false;
            await database.corporateAction.update({ where: { id: fixture.action.id }, data: { version: { increment: 1 } } });
          }
        }
        result = { context: { slot: 100 }, value: { executable: false,
          owner: isClock ? invalidClock ? instrument.programId : "Sysvar1111111111111111111111111111111111111" : instrument.programId,
          data: [data.toString("base64"), "base64"] } };
      } else throw new Error("Unexpected RPC method: " + rpc.method);
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    } catch (error) {
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: error.message } }));
    }
  });
  await new Promise(resolve => rpcServer.listen(0, "127.0.0.1", resolve));
  process.env.SOLANA_RPC_URL = `http://127.0.0.1:${rpcServer.address().port}`;
  const post = (action, overrides = {}) => request(`/corporate-actions/${action.id}/snapshot/check-window`, {
    method: "POST", cookie: administrator.cookie, body: { expectedVersion: action.version }, ...overrides
  });
  const events = action => database.auditLog.count({ where: { corporateActionId: action.id, event: "CORPORATE_ACTION_SNAPSHOT_MISSED" } });
  try {
    const action = await seed();
    for (const [overrides, status] of [[{ cookie: undefined }, 401], [{ cookie: auditor.cookie }, 403],
      [{ cookie: outsider.cookie }, 403], [{ requestOrigin: "https://untrusted.example" }, 403],
      [{ body: { expectedVersion: "3" } }, 400], [{ body: { expectedVersion: 2 } }, 409]]) {
      assert.equal((await post(action, overrides)).status, status);
    }
    assert.deepEqual(methods, []);
    const concurrent = await Promise.all([post(action), post(action)]);
    assert.ok(concurrent.some(response => response.status === 201));
    assert.ok(concurrent.every(response => [201, 409].includes(response.status)));
    assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: action.id } })).status, "SNAPSHOT_MISSED");
    assert.equal(await events(action), 1);
    const replay = await post(action); assert.equal(replay.status, 201); assert.equal(replay.payload.changed, false);
    assert.equal(replay.payload.onChainTransition, false); assert.equal(await events(action), 1);
    const detail = await request(`/corporate-actions/${action.id}`, { cookie: auditor.cookie });
    assert.equal(detail.payload.status, "SNAPSHOT_MISSED"); assert.equal(detail.payload.version, 4);
    assert.equal(detail.payload.events.at(-1).metadataJson.onChainStatus, "SCHEDULED");

    const latePrepare = await seed();
    const capture = await request(`/corporate-actions/${latePrepare.id}/snapshot/prepare`, { method: "POST", cookie: administrator.cookie, body: {} });
    assert.equal(capture.status, 409); assert.equal(capture.payload.code, "SNAPSHOT_WINDOW_MISSED");
    assert.equal(await events(latePrepare), 1);

    const pending = await seed();
    await database.blockchainTransaction.create({ data: { corporateActionId: pending.id, instrumentId: instrument.id,
      operationType: "REGISTER_SNAPSHOT", status: "UNKNOWN_CONFIRMATION", signature: "2".repeat(88) } });
    assert.equal((await post(pending)).payload.window, "RECOVERY_REQUIRED"); assert.equal(await events(pending), 0);
    const captured = await seed();
    await database.snapshot.create({ data: { instrumentId: instrument.id, corporateActionId: captured.id, recordAt,
      networkGenesisHash: genesis, solanaSlot: 99n, blockTime: recordAt, canonicalJson: {}, snapshotHash: randomBytes(32),
      investorCount: 1, walletCount: 1, totalBalance: 35n, mintSupply: 35n } });
    assert.equal((await post(captured)).payload.window, "RECOVERY_REQUIRED"); assert.equal(await events(captured), 0);

    for (const failure of ["network", "clock", "action", "race"]) {
      const blocked = await seed();
      wrongGenesis = failure === "network"; invalidClock = failure === "clock";
      wrongAction = failure === "action"; raceAction = failure === "race";
      assert.ok([409, 503].includes((await post(blocked)).status));
      assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: blocked.id } })).status, "SCHEDULED");
      assert.equal(await events(blocked), 0);
    }
    wrongGenesis = false; invalidClock = false; wrongAction = false; raceAction = false;
    const rollback = await seed();
    await database.$executeRawUnsafe(`CREATE FUNCTION test_missed_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'CORPORATE_ACTION_SNAPSHOT_MISSED' THEN RAISE EXCEPTION 'synthetic expiry audit failure'; END IF; RETURN NEW; END $$`);
    await database.$executeRawUnsafe(`CREATE TRIGGER test_missed_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_missed_audit_failure()`);
    assert.equal((await post(rollback)).status, 500);
    const retained = await database.corporateAction.findUniqueOrThrow({ where: { id: rollback.id } });
    assert.equal(retained.status, "SCHEDULED"); assert.equal(retained.version, 3); assert.equal(await events(rollback), 0);
    await database.$executeRawUnsafe("DROP TRIGGER test_missed_audit_failure ON audit_logs");
    await database.$executeRawUnsafe("DROP FUNCTION test_missed_audit_failure()");
    assert.equal((await post(rollback)).status, 201); assert.equal(await events(rollback), 1);
    assert.ok(methods.every(method => ["getGenesisHash", "getAccountInfo"].includes(method)));
    console.log("PASS snapshot-window HTTP/PostgreSQL with RPC fixture: roles/Origin, finalized Clock/PDA, capture expiry, CAS concurrency, replay, recovery preservation and atomic audit rollback");
  } finally {
    if (previousRpc === undefined) delete process.env.SOLANA_RPC_URL; else process.env.SOLANA_RPC_URL = previousRpc;
    await new Promise((resolve, reject) => rpcServer.close(error => error ? reject(error) : resolve()));
  }
}
