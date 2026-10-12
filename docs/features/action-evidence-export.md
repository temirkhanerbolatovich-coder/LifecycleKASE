# Corporate action evidence export

The action result view exports a complete stored record set for one corporate action as JSON or CSV. An Administrator or Auditor can download evidence for a completed or unfinished action. Existing issuer checks on action mutations remain unchanged. Public QA data does not use this authenticated export.

`GET /api/v1/corporate-actions/:id/evidence-export?format=json|csv` returns an attachment through the existing same-origin operator proxy. A valid UUID and an explicit supported format are required. The response uses `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, a fixed UUID-based filename, `X-Evidence-File-SHA256`, `X-Evidence-Payload-SHA256`, and an `X-Correlation-ID`. A successful export adds an `ACTION_EVIDENCE_EXPORTED` audit event containing format, hashes, action version and completeness. It does not change business data or send a transaction.

## Included evidence

The versioned `action-evidence-export-v1` payload contains:

- Action source, dates, approval, allocation policy, recorded totals and current state/version.
- Current instrument terms and network identity, identified separately from the economic terms captured in stored calculation inputs. Current terms never replace the inputs used to verify an obligation.
- The canonical snapshot string and original SHA-256, raw recorded relational balances and ownership, finalized registration signatures and controlled raw capture evidence when applicable. The export rebuilds the canonical snapshot from stored relational rows and verifies the saved hash and payload. Controlled raw account bytes and registry hashes pass the existing capture validation. Legacy actions explicitly report that raw account bytes were not recorded; the export does not fabricate them.
- Every stored entitlement, captured calculation input, formula version, rounding remainder and denominator, obligation, token quantity and public recipient. Calculations are independently checked for coupon, maturity, percentage redemption and exact-target redemption. Exact-target quota remainders describe the allocation step; they are not unpaid cash.
- Cash/asset legs, original signatures, stored transaction confirmation states and computed reconciliation. Confirmed totals include only fully matching stored settlement projections; unresolved rows remain visible.
- The verified original canonical receipt string, receipt hash, finalization signature/PDA and status when a receipt exists. Existing coupon/redemption receipt validation verifies it; export never reformats or replaces its bytes.
- Explicit unresolved items and limitations. Missing snapshot/calculation/receipt, unsettled rows, unknown confirmation, inconsistent processed counts or pending finalization keep `outcome.evidenceComplete` false. A stored action status by itself cannot make an export complete. Missing calculations produce a null calculated obligation total, not a zero obligation.

The export reads all source records and verifies the receipt within one PostgreSQL repeatable-read transaction. It reads stored confirmation evidence without contacting RPC. `metadata.liveRpcRevalidated` is always false. A hash establishes byte integrity; it does not independently prove live on-chain settlement. The packet preserves the settlement mode, simulated-asset disclaimer, and current tax limitation. Instrument/status projections can change across later exports; finalized snapshot/receipt hashes and receipt bytes remain their original commitments.

Investor names, emails, authentication data, prepared/signed transaction wires and arbitrary transaction payloads are excluded. Public wallet/account addresses and investor UUIDs remain because they bind ownership, obligation and settlement evidence. Unknown calculation fields are excluded; allowed calculation fields must have their expected scalar form.

## Reproducible hashes and CSV

The JSON envelope records `canonicalization: SORTED_OBJECT_KEYS_UTF8_JSON_V1`. Its `payloadSha256` is SHA-256 over UTF-8 compact JSON of `payload`, with object keys recursively sorted by JavaScript string ordering and array order preserved. No current export timestamp is inserted into the hashed payload. Identical stored records yield identical payload and file hashes. The file hash covers the exact attachment bytes, including CSV CRLF line endings.

CSV is a complete, reversible JSON-pointer projection rather than a truncated investor table. Its seven columns are `schema_version`, `action_id`, `payload_sha256`, `json_pointer`, `json_type`, `value`, and `value_escaped`. Every object/array gets a typed container marker (`{}`/`[]`) before its children. Scalars retain their type; empty arrays/objects and null values survive reconstruction. Object-key `/` and `~` characters use standard JSON-pointer escaping. All cells are quoted and embedded quotes are doubled.

Values that could start spreadsheet formulas (`=`, `+`, `-`, `@`, including leading whitespace/BOM) or start with tab/CR/LF are prefixed with an apostrophe. `value_escaped=true` identifies exactly those values so a verifier can remove that one guard and recover the original value. Quoting alone is insufficient formula protection. The browser reconstructs the JSON payload from CSV rows, checks the selected action and recomputes its payload hash before making either format downloadable. Duplicate/malformed paths, invalid types, altered bytes, wrong filenames/actions and mismatched hashes fail closed.

To verify JSON independently with Node.js, save this as a temporary verifier and pass the downloaded JSON path:

```js
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = readFileSync(process.argv[2]);
const envelope = JSON.parse(bytes.toString('utf8'));
const sorted = value => Array.isArray(value) ? value.map(sorted) :
  value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const sha256 = value => createHash('sha256').update(value).digest('hex');
if (envelope.schemaVersion !== 'action-evidence-export-v1' ||
    envelope.canonicalization !== 'SORTED_OBJECT_KEYS_UTF8_JSON_V1' ||
    sha256(JSON.stringify(sorted(envelope.payload))) !== envelope.payloadSha256 ||
    JSON.stringify(sorted(envelope)) !== bytes.toString('utf8')) {
  throw new Error('Evidence integrity check failed');
}
console.log({ actionId: envelope.payload.action.id,
  payloadSha256: envelope.payloadSha256, fileSha256: sha256(bytes),
  evidenceComplete: envelope.payload.outcome.evidenceComplete });
```

## Validation and failure behavior

API tests cover full/partial/uncalculated evidence, deterministic hashes and JSONB key ordering, captured terms, all three action formulas including exact target, snapshot/obligation corruption, unchanged canonical receipt bytes, repeatable-read selection, original unknown signatures, matching settlement legs, formula protection, role/session checks and audit logging. Browser helper tests cover JSON/CSV reconstruction, same-origin credentials, wrong action/filename/hash, malformed/duplicate paths, prototype safety and authentication/network failure without retry.

Run `npm run test --workspace @lifecycle-kase/api` and `npm run test --workspace @lifecycle-kase/web`. A valid-format request with corrupt evidence fails with an integrity/reconciliation error and no file. Database or audit failures fail the request; the browser must not report a saved file after failure. A 401 requires a new operator session; retrying a read never resends a payment. Actual browser file saving remains a separate acceptance check from unit tests.
