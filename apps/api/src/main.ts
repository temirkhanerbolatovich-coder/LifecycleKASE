import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { isNativeError } from "node:util/types";
import { AppModule } from "./app.module.js";
import { authOptionsFromEnvironment } from "./auth.js";
import { trustedProxyHopsFromEnvironment } from "./auth-rate-limit.js";
import { programUpgradeEnabled } from "./program-upgrade.js";
import { actionApprovalEnabled } from "./action-approval.js";
import { couponExecutionEnabled } from "./coupon-execution.js";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch (error) {
  if (!isNativeError(error) || !('code' in error) || error.code !== "ENOENT") {
    throw error;
  }
}

function apiPort(value: string | undefined): number {
  if (value === undefined) return 4000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

programUpgradeEnabled();
actionApprovalEnabled();
couponExecutionEnabled();
const app = await NestFactory.create(AppModule);
app.getHttpAdapter().getInstance().set("trust proxy", trustedProxyHopsFromEnvironment());
app.setGlobalPrefix("api/v1");
app.enableCors({ origin: [...authOptionsFromEnvironment().allowedOrigins], credentials: true });
app.enableShutdownHooks();
const listenHost = process.env.API_LISTEN_HOST ?? "0.0.0.0";
if (!["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"].includes(listenHost)) {
  throw new Error("API_LISTEN_HOST must be a loopback or wildcard listen address");
}
await app.listen(apiPort(process.env.PORT), listenHost);
