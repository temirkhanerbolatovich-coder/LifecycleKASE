// The existing wrapper owns the fresh validator, signer and PostgreSQL lifecycle.
process.env.KASE_CONTROLLED_WORKFLOW = "true";
await import("./test-kase-demo.mjs");
