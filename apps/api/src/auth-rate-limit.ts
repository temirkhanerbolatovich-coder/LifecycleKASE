import { Injectable } from "@nestjs/common";

import { AuthFlowError } from "./auth.js";

type RateLimitBucket = { count: number; windowStartedAt: number };

export type AuthRateLimitOptions = {
  challengeAttempts: number;
  verifyAttempts: number;
  mutationAttempts: number;
  windowSeconds: number;
  maxTrackedClients: number;
};

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function authRateLimitOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): AuthRateLimitOptions {
  return {
    challengeAttempts: positiveInteger(environment.AUTH_CHALLENGE_RATE_LIMIT, 5, "AUTH_CHALLENGE_RATE_LIMIT"),
    verifyAttempts: positiveInteger(environment.AUTH_VERIFY_RATE_LIMIT, 10, "AUTH_VERIFY_RATE_LIMIT"),
    mutationAttempts: positiveInteger(environment.MUTATION_RATE_LIMIT, 20, "MUTATION_RATE_LIMIT"),
    windowSeconds: positiveInteger(environment.AUTH_RATE_LIMIT_WINDOW_SECONDS, 60, "AUTH_RATE_LIMIT_WINDOW_SECONDS"),
    maxTrackedClients: positiveInteger(environment.AUTH_RATE_LIMIT_MAX_CLIENTS, 10_000, "AUTH_RATE_LIMIT_MAX_CLIENTS")
  };
}

export function trustedProxyHopsFromEnvironment(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment.TRUST_PROXY_HOPS;
  if (raw === undefined) return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 5");
  }
  return parsed;
}

export class AuthRateLimitError extends AuthFlowError {
  constructor(public readonly retryAfterSeconds: number) {
    super("AUTH_RATE_LIMITED", "Too many authentication attempts", 429);
  }
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMilliseconds: number,
    private readonly maxTrackedClients: number
  ) {}

  consume(clientKey: string, nowMilliseconds: number): void {
    if (!Number.isFinite(nowMilliseconds)) throw new Error("Rate-limit time must be finite");
    const current = this.buckets.get(clientKey);
    if (!current || nowMilliseconds - current.windowStartedAt >= this.windowMilliseconds) {
      this.makeRoom(nowMilliseconds);
      this.buckets.set(clientKey, { count: 1, windowStartedAt: nowMilliseconds });
      return;
    }
    if (current.count >= this.limit) {
      const remainingMilliseconds = this.windowMilliseconds - (nowMilliseconds - current.windowStartedAt);
      throw new AuthRateLimitError(Math.max(1, Math.ceil(remainingMilliseconds / 1000)));
    }
    current.count += 1;
  }

  private makeRoom(nowMilliseconds: number): void {
    if (this.buckets.size < this.maxTrackedClients) return;
    for (const [key, bucket] of this.buckets) {
      if (nowMilliseconds - bucket.windowStartedAt >= this.windowMilliseconds) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxTrackedClients) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.buckets.delete(oldestKey);
    }
  }
}

export function authenticationClientKey(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const value = request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
  return value.slice(0, 128);
}

@Injectable()
export class AuthRateLimitService {
  private readonly challengeLimiter: FixedWindowRateLimiter;
  private readonly verifyLimiter: FixedWindowRateLimiter;
  private readonly mutationLimiter: FixedWindowRateLimiter;

  constructor() {
    const options = authRateLimitOptionsFromEnvironment();
    const windowMilliseconds = options.windowSeconds * 1000;
    this.challengeLimiter = new FixedWindowRateLimiter(
      options.challengeAttempts, windowMilliseconds, options.maxTrackedClients
    );
    this.verifyLimiter = new FixedWindowRateLimiter(
      options.verifyAttempts, windowMilliseconds, options.maxTrackedClients
    );
    this.mutationLimiter = new FixedWindowRateLimiter(
      options.mutationAttempts, windowMilliseconds, options.maxTrackedClients
    );
  }

  consumeChallenge(clientKey: string, nowMilliseconds = Date.now()): void {
    this.challengeLimiter.consume(clientKey, nowMilliseconds);
  }

  consumeVerification(clientKey: string, nowMilliseconds = Date.now()): void {
    this.verifyLimiter.consume(clientKey, nowMilliseconds);
  }

  consumeMutation(clientKey: string, nowMilliseconds = Date.now()): void {
    this.mutationLimiter.consume(clientKey, nowMilliseconds);
  }
}
