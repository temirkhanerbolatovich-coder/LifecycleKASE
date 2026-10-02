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
    "/api/v1/investors",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/eligibility",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets/:walletId([0-9a-fA-F-]{36})/revoke",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets/:walletId([0-9a-fA-F-]{36})/verification/challenge",
    "/api/v1/investors/:id([0-9a-fA-F-]{36})/wallets/:walletId([0-9a-fA-F-]{36})/verification/verify"
  ];
  return sources.map((source) => ({
    source,
    destination: origin.origin + source
      .replace(":id([0-9a-fA-F-]{36})", ":id")
      .replace(":walletId([0-9a-fA-F-]{36})", ":walletId")
  }));
}

export default { async rewrites() { return operatorApiRewrites(); } };
