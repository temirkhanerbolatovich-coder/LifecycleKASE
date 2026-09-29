export class SolanaRpcError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SolanaRpcError";
  }
}

export interface SolanaRpc {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}

export class HttpSolanaRpc implements SolanaRpc {
  private readonly endpoint: string;

  constructor(
    endpoint: string,
    private readonly timeoutMs = 15_000,
    private readonly fetchRequest: typeof fetch = fetch
  ) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new SolanaRpcError("INVALID_RPC_ENDPOINT", "RPC endpoint URL is invalid");
    }
    if (url.username || url.password || url.hash) {
      throw new SolanaRpcError("INVALID_RPC_ENDPOINT", "RPC endpoint must not contain credentials or a fragment");
    }
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
      throw new SolanaRpcError(
        "INVALID_RPC_ENDPOINT",
        "RPC endpoint must use HTTPS or local HTTP"
      );
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new SolanaRpcError("INVALID_TIMEOUT", "RPC timeout must be positive");
    }
    this.endpoint = url.toString();
  }

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchRequest(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new SolanaRpcError("RPC_TRANSPORT_FAILED", "Solana RPC request failed");
    }
    if (!response.ok) {
      throw new SolanaRpcError(
        "RPC_HTTP_ERROR",
        "Solana RPC returned HTTP " + response.status
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Solana RPC returned invalid JSON");
    }
    if (!payload || typeof payload !== "object") {
      throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Solana RPC returned an invalid response");
    }
    const envelope = payload as Record<string, unknown>;
    if (envelope["jsonrpc"] !== "2.0" || envelope["id"] !== 1) {
      throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Solana RPC response ID or version is invalid");
    }
    if (envelope["error"] !== undefined) {
      throw new SolanaRpcError("RPC_METHOD_FAILED", "Solana RPC method " + method + " failed");
    }
    if (!Object.hasOwn(envelope, "result")) {
      throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Solana RPC result is missing");
    }
    return envelope["result"];
  }
}
