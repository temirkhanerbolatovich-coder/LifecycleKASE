import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildControlledCaptureFinish, buildControlledRedemptionExecution, buildRedemptionFinalization,
  deriveCorporateActionAddresses, deriveControlledCaptureAddress, deriveControlledPolicyAddress, encodePublicKey,
  redemptionSourceHash, serializeUnsignedInstructionsTransaction } from "../packages/solana-client/dist/index.js";
import { actionEvidenceFile, canonicalEvidenceJson } from "../apps/api/dist/action-evidence-export.js";

// The copied application mounts the real operator components with explicit synthetic responses.
// No authentication, real API, wallet, validator, database or financial operation is accessed.
const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.KASE_PLAYWRIGHT_MODULE) throw new Error("Set KASE_PLAYWRIGHT_MODULE to the installed Playwright module, as for capture-kase-demo.mjs");
const output = path.resolve(process.env.MASTER_BROWSER_EVIDENCE_DIR ?? path.join(root, "docs/testing/evidence/action-master-2026-10-12"));
const directory = await mkdtemp(path.join(root, ".local-action-master-browser-"));
const web = path.join(directory, "web");
await mkdir(output, { recursive: true });
for (const item of ["app", "public", "package.json", "tsconfig.json", "next.config.mjs", "postcss.config.mjs"]) {
  await cp(path.join(root, "apps/web", item), path.join(web, item), { recursive: true });
}
const hash = value => createHash("sha256").update(value).digest("hex");
const key = value => encodePublicKey(new Uint8Array(32).fill(value));
const id = "00000000-0000-4000-8000-000000000001", actionId = "00000000-0000-4000-8000-000000000002";
const investorId = "00000000-0000-4000-8000-000000000003", entitlementId = "00000000-0000-4000-8000-000000000004";
const operationId = "00000000-0000-4000-8000-000000000005", signer = key(3), snapshotHash = "ab".repeat(32), signature = "1".repeat(64);
const uuid = value => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
const programId = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const identity = { programId, instrumentId: uuid(id), actionId: uuid(actionId), corporateActionAuthority: signer };
const addresses = await deriveCorporateActionAddresses(programId, uuid(id), uuid(actionId));
const controlledPolicyAddress = await deriveControlledPolicyAddress(programId, addresses.instrumentAddress);
const controlledCaptureAddress = await deriveControlledCaptureAddress(programId, addresses.actionAddress);
const tokenAccounts = [{ address: key(9), wallet: key(11), balanceAtSnapshot: 5n }];
const pay = await buildControlledRedemptionExecution({ ...identity, investorId: uuid(investorId), bondMint: key(4), settlementMint: key(5),
  settlementWallet: key(11), tokenAccounts, idempotencyHash: hash(`redemption:${actionId}:${entitlementId}:fixture-recovery-key`) });
