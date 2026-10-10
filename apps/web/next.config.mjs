/** Fixed, server-configured proxy routes keep Strict session cookies on the web origin. */
export function operatorApiRewrites(environment = process.env) {
  const raw = environment.API_SERVER_URL ?? environment.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
  const origin = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && local))) {
    throw new Error("API_SERVER_URL/API_INTERNAL_URL must be an HTTPS origin or local HTTP origin without credentials");
  }
  const sources = [
    "/api/v1/auth/challenge", "/api/v1/auth/verify", "/api/v1/auth/session", "/api/v1/auth/logout",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/snapshot/prepare",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/snapshot/confirm",
    "/api/v1/instruments",
    "/api/v1/instruments/:id([0-9a-fA-F-]{36})/deploy/prepare",
    "/api/v1/instruments/:id([0-9a-fA-F-]{36})/deploy/submit",
    "/api/v1/instruments/:id([0-9a-fA-F-]{36})/deploy/confirm",
    "/api/v1/investors",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/eligibility",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets/:walletId([0-9a-fA-F-]{36})/revoke",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets/:walletId([0-9a-fA-F-]{36})/verification/challenge",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets/:walletId([0-9a-fA-F-]{36})/verification/verify",
    "/api/v1/corporate-actions",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/prepare",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/submit",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/confirm",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/cancel",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/snapshot/submit",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/entitlements",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/entitlements/calculate",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/entitlements/review",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/entitlements/onchain/prepare",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/entitlements/onchain/submit",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/entitlements/onchain/confirm",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/budget",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/funding/prepare",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/funding/submit",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/funding/confirm",
    "/api/v1/program-upgrade", "/api/v1/program-upgrade/prepare", "/api/v1/program-upgrade/submit", "/api/v1/program-upgrade/confirm",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/snapshot/check-window",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/approval",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/approval/prepare",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/approval/submit",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/approval/confirm",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/execution",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/execution/prepare",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/execution/submit",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/coupon/execution/confirm",
    "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/receipt",
    "/api/v1/transactions", "/api/v1/transactions/:signature([1-9A-HJ-NP-Za-km-z]{64,88})",
    "/api/v1/audit", "/api/v1/corporate-actions/:id([0-9a-fA-F-]{36})/audit"
  ];
  return sources.map((source) => ({
    source,
    destination: origin.origin + source
      .replace(":id([0-9a-fA-F-]{36})", ":id")
      .replace(":walletId([0-9a-fA-F-]{36})", ":walletId")
      .replace(":signature([1-9A-HJ-NP-Za-km-z]{64,88})", ":signature")
  }));
}

export default { async rewrites() { return operatorApiRewrites(); } };
