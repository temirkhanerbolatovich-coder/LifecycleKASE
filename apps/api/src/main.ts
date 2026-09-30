import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { isNativeError } from "node:util/types";
import { AppModule } from "./app.module.js";
import { authOptionsFromEnvironment } from "./auth.js";

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

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix("api/v1");
app.enableCors({ origin: [...authOptionsFromEnvironment().allowedOrigins], credentials: true });
app.enableShutdownHooks();
await app.listen(apiPort(process.env.PORT), "0.0.0.0");
