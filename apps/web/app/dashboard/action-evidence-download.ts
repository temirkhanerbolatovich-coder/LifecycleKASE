import { OperatorApiError } from "./operator-api";

export type ActionEvidenceFormat = "json" | "csv";
const schema = "action-evidence-export-v1";
const canonicalization = "SORTED_OBJECT_KEYS_UTF8_JSON_V1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;
const csvHeader = ["schema_version", "action_id", "payload_sha256", "json_pointer", "json_type", "value", "value_escaped"];
function invalid(message = "The evidence file failed its integrity check."): never { throw new OperatorApiError("EVIDENCE_INTEGRITY", 409, message); }
function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize((item as Record<string, unknown>)[key])]));
    return invalid();
  };
  return JSON.stringify(normalize(value));
}
async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, "0")).join("");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

/** Reads quoted RFC 4180 cells, including embedded CRLF and doubled quotes. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let offset = 0;
  while (offset < text.length) {
    const row: string[] = [];
    while (true) {
      if (text[offset++] !== '"') return invalid();
      let cell = "", closed = false;
      while (offset < text.length) {
        const character = text[offset++]!;
        if (character !== '"') { cell += character; continue; }
        if (text[offset] === '"') { offset += 1; cell += '"'; continue; }
        closed = true; break;
      }
      if (!closed) return invalid();
      row.push(cell);
      if (text[offset] === ",") { offset += 1; continue; }
      if (text.slice(offset, offset + 2) !== "\r\n") return invalid();
      offset += 2; rows.push(row); break;
    }
  }
  return rows;
}
/** Every container has a typed row, making the CSV a lossless projection even for empty arrays/objects. */
export function actionEvidencePayloadFromCsv(text: string, actionId: string, payloadSha256: string): Record<string, unknown> {
  const rows = csvRows(text);
  if (JSON.stringify(rows.shift()) !== JSON.stringify(csvHeader)) return invalid();
  let payload: unknown;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.length !== 7 || row[0] !== schema || row[1] !== actionId || row[2] !== payloadSha256 || !["false", "true"].includes(row[6]!)) return invalid();
    const pointer = row[3]!, type = row[4]!;
    if (seen.has(pointer)) return invalid();
    seen.add(pointer);
    let value = row[5]!;
    if (row[6] === "true") { if (!value.startsWith("'")) return invalid(); value = value.slice(1); }
    let decoded: unknown;
    if (type === "string") decoded = value;
    else {
      try { decoded = JSON.parse(value); } catch { return invalid(); }
      if (type === "null" ? decoded !== null : type === "array" ? value !== "[]" : type === "object" ? value !== "{}" :
          type === "number" ? typeof decoded !== "number" || !Number.isFinite(decoded) : type === "boolean" ? typeof decoded !== "boolean" : true) return invalid();
    }
    if (pointer === "") { if (payload !== undefined || type !== "object") return invalid(); payload = decoded; continue; }
    if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer)) return invalid();
    const segments = pointer.slice(1).split("/").map(segment => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    let parent = payload;
    for (const segment of segments.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, segment)) return invalid();
      parent = (parent as Record<string, unknown>)[segment];
    }
    if (!parent || typeof parent !== "object") return invalid();
    const key = segments.at(-1)!;
    if (Array.isArray(parent) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) !== parent.length)) return invalid();
    if (Object.hasOwn(parent, key)) return invalid();
    Object.defineProperty(parent, key, { value: decoded, writable: true, enumerable: true, configurable: true });
  }
  return record(payload);
}

/** Validates file and payload digests before the browser receives a downloadable Blob. */
export async function readActionEvidenceFile(actionId: string, format: ActionEvidenceFormat, fetchRequest: typeof fetch = fetch) {
  if (!uuid.test(actionId) || !["json", "csv"].includes(format)) invalid("Evidence action UUID or format is invalid.");
  let response: Response;
  try { response = await fetchRequest(`/api/v1/corporate-actions/${actionId}/evidence-export?format=${format}`, {
    credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { Accept: format === "json" ? "application/json" : "text/csv" }
  }); } catch { throw new OperatorApiError("CONNECTION_UNAVAILABLE", 0, "The evidence export connection is unavailable. Retry the download after reconnecting."); }
  if (!response.ok) {
    let error: Record<string, unknown> = {};
    try { error = record(await response.json()); } catch { /* A non-JSON proxy error has no application error details. */ }
    throw new OperatorApiError(typeof error["code"] === "string" ? error["code"] : undefined, response.status,
      response.status === 401 ? "The operator session expired. Sign in again before downloading evidence." : typeof error["message"] === "string" ? error["message"] : "The evidence export request failed.");
  }
  const fileSha256 = response.headers.get("X-Evidence-File-SHA256") ?? "", payloadSha256 = response.headers.get("X-Evidence-Payload-SHA256") ?? "";
  const filename = `action-evidence-${actionId}.${format}`;
  if (!digestPattern.test(fileSha256) || !digestPattern.test(payloadSha256) ||
      response.headers.get("Content-Disposition") !== `attachment; filename="${filename}"` ||
      response.headers.get("Content-Type")?.split(";")[0] !== (format === "json" ? "application/json" : "text/csv")) return invalid();
  let bytes: Uint8Array, text: string;
  try { bytes = new Uint8Array(await response.arrayBuffer()); text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return invalid(); }
  if (await sha256(bytes) !== fileSha256) return invalid();
  let payload: Record<string, unknown>;
  if (format === "json") {
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(text)); } catch { return invalid(); }
    if (envelope["schemaVersion"] !== schema || envelope["canonicalization"] !== canonicalization || envelope["payloadSha256"] !== payloadSha256 ||
        canonicalJson(envelope) !== text) return invalid();
    payload = record(envelope["payload"]);
  } else payload = actionEvidencePayloadFromCsv(text, actionId, payloadSha256);
  if (payload["schemaVersion"] !== schema || record(payload["action"])["id"] !== actionId ||
      await sha256(new TextEncoder().encode(canonicalJson(payload))) !== payloadSha256) return invalid();
  return { bytes, text, filename, sha256: fileSha256, payloadSha256, mimeType: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" };
}

export async function downloadActionEvidence(actionId: string, format: ActionEvidenceFormat) {
  const file = await readActionEvidenceFile(actionId, format);
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }));
  try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return { filename: file.filename, sha256: file.sha256, payloadSha256: file.payloadSha256 };
}
