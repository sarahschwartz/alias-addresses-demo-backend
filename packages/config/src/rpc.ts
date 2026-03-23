import { fallback, http } from 'viem';

export function createRpcTransport(primaryUrl: string, backupUrl?: string) {
  const urls = [primaryUrl, backupUrl]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));

  if (urls.length === 0) {
    throw new Error('At least one RPC URL is required');
  }

  if (urls.length === 1) {
    return http(urls[0]);
  }

  return fallback(
    urls.map((url) => http(url)),
    { rank: false }
  );
}
