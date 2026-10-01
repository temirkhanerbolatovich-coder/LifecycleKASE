import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateProgramIdentity, validateDevnetBinary } from "../scripts/check-program-identity.mjs";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const base = {
  rustSource: await readFile(new URL("programs/lifecycle_kase/src/lib.rs", root), "utf8"),
  anchorConfig: await readFile(new URL("Anchor.toml", root), "utf8"),
  plan: JSON.parse(await readFile(new URL("docs/deployment/devnet-plan.json", root), "utf8"))
};
const idl = { address: base.plan.programId, instructions: ["initialize_instrument", "activate_instrument", "create_corporate_action", "cancel_action", "register_snapshot"].map(name => ({ name })) };
test("keeps localnet independent while matching the declared Devnet identity", () => {
  const report = validateProgramIdentity({ ...base, idl });
  assert.equal(report.programId, base.plan.programId);
  assert.notEqual(report.localnetProgramId, report.programId);
});
test("rejects old IDL, plan mismatch, source drift and incomplete instructions", () => {
  for (const change of [
    { idl: { ...idl, address: "old-program" } },
    { plan: { ...base.plan, programId: "wrong-program" } },
    { anchorConfig: base.anchorConfig.replace(base.plan.programId, "wrong-program") },
    { rustSource: base.rustSource.replace(base.plan.programId, "wrong-program") },
    { idl: { ...idl, instructions: [] } }
  ]) assert.throws(() => validateProgramIdentity({ ...base, idl, ...change }), /mismatch|missing/);
});
test("records a public artifact digest without accepting another program binary", () => {
  const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(validateDevnetBinary(bytes, hash).artifactBytes, bytes.length);
  assert.throws(() => validateDevnetBinary(Buffer.concat([bytes, Buffer.from([2])]), hash), /differs/);
});
test("rejects non-ELF input and missing hash pins", () => {
  assert.throws(() => validateDevnetBinary(Buffer.from("not-ELF"), base.plan.artifactSha256), /ELF artifact/);
  assert.throws(() => validateDevnetBinary(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), undefined), /SHA-256 pin/);
});