const finish = await buildControlledCaptureFinish({ ...identity, investorIds: [uuid(investorId)] });
const final = await buildRedemptionFinalization({ ...identity, bondMint: key(4), investorIds: [uuid(investorId)], receiptHash: "cd".repeat(32) });
const wire = instructions => serializeUnsignedInstructionsTransaction({ instructions, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
const sources = tokenAccounts.map(source => ({ address: source.address, walletAddress: source.wallet, balanceAtSnapshot: "5", burnAmount: "1", balanceBefore: "5", expectedBalanceAfter: "4" }));
const sourceHash = redemptionSourceHash(pay.actionAddress, pay.entitlementAddress, snapshotHash, tokenAccounts);
const instrument = { id, name: "Synthetic master bond", ticker: "MASTER", issuerAuthority: signer, corporateActionAuthority: signer,
  complianceAuthority: signer, network: "SOLANA_LOCALNET", tokenPolicy: "CONTROLLED_FROZEN_V2", programId, mintAddress: key(4), networkGenesisHash: key(7),
  status: "ACTIVE", faceValueMinor: "1000000000", couponRateBps: 1000, paymentsPerYear: 2, issueAt: "2026-10-12T00:00:00.000Z",
  maturityAt: "2027-10-12T00:00:00.000Z", totalSupply: "5", circulatingSupply: "5", issuer: { legalName: "Synthetic issuer" },
  settlementAsset: { code: "KZT_TEST", name: "KZT-Test", mintAddress: key(5), disclaimer: "Synthetic browser acceptance only" } };
const tx = (operationType, status = "FINALIZED", saved = signature) => ({ id: operationType === "REDEMPTION_PAYMENT" ? operationId : operationType,
  operationType, status, signature: saved, lastErrorCode: null, reason: null });
const action = { id: actionId, instrumentId: id, version: 1, type: "EARLY_REDEMPTION", intent: "Synthetic operator master acceptance", sourceType: "MANUAL",
  sourceReference: null, sourceDocument: null, sourceTimestamp: null, recordAt: "2026-10-12T10:00:00.000Z", executeAt: "2026-10-12T11:00:00.000Z",
  status: "UNDER_REVIEW", reviewNote: null, redemptionPercentageBps: 2000, redemptionPriceMinor: "1000000000", couponExecutionEnabled: true,
  redemptionExecutionEnabled: true, eligibleHolders: 1, instrument, snapshot: { id, status: "FINALIZED", snapshotHash, solanaSlot: "20",
    recordAt: "2026-10-12T10:00:00.000Z", blockTime: "2026-10-12T10:00:01.000Z", totalBalance: "5", investorCount: 1, walletCount: 1 },
  blockchainTransactions: [tx("ACTION_SCHEDULE"), tx("CALCULATION_FINALIZE"), tx("CONTROLLED_UNIT_RESERVATION")] };
const entitlements = { actionId, actionVersion: 1, status: "UNDER_REVIEW", approvedById: null, approvedAt: null, actionType: "EARLY_REDEMPTION",
  instrumentId: id, programId, network: "SOLANA_LOCALNET", networkGenesisHash: key(7), corporateActionAuthority: signer, tokenMint: key(4),
  tokenPolicy: "CONTROLLED_FROZEN_V2", reviewNote: null, totalEntitlementMinor: "1000000000", eligibleHolders: 1,
  onchainRegistrationEnabled: true, onchainCalculationFinalized: true, actionApprovalEnabled: true, onchainPending: null,
  investors: [{ investorId, displayName: "Synthetic holder", balance: "5", snapshotEligibility: "ELIGIBLE", receiverWallets: [key(11), key(12)] }],
  items: [{ id: entitlementId, investorId, onchainPda: pay.entitlementAddress, settlementWalletAddress: key(11), balanceAtRecordDate: "5",
    amountMinor: "1000000000", tokensToRedeem: "1", status: "READY", eligibilityReason: "SYNTHETIC", formulaVersion: "integer-entitlements-v1",
    unitReservationAddress: pay.unitReservationAddress, unitReservationConfirmed: true, calculationInputs: { snapshotHash, balance: "5", faceValueMinor: "1000000000",
      couponRateBps: 1000, paymentsPerYear: 2, redemptionPercentageBps: 2000, redemptionPriceMinor: "1000000000", roundingRemainder: "0", denominator: "10000" },
    currentEligibility: { eligible: true, reason: "SYNTHETIC_ELIGIBLE" } }] };
const approval = { actionId, actionVersion: 1, issuer: signer, approver: key(6), programId, networkGenesisHash: key(7), instrumentId: id,
  instrumentAddress: addresses.instrumentAddress, actionAddress: addresses.actionAddress, policyAddress: controlledPolicyAddress,
  reserveAddress: final.reserveAddress, vaultAddress: final.vaultAddress, settlementMint: key(5), snapshotHash, amountMinor: "1000000000",
  treasuryBalanceMinor: "1000000000", reservedMinor: "0", networkReserveLamports: "50000000", reserveExists: false, approved: false, pending: null };
const capture = { actionId, instrumentId: id, tokenPolicy: "CONTROLLED_FROZEN_V2", enabled: true, cluster: "localnet", networkGenesisHash: key(7),
  requiredSigner: signer, programId, instrumentAddress: addresses.instrumentAddress, actionAddress: addresses.actionAddress, controlledPolicyAddress,
  controlledCaptureAddress, bondMint: key(4), investorIds: [investorId], capture: { startedSlot: "20", startedAt: "1791799201", committed: true, finished: false },
  readiness: { begin: false, finish: true, abort: false }, pending: null };
const finishPlan = { ...capture, corporateActionId: actionId, operationId, phase: "FINISH", transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64",
  serializedTransactionBase64: wire(finish.instructions), lastValidBlockHeight: 100, status: "PREPARED", signature: null, resumed: false };
const budget = { corporateActionId: actionId, actionVersion: 1, cluster: "localnet", networkGenesisHash: key(7), requiredSigner: signer,
  settlementMint: key(5), treasuryTokenAccount: key(10), snapshotHash, totalCouponMinor: "1000000000", treasuryBalanceMinor: "1000000000", deficitMinor: "0",
  finalizedSlot: 25, payerLamports: "500000000", networkReserveLamports: "50000000", requiredLamports: "50000000", hasNetworkBudget: true,
  hasCouponBudget: true, budgetReady: true, executionAvailable: false, disclaimer: "Synthetic only", fundingAttempt: null };
const execution = { enabled: true, actionId, actionVersion: 1, actionType: "EARLY_REDEMPTION", status: "APPROVED", tokenPolicy: "CONTROLLED_FROZEN_V2",
  requiredSigner: signer, programId, networkGenesisHash: key(7), settlementMint: key(5), tokenMint: key(4), snapshotHash,
  instrumentAddress: addresses.instrumentAddress, instrumentAuthorityAddress: pay.instrumentAuthority, actionAddress: addresses.actionAddress,
  approvalPolicyAddress: final.approvalPolicyAddress, reserveAddress: final.reserveAddress, vaultAddress: final.vaultAddress, redemptionProgressAddress: pay.progressAddress,
  actionReceiptAddress: final.actionReceiptAddress, totalAmountMinor: "1000000000", currentTokenSupply: "5", paid: 0, payable: 1,
  executeAt: action.executeAt, pending: null, items: [{ id: entitlementId, investorId, displayName: "Synthetic holder", status: "READY", amountMinor: "1000000000",
    tokensToRedeem: "1", receiver: key(11), signature: null, entitlementAddress: pay.entitlementAddress, redemptionSourcesAddress: pay.sourceAddress,
    redemptionReceiptAddress: pay.redemptionReceiptAddress, sourceHash, recipientAddress: pay.recipientAddress, burnAvailable: true, tokenAccounts: sources,
    unitReservationAddress: pay.unitReservationAddress, controlledPolicyAddress, holdingAddresses: pay.holdingAddresses }] };
const pendingPay = { ...execution, corporateActionId: actionId, operationId, phase: "PAY", cluster: "localnet", transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64",
  serializedTransactionBase64: wire(pay.instructions), lastValidBlockHeight: 100, idempotencyKey: "fixture-recovery-key",
  idempotencyHash: hash(`redemption:${actionId}:${entitlementId}:fixture-recovery-key`), entitlementId, entitlementVersion: 1,
  amountMinor: "1000000000", settlementWallet: key(11), tokensToRedeem: "1", tokenAccounts: sources, supplyBefore: "5", supplyAfter: "4",
  entitlementAddress: pay.entitlementAddress, redemptionSourcesAddress: pay.sourceAddress, redemptionReceiptAddress: pay.redemptionReceiptAddress,
  recipientAddress: pay.recipientAddress, sourceHash, controlledPolicyAddress, controlledCaptureAddress, unitReservationAddress: pay.unitReservationAddress,
  holdingAddresses: pay.holdingAddresses, assignedAllocations: ["1"], status: "UNKNOWN_CONFIRMATION", signature, resumed: true };
const base = { action, entitlements, approval, capture, finishPlan, budget, execution, pendingPay };
const fixturePage = `"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {OperatorWorkspace} from "../dashboard/operator-workspace";
import {OperatorApiError} from "../dashboard/operator-api";
const base: any=${JSON.stringify(base)};
export default function Fixture(){
 const [mode,setMode]=useState<string|null>(null);
 const initial=(mode:string)=>{const v=structuredClone(base);v.action.status=mode==="revision"?"RETURNED_FOR_REVISION":mode==="calculated"?"CALCULATED":mode==="readiness"?"UNDER_REVIEW":"APPROVED";
 v.entitlements.status=v.action.status;
 if(["revision","calculated"].includes(mode)){v.action.blockchainTransactions=v.action.blockchainTransactions.filter((tx:any)=>!["CALCULATION_FINALIZE","CONTROLLED_UNIT_RESERVATION"].includes(tx.operationType));v.entitlements.onchainCalculationFinalized=false;v.entitlements.actionApprovalEnabled=false;v.entitlements.items[0].onchainPda=null;v.entitlements.items[0].status="CALCULATED";}
 if(mode!=="readiness"){v.capture.capture.finished=true;v.capture.readiness.finish=false;v.action.blockchainTransactions.push({id:"CAPTURE_FINISH",operationType:"CONTROLLED_CAPTURE_FINISH",status:"FINALIZED",signature:"1".repeat(64),lastErrorCode:null,reason:null});}
 if(["pending","auditor","coupon","maturity"].includes(mode)){v.approval.approved=true;v.approval.reserveExists=true;v.approval.reservedMinor=v.approval.amountMinor;v.action.blockchainTransactions.push({id:"APPROVAL",operationType:"ACTION_APPROVAL",status:"FINALIZED",signature:"1".repeat(64),lastErrorCode:null,reason:null});}
 if(mode==="coupon"){v.action.type="COUPON_PAYMENT";v.entitlements.actionType="COUPON_PAYMENT";v.execution.actionType="COUPON_PAYMENT";v.execution.items[0].entitlementReceiptAddress=v.execution.items[0].redemptionReceiptAddress;}
 if(mode==="maturity"){v.action.type="BOND_REDEMPTION";v.entitlements.actionType="BOND_REDEMPTION";v.execution.actionType="BOND_REDEMPTION";v.execution.items[0].tokensToRedeem="5";v.execution.items[0].tokenAccounts[0].burnAmount="5";v.execution.items[0].tokenAccounts[0].expectedBalanceAfter="0";}
 if(mode==="pending"){v.execution.pending=v.pendingPay;v.execution.items[0].burnAvailable=false;v.execution.items[0].tokenAccounts=v.execution.items[0].tokenAccounts.map((row:any)=>({...row,balanceBefore:null,expectedBalanceAfter:null}));v.action.blockchainTransactions.unshift({id:v.pendingPay.operationId,operationType:"REDEMPTION_PAYMENT",status:"UNKNOWN_CONFIRMATION",signature:v.pendingPay.signature,lastErrorCode:null,reason:null});}
 return v;};
 const state=useRef(initial("calculated"));const log=useRef<{path:string;method:string;body:string|null}[]>([]);const [busy,setBusy]=useState(false);
 useEffect(()=>{const selected=new URLSearchParams(window.location.search).get("mode")??"calculated";state.current=initial(selected);Object.assign(window,{masterFixture:{log:log.current,state:state.current}});setMode(selected);},[]);
 const request=useCallback(async(path:string,init?:RequestInit):Promise<Record<string,unknown>>=>{
 log.current.push({path,method:init?.method??"GET",body:init?.body?String(init.body):null});const v=state.current;
 if(path==="/api/v1/corporate-actions?limit=20")return {items:[v.action],nextCursor:null};
 if(path.startsWith("/api/v1/instruments?"))return {items:[v.action.instrument],nextCursor:null};
 if(path==="/api/v1/operator-overview")return {schema:"operator-overview-v1",source:"POSTGRESQL_REPEATABLE_READ",asOf:"2026-10-12T10:00:00.000Z",network:"SOLANA_LOCALNET",period:{from:"2026-10-12T00:00:00.000Z",toExclusive:"2026-10-13T00:00:00.000Z",basis:"ACTION_EXECUTE_AT"},completeAggregates:true,activeInstruments:1,openActions:1,unknownOperations:mode==="pending"?1:0,financing:{source:"NOT_QUERIED",availableMinor:null,reservedMinor:null},assets:[],queue:{limit:7,total:1,items:[{...v.action,hasUnknownConfirmation:mode==="pending"}]}};
 if(path==="/api/v1/corporate-actions/"+v.action.id)return structuredClone(v.action);
 if(path.endsWith("/entitlements"))return structuredClone(v.entitlements);
 if(path.endsWith("/approval"))return structuredClone(v.approval);
 if(path.endsWith("/snapshot/capture"))return structuredClone(v.capture);
 if(path.endsWith("/coupon/budget"))return structuredClone(v.budget);
 if(path.endsWith("/redemption-execution"))return structuredClone(v.execution);
 if(path.endsWith("/coupon/execution"))return structuredClone(v.execution);
 if(path.endsWith("/snapshot/capture/prepare")){v.capture.pending=v.finishPlan as never;return structuredClone(v.finishPlan);}
 if(path.endsWith("/snapshot/capture/confirm")){const input=JSON.parse(String(init?.body));v.capture.capture.finished=true;v.capture.pending=null;v.capture.readiness.finish=false;v.action.blockchainTransactions.push({id:"FINISHED",operationType:"CONTROLLED_CAPTURE_FINISH",status:"FINALIZED",signature:input.signature,lastErrorCode:null,reason:null});return {operationId:input.operationId,signature:input.signature,status:"FINALIZED"};}
 if(init?.method==="POST")throw new OperatorApiError("INVALID_REQUEST",400,"Synthetic rejection: values are preserved.");
 return {items:[],nextCursor:null};
 },[mode]);
 if(!mode)return <p>Loading isolated synthetic fixture...</p>;
 return <><div className="border-b bg-white p-3 text-sm"><strong>SYNTHETIC OPERATOR BROWSER FIXTURE</strong><p>No authentication, wallet, database, validator or financial acceptance. All responses are deterministic browser fixtures.</p></div>
 <OperatorWorkspace user={{id:"synthetic-operator",displayName:"Synthetic operator",role:["auditor","coupon","maturity"].includes(mode)?"AUDITOR":"ADMINISTRATOR"}}
 walletAddress={base.action.instrument.issuerAuthority} selectedAccountAddress={base.action.instrument.issuerAuthority} sessionExpired={false} busy={busy}
 message="" wallet={undefined} request={request} apiState="ready" connectionSettings={<p>Synthetic connection only</p>} onBusyChange={setBusy}
 onRecover={()=>{}} onLogout={()=>{}}/></>;
}`;
await mkdir(path.join(web, "app/master-fixture"));
await writeFile(path.join(web, "app/master-fixture/page.tsx"), fixturePage);
const cli = path.join(root, "node_modules/next/dist/bin/next");
const env = { ...process.env, API_SERVER_URL: "http://127.0.0.1:9", NEXT_TELEMETRY_DISABLED: "1" };
const build = spawn(process.execPath, [cli, "build"], { cwd: web, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let buildLog = ""; build.stdout.on("data", chunk => { buildLog += chunk; }); build.stderr.on("data", chunk => { buildLog += chunk; });
const [buildCode] = await once(build, "exit"); await writeFile(path.join(output, "build.log"), buildLog); assert.equal(buildCode, 0, buildLog);
const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const server = spawn(process.execPath, [cli, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: web, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.resume(); server.stderr.resume(); let browser, diagnosticPage;
const results = [], errors = [], unexpectedNetwork = [];
const evidencePayload = { schemaVersion: "action-evidence-export-v1", action: { id: actionId, intent: "=synthetic formula guard", status: "APPROVED" },
  metadata: { syntheticBrowserFixture: true, liveRpcRevalidated: false }, outcome: { evidenceComplete: false, unresolved: ["SYNTHETIC_ONLY"] } };
const payloadSha256 = hash(canonicalEvidenceJson(evidencePayload));
const envelope = { schemaVersion: "action-evidence-export-v1", canonicalization: "SORTED_OBJECT_KEYS_UTF8_JSON_V1", payloadSha256, payload: evidencePayload };
const bundle = { ...envelope, canonicalJson: canonicalEvidenceJson(envelope) };
const sourceFingerprints = Object.fromEntries(await Promise.all([
  "apps/web/app/dashboard/corporate-action-detail.tsx", "apps/web/app/dashboard/corporate-action-panel.tsx", "apps/web/app/dashboard/operator-workspace.tsx",
  "apps/web/app/dashboard/entitlement-panel.tsx", "apps/web/app/dashboard/action-approval-panel.tsx", "apps/web/app/dashboard/action-master-workflow.ts",
  "apps/web/app/dashboard/controlled-capture-panel.tsx", "apps/web/app/dashboard/coupon-funding-panel.tsx", "apps/web/app/dashboard/coupon-execution-panel.tsx",
  "apps/web/app/dashboard/redemption-execution-panel.tsx", "apps/web/app/dashboard/workspace-navigation.ts", "apps/web/app/dashboard/locale.ts",
  "apps/web/app/dashboard/master-messages.ts", "apps/web/app/dashboard/action-evidence-download.ts", "apps/web/app/globals.css",
  "scripts/test-operator-master-browser.mjs"].map(async file => [file, hash(await readFile(file.startsWith("apps/web/") ? path.join(web, file.slice("apps/web/".length)) : path.join(root, file)))])));
try {
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) { try { if ((await fetch(origin + "/master-fixture")).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.equal(ready, true, "Isolated master fixture did not become ready");
  const modulePath = process.env.KASE_PLAYWRIGHT_MODULE;
  if (!modulePath) throw new Error("Set KASE_PLAYWRIGHT_MODULE to the installed Playwright module, as for capture-kase-demo.mjs");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ headless: true, ...(process.env.KASE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.KASE_CHROMIUM_EXECUTABLE } : {}) });
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, reducedMotion: "reduce" });
    await context.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/evidence-export") && route.request().method() === "GET") {
        const file = actionEvidenceFile(bundle, url.searchParams.get("format"));
        await route.fulfill({ status: 200, body: file.body, headers: { "Content-Type": file.mimeType,
          "Content-Disposition": `attachment; filename="${file.filename}"`, "X-Evidence-File-SHA256": file.fileSha256,
          "X-Evidence-Payload-SHA256": file.payloadSha256 } });
      } else { unexpectedNetwork.push({ method: route.request().method(), pathname: url.pathname }); await route.abort(); }
    });
    const page = await context.newPage(); diagnosticPage = page; page.on("pageerror", error => errors.push(error.message));
    const go = async (mode, step = "calculation") => {
      await page.goto(`${origin}/master-fixture?mode=${mode}#actions?selected=${actionId}&step=${step}`, { waitUntil: "networkidle" });
      await page.locator(".master-steps button").first().waitFor();
      await page.waitForFunction(() => document.querySelectorAll(".master-steps button:disabled").length === 0);
      await page.getByRole("combobox", { name: /^(Язык интерфейса|Interface language)$/ }).selectOption("en");
    };
    const detail = () => page.locator(".action-detail:visible");
    const step = value => detail().locator(`.master-steps button`).filter({ hasText: value });
    const section = async name => {
      const menu = page.locator(".workspace-mobile-menu");
      if (await menu.isVisible()) await menu.locator("summary").click();
      await page.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click();
    };
    const log = () => page.evaluate(() => window.masterFixture.log);
    const readonlySince = async count => assert.equal((await log()).slice(count).some(row => row.method !== "GET"), false, "Navigation must not perform a financial POST");
    await go("calculated"); assert.equal(await detail().locator(".master-steps button").count(), 6);
    const languageContrast = await page.getByRole("combobox", { name: "Interface language" }).evaluate(select => {
      const style = getComputedStyle(select);
      const luminance = color => color.match(/[0-9.]+/g).slice(0, 3).map(Number).map(value => value / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(languageContrast >= 4.5, "Language selector text must remain readable on its header background");
    const note = detail().getByLabel("Decision comment", { exact: false }); await note.fill("Retained explicit review note");
    const count = (await log()).length;
    await step("Terms and scheduling").click(); await detail().getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-master-step]")?.getAttribute("data-master-step") === "snapshot");
    await detail().getByRole("button", { name: "Continue", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-master-step]")?.getAttribute("data-master-step") === "calculation");
    await step("Separate approval").click(); await step("Calculation and registration").click(); assert.equal(await note.inputValue(), "Retained explicit review note");
    await step("Readiness and funding").click(); await section("Overview");
    await section("Actions");
    await step("Calculation and registration").click(); assert.equal(await note.inputValue(), "Retained explicit review note");
    await detail().getByRole("button", { name: /Back to actions/ }).click(); await page.getByRole("button", { name: "MASTER", exact: true }).click();
    assert.equal(await note.inputValue(), "Retained explicit review note"); await readonlySince(count);
    await step("Terms and scheduling").click(); await step("Calculation and registration").click(); await page.goBack();
    await page.waitForFunction(() => location.hash.endsWith("step=terms")); await page.goForward(); await page.waitForFunction(() => location.hash.endsWith("step=calculation"));
    assert.equal(await note.inputValue(), "Retained explicit review note");
    await page.screenshot({ path: path.join(output, `master-${label}-en.png`), fullPage: true });
    await page.getByRole("combobox", { name: "Interface language" }).selectOption("ru");
    await page.screenshot({ path: path.join(output, `master-${label}-ru.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole("combobox", { name: "Язык интерфейса" }).selectOption("en");
    assert.equal(await note.inputValue(), "Retained explicit review note");
    await go("revision"); const receiver = detail().locator('select').filter({ has: page.locator('option[value="' + key(12) + '"]') }).first();
    await receiver.selectOption(key(12)); await detail().getByRole("button", { name: /Recalculate .*snapshot/ }).click();
    await detail().getByText("Synthetic rejection: values are preserved.", { exact: false }).first().waitFor();
    assert.equal(await receiver.inputValue(), key(12)); await step("Readiness and funding").click(); await step("Calculation and registration").click();
    assert.equal(await receiver.inputValue(), key(12));
    await go("pending", "execution"); await detail().getByText("Recover original signature manually", { exact: true }).click();
    const originalSignature = detail().getByLabel("Original transaction signature", { exact: true });
    await originalSignature.waitFor(); assert.equal(await originalSignature.inputValue(), signature);
    const recoveryCount = (await log()).length; await step("Terms and scheduling").click(); await step("Execution and results").click();
    assert.equal(await originalSignature.inputValue(), signature);
    assert.equal(await detail().getByRole("button", { name: "Sign in Phantom", exact: true }).count(), 0);
    await readonlySince(recoveryCount); await page.screenshot({ path: path.join(output, `pending-${label}-en.png`), fullPage: true });
    for (const format of ["JSON", "CSV"]) {
      const downloadPromise = page.waitForEvent("download"); await detail().getByRole("button", { name: `Download evidence ${format}`, exact: true }).click();
      const download = await downloadPromise; const destination = path.join(output, `synthetic-${label}-evidence.${format.toLowerCase()}`);
      await download.saveAs(destination); const expected = actionEvidenceFile(bundle, format.toLowerCase());
      assert.equal(hash(await readFile(destination)), expected.fileSha256);
    }
    await go("readiness", "calculation"); await detail().getByRole("button", { name: "Open required step: Holder snapshot", exact: true }).click();
    await detail().getByRole("button", { name: "Finish capture and release free balances", exact: true }).click();
    await detail().getByText("Recover original signature", { exact: true }).click();
    const captureSignature = detail().locator(".transaction-review input:not([type=checkbox])"); await captureSignature.fill(signature);
    await detail().getByRole("button", { name: "Check finalization", exact: true }).click();
    await detail().getByText("Capture verified against finalized network state.", { exact: true }).waitFor();
    await step("Readiness and funding").click(); await detail().getByRole("button", { name: "Reserve action budget", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `readiness-${label}-en.png`), fullPage: true });
    await go("auditor", "execution");
    assert.equal(await detail().getByRole("button", { name: "Prepare redemption", exact: true }).count(), 1);
    assert.equal(await detail().getByRole("button", { name: "Prepare redemption", exact: true }).isDisabled(), true);
    await step("Holder snapshot").click(); assert.equal(await detail().getByRole("button", { name: "Finish capture and release free balances", exact: true }).count(), 0);
    await step("Separate approval").click(); assert.equal(await detail().getByRole("button", { name: "Approve in Solana", exact: true }).count(), 0);
    await step("Execution and results").click();
    const keyboardCount = (await log()).length;
    await detail().locator(".master-steps button").first().focus();
    for (let index = 0; index < 6; index++) {
      assert.equal(await detail().locator(".master-steps button").nth(index).evaluate(button => button === document.activeElement), true);
      if (index < 5) await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter"); await readonlySince(keyboardCount);
    await page.keyboard.press("Tab"); const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, hidden: document.activeElement?.closest("[hidden]") !== null }));
    assert.equal(focused.hidden, false); assert.ok(["BUTTON", "SELECT", "A", "INPUT", "SUMMARY"].includes(focused.tag));
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    assert.equal(await detail().locator(".master-steps button").first().evaluate(button => getComputedStyle(button).transitionDuration), "0s");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Fixture viewport overflow");
    await page.screenshot({ path: path.join(output, `auditor-${label}-en.png`), fullPage: true });
    if (label === "desktop") {
      await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
      assert.equal(await detail().locator(".master-steps button").count(), 6);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: path.join(output, "auditor-desktop-200-percent-css-zoom.png"), fullPage: true });
      await page.evaluate(() => { document.documentElement.style.zoom = ""; });
    }
    for (const mode of ["coupon", "maturity"]) {
      await go(mode, "execution"); assert.equal(await detail().locator(".master-steps button").count(), 6);
      const prepare = detail().locator(".payment-list button"); assert.equal(await prepare.count(), 1); assert.equal(await prepare.isDisabled(), true);
      await page.screenshot({ path: path.join(output, `${mode}-${label}-en.png`), fullPage: true });
    }
    results.push({ label, viewport, sixStepsVisible: true, notesAndRecipientsRetained: true, sectionAndListRetention: true,
      historyBackForward: true, originalSignatureRetained: true, resubmissionDisabled: true, navigationReadOnly: true,
      captureFinishReadiness: true, auditorReadOnly: true, jsonCsvDownloadsVerified: true, keyboardFocusVisible: true,
      reducedMotion: true, overflow: false, cssZoom200Percent: label === "desktop", languages: ["ru", "en"], keyboardSixStepOrder: true,
      languageSelectorContrast: languageContrast, readOnlyActionTypes: ["COUPON_PAYMENT", "EARLY_REDEMPTION", "BOND_REDEMPTION"] });
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
  for (const filename of ["failure.json", "failure-page.png"]) {
    try { await unlink(path.join(output, filename)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const evidence = { schema: "operator-master-browser-fixture-v1", testedAt: new Date().toISOString(),
    scope: "SYNTHETIC_RESPONSES_REAL_OPERATOR_COMPONENTS_ISOLATED_PRODUCTION_COPY", authenticatedRuntime: false,
    actualWalletUsed: false, liveRpcQueried: false, databaseAccessed: false, financialTransactionsSent: 0,
    nativeBrowserZoomAcceptance: false, nativeScreenReaderAcceptance: false, realFiveUserAcceptance: false,
    limitations: ["Responses and explicit confirmation are simulated; no financial or authentication acceptance is established.",
      "200% uses CSS zoom as an automated approximation, not native browser zoom.", "No Phantom, native screen reader or real multi-user study was performed."],
    results, errors, unexpectedNetwork, sourceFingerprints };
  await writeFile(path.join(output, "browser-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("PASS isolated master browser UX fixture", JSON.stringify(results), output);
} catch (error) {
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    await diagnosticPage.screenshot({ path: path.join(output, "failure-page.png"), fullPage: true }).catch(() => {});
    await writeFile(path.join(directory, "failure-dom.html"), await diagnosticPage.content());
    console.error("Fixture diagnostics", await diagnosticPage.evaluate(() => ({ hash: location.hash, step: document.querySelector("[data-master-step]")?.getAttribute("data-master-step"),
      noteFields: [...document.querySelectorAll("textarea")].map(field => ({ value: field.value, label: field.parentElement?.innerText, hidden: field.closest("[hidden]") !== null })) })));
  }
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ message: error.message, errors, unexpectedNetwork }, null, 2)); throw error;
} finally {
  if (browser) await browser.close(); server.kill(); if (server.exitCode === null) await once(server, "exit");
}
