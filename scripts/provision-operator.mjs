import process from "node:process";

import { PrismaClient } from "@prisma/client";
import { provisionOperator } from "../apps/api/dist/operator-provisioning.js";

const usage = `Usage:
  npm run operator:provision -- --wallet <public-key> --display-name <name> \\
    --role <role> [--email <email>] [--network SOLANA_DEVNET|SOLANA_LOCALNET] \\
    --confirm <same-public-key>

This command accepts only a public wallet address. Never provide a private key or seed phrase.`;

function argumentsFrom(commandLine) {
  const values = new Map();
  for (let index = 0; index < commandLine.length; index += 2) {
    const key = commandLine[index];
    const value = commandLine[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${key ?? "end of command"}`);
    }
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    values.set(key, value);
  }
  const known = new Set(["--wallet", "--display-name", "--role", "--email", "--network", "--confirm"]);
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`Unknown argument: ${key}`);
  for (const required of ["--wallet", "--display-name", "--role", "--confirm"]) {
    if (!values.has(required)) throw new Error(`Missing required argument: ${required}`);
  }
  if (values.get("--confirm") !== values.get("--wallet")) {
    throw new Error("--confirm must exactly repeat the public wallet address");
  }
  return values;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must point to the reviewed target database.");
  process.exit(2);
}

let values;
try {
  values = argumentsFrom(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(2);
}

const database = new PrismaClient();
try {
  const result = await provisionOperator(database, {
    walletAddress: values.get("--wallet"),
    displayName: values.get("--display-name"),
    ...(values.has("--email") ? { normalizedEmail: values.get("--email") } : {}),
    role: values.get("--role"),
    network: values.get("--network") ?? "SOLANA_DEVNET",
    now: new Date()
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
