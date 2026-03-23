import { custom } from 'viem';

type RpcRequest = {
  method: string;
  params?: unknown[] | object;
};

type JsonRpcSuccess = {
  result: unknown;
};

type JsonRpcError = {
  error?: {
    code?: number;
    message?: string;
  };
};

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('429') || message.includes('too many requests') || message.includes('rate limit') || message.includes('rate exceeded');
}

function parseRpcError(payload: JsonRpcError, url: string): never {
  const code = payload.error?.code;
  const message = payload.error?.message ?? 'Unknown JSON-RPC error';
  throw new Error(`RPC error from ${url}: ${code ?? 'unknown'} ${message}`);
}

async function sendRpc(url: string, body: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RPC ${response.status} from ${url}: ${text}`);
  }

  return response.json() as Promise<JsonRpcSuccess | JsonRpcError>;
}

export function createRpcTransport(primaryUrl: string, backupUrl?: string) {
  const urls = [primaryUrl, backupUrl]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));

  if (urls.length === 0) throw new Error('At least one RPC URL is required');

  const rateLimitCooldownMs = Number(process.env.RPC_RATE_LIMIT_COOLDOWN_MS ?? 60000);
  const cooldownUntil = new Map<string, number>();

  return custom({
    async request({ method, params }: RpcRequest) {
      const now = Date.now();
      const orderedUrls = [
        ...urls.filter((url) => (cooldownUntil.get(url) ?? 0) <= now),
        ...urls.filter((url) => (cooldownUntil.get(url) ?? 0) > now)
      ];

      let lastError: unknown;

      for (const url of orderedUrls) {
        try {
          const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params: params ?? []
          });
          const result = await sendRpc(url, payload);
          if ('error' in result && result.error) parseRpcError(result, url);
          cooldownUntil.delete(url);
          return result.result;
        } catch (error) {
          lastError = error;
          if (isRateLimitError(error)) {
            cooldownUntil.set(url, Date.now() + rateLimitCooldownMs);
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error('All RPC URLs failed');
    }
  });
}
