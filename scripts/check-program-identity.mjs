import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

/** Refuse a mixed-cluster artifact before any deployment tooling can use it. */
export function validateProgramIdentity({ rustSource, anchorConfig, plan, idl }) {
  const local = rustSource.match(/#\[cfg\(not\(feature = "devnet"\)\)\]\s*declare_id!\("([^"]+)"\)/)?.[1];
  const devnet = rustSource.match(/#\[cfg\(feature = "devnet"\)\]\s*declare_id!\("([^"]+)"\)/)?.[1];
  const anchorAddress = (cluster) => anchorConfig.match(new RegExp(
    `\\[programs\\.${cluster}\\]\\s*lifecycle_kase\\s*=\\s*"([^"]+)"`
  ))?.[1];
  if (!local || !devnet || local === devnet || anchorAddress("localnet") !== local ||
      anchorAddress("devnet") !== devnet || plan?.programId !== devnet || idl?.address !== devnet) {
    throw new Error("Program identity mismatch across source, Anchor, Devnet plan or built IDL");
  }
  const expected = ["initialize_instrument", "activate_instrument", "create_corporate_action", "cancel_action", "register_snapshot"];
  if (!Array.isArray(idl.instructions) || expected.some(name => !idl.instructions.some(i => i.name === name))) {
    throw new Error("Devnet IDL is missing an implemented instruction");
  }
  return { programId: devnet, localnetProgramId: local, instructionCount: idl.instructions.length };
}

export function validateDevnetBinary(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error("Expected an ELF artifact and a reviewed SHA-256 pin");
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== expectedHash) throw new Error("SBF artifact differs from the reviewed Devnet build hash");
  return { artifactBytes: bytes.length, artifactSha256: hash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Expected built public IDL and SBF artifact paths");
    const root = new URL("../", import.meta.url);
    const plan = JSON.parse(await readFile(new URL("docs/deployment/devnet-plan.json", root), "utf8"));
    const report = validateProgramIdentity({
      rustSource: await readFile(new URL("programs/lifecycle_kase/src/lib.rs", root), "utf8"),
      anchorConfig: await readFile(new URL("Anchor.toml", root), "utf8"),
      plan,
      idl: JSON.parse(await readFile(process.argv[2], "utf8"))
    });
    const binary = validateDevnetBinary(await readFile(process.argv[3]), plan.artifactSha256);
    console.log(JSON.stringify({ ...report, ...binary }, null, 2));
  } catch {
    console.error("Program identity check failed; inspect public source/configuration/IDL alignment");
    process.exitCode = 1;
  }
}
