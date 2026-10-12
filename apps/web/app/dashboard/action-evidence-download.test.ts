import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { actionEvidencePayloadFromCsv, readActionEvidenceFile } from "./action-evidence-download.js";

const actionId = "00000000-0000-4000-8000-000000000001";
const schema = "action-evidence-export-v1";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;
}
const fixture = () => ({ schemaVersion: schema, action: { id: actionId }, outcome: { evidenceComplete: false },
  rawNote: '=HYPERLINK("https://example.test")\r\nsecond line', empty: [], absent: null });
function jsonFile(payload: unknown = fixture()) {
  const payloadSha256 = hash(JSON.stringify(stable(payload)));
  return { text: JSON.stringify(stable({ schemaVersion: schema, canonicalization: "SORTED_OBJECT_KEYS_UTF8_JSON_V1", payloadSha256, payload })), payloadSha256 };
}
function csvFile() {
  const payload = fixture(), payloadSha256 = hash(JSON.stringify(stable(payload)));
  const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const rows = [
    ["", "object", "{}", "false"], ["/absent", "null", "null", "false"], ["/action", "object", "{}", "false"],
    ["/action/id", "string", actionId, "false"], ["/empty", "array", "[]", "false"], ["/outcome", "object", "{}", "false"],
    ["/outcome/evidenceComplete", "boolean", "false", "false"], ["/rawNote", "string", "'" + payload.rawNote, "true"],
    ["/schemaVersion", "string", schema, "false"]
  ];
  const text = '"schema_version","action_id","payload_sha256","json_pointer","json_type","value","value_escaped"\r\n' +
    rows.map(row => [schema, actionId, payloadSha256, ...row].map(cell).join(",")).join("\r\n") + "\r\n";
  return { text, payloadSha256, payload };
}
function response(file: { text: string; payloadSha256: string }, format = "json", headers: Record<string, string> = {}) {
  return new Response(file.text, { headers: { "Content-Type": format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
    "Content-Disposition": `attachment; filename="action-evidence-${actionId}.${format}"`,
    "X-Evidence-File-SHA256": hash(file.text), "X-Evidence-Payload-SHA256": file.payloadSha256, ...headers } });
}

test("evidence reads use the fixed same-origin authenticated GET and verify deterministic JSON before saving", async () => {
  const file = jsonFile(); let observedPath: unknown, observedInit: RequestInit | undefined;
  const read = await readActionEvidenceFile(actionId, "json", async (path, init) => { observedPath = path; observedInit = init; return response(file); });
  assert.equal(observedPath, `/api/v1/corporate-actions/${actionId}/evidence-export?format=json`);
  assert.equal(observedInit?.credentials, "include"); assert.equal(observedInit?.cache, "no-store");
  assert.equal(observedInit?.method, undefined); assert.equal(observedInit?.body, undefined);
  assert.equal(read.text, file.text); assert.equal(read.payloadSha256, file.payloadSha256);
  assert.equal(read.sha256, hash(file.text)); assert.equal(read.filename, `action-evidence-${actionId}.json`);
});

test("CSV reconstruction retains typed empty/null values, quotes and CRLF while undoing only explicit formula guards", async () => {
  const file = csvFile();
  assert.deepEqual(actionEvidencePayloadFromCsv(file.text, actionId, file.payloadSha256), file.payload);
  const read = await readActionEvidenceFile(actionId, "csv", async () => response(file, "csv"));
  assert.equal(read.text, file.text); assert.equal(read.payloadSha256, file.payloadSha256);
  const literal = file.text.replace("'" + file.payload.rawNote.replaceAll('"', '""'), "'literal apostrophe").replace('"true"\r\n', '"false"\r\n');
  assert.equal(actionEvidencePayloadFromCsv(literal, actionId, file.payloadSha256)["rawNote"], "'literal apostrophe");
});

test("evidence downloads reject tampered bytes, wrong action/filename, inconsistent hashes and noncanonical JSON", async () => {
  const file = jsonFile();
  for (const headers of [{ "X-Evidence-File-SHA256": "0".repeat(64) }, { "X-Evidence-Payload-SHA256": "0".repeat(64) },
    { "Content-Disposition": 'attachment; filename="other-action.json"' }, { "Content-Type": "text/html" }]) {
    await assert.rejects(readActionEvidenceFile(actionId, "json", async () => response(file, "json", headers)), { code: "EVIDENCE_INTEGRITY" });
  }
  const wrong = jsonFile({ ...fixture(), action: { id: "00000000-0000-4000-8000-000000000002" } });
  await assert.rejects(readActionEvidenceFile(actionId, "json", async () => response(wrong)), { code: "EVIDENCE_INTEGRITY" });
  const whitespace = { ...file, text: file.text + "\n" };
  await assert.rejects(readActionEvidenceFile(actionId, "json", async () => response(whitespace)), { code: "EVIDENCE_INTEGRITY" });
  const changedPayload = { ...file, text: file.text.replace("false", "true") };
  await assert.rejects(readActionEvidenceFile(actionId, "json", async () => response(changedPayload)), { code: "EVIDENCE_INTEGRITY" });
});

test("CSV fails closed for wrong hash/action, missing/duplicate typed paths, malformed quotes and changed data", async () => {
  const file = csvFile();
  for (const text of [file.text.replace('"schema_version"', "schema_version"),
    file.text.replace('/action/id', '/action/missing'), file.text.replace('/schemaVersion', '/action/id'),
    file.text.replace('"false","false"', '"true","false"'), file.text.replace('"object","{}"', '"object","[]"'),
    file.text.replace(actionId, "00000000-0000-4000-8000-000000000002"), file.text.replace('"true"\r\n', '"invalid"\r\n')]) {
    await assert.rejects(readActionEvidenceFile(actionId, "csv", async () => response({ ...file, text }, "csv")), { code: "EVIDENCE_INTEGRITY" });
  }
  await assert.rejects(readActionEvidenceFile(actionId, "csv", async () => response(file, "csv", { "X-Evidence-Payload-SHA256": "1".repeat(64) })), { code: "EVIDENCE_INTEGRITY" });
});

test("CSV object paths cannot mutate prototypes", () => {
  const file = csvFile();
  const cell = '"' + schema + '","' + actionId + '","' + file.payloadSha256 + '"';
  const extra = `${cell},"/__proto__","object","{}","false"\r\n${cell},"/__proto__/evidencePrototypePollution","boolean","true","false"\r\n`;
  const payload = actionEvidencePayloadFromCsv(file.text + extra, actionId, file.payloadSha256);
  assert.equal(Object.hasOwn(payload, "__proto__"), true);
  assert.equal(({} as Record<string, unknown>)["evidencePrototypePollution"], undefined);
});

test("evidence errors retain authentication/application codes and never retry or create a download after failure", async () => {
  let calls = 0;
  await assert.rejects(readActionEvidenceFile(actionId, "json", async () => { calls += 1; return new Response(JSON.stringify({ code: "SESSION_INVALID" }), { status: 401 }); }),
    { code: "SESSION_INVALID", status: 401 });
  await assert.rejects(readActionEvidenceFile(actionId, "json", async () => { calls += 1; throw new Error("offline"); }), { code: "CONNECTION_UNAVAILABLE" });
  await assert.rejects(readActionEvidenceFile("invalid", "json", async () => { calls += 1; return response(jsonFile()); }), { code: "EVIDENCE_INTEGRITY" });
  assert.equal(calls, 2);
});
