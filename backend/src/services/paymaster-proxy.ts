import type { AppConfig } from "../config.js";

/**
 * Proxy an AVNU paymaster JSON-RPC request through the backend.
 *
 * The AVNU API key is appended server-side so it never reaches the frontend.
 * This is the correct architecture per AVNU docs:
 *   https://docs.avnu.fi/docs/paymaster/gasfree
 *
 * Usage from a Fastify route:
 *   const result = await proxyPaymasterRequest(config, request.body);
 *   reply.send(result);
 */
export async function proxyPaymasterRequest(
  config: AppConfig,
  body: unknown
): Promise<unknown> {
  if (!config.avnuPaymasterNodeUrl) {
    throw new Error("AVNU paymaster node URL is not configured");
  }
  if (!config.avnuPaymasterApiKey) {
    throw new Error("AVNU API key is not configured");
  }

  const response = await fetch(config.avnuPaymasterNodeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paymaster-api-key": config.avnuPaymasterApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `AVNU paymaster proxy failed: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`
    );
  }

  return response.json();
}

/**
 * Check if the AVNU API key is valid by making a lightweight call.
 * Returns true if the key is accepted, false otherwise.
 */
export async function isAvnuApiKeyValid(config: AppConfig): Promise<boolean> {
  if (!config.avnuPaymasterNodeUrl || !config.avnuPaymasterApiKey) {
    return false;
  }

  try {
    const response = await fetch(config.avnuPaymasterNodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paymaster-api-key": config.avnuPaymasterApiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "starknet_chainId",
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) return false;
    const payload = await response.json() as { error?: { code?: number; message?: string } };
    // AVNU returns error 163 for invalid keys even on chainId calls
    if (payload.error?.code === 163) return false;
    return !payload.error;
  } catch {
    return false;
  }
}