import { readFileSync } from 'node:fs';
import { getAddress } from 'viem';

export type SupportedToken = { l1Address: string; symbol: string; decimals: number; name: string; assetId?: string; l2Address?: string };

export function loadSupportedTokens(path: string): SupportedToken[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { tokens?: SupportedToken[] } | SupportedToken[];
  const items = Array.isArray(raw) ? raw : (raw.tokens ?? []);
  return items.map((t) => ({ ...t, l1Address: getAddress(t.l1Address) }));
}

export function toTokenAllowlist(tokens: SupportedToken[]): Set<string> {
  return new Set(tokens.map((t) => t.l1Address.toLowerCase()));
}

export function tryAcquireInflight(current: number): boolean {
  return current === 0;
}

export function isTokenSupported(allowlist: Set<string>, token: string): boolean {
  return allowlist.has(token.toLowerCase());
}

export function computeNextAttemptAt(nowMs: number, attempts: number, baseDelaySec: number, maxDelaySec: number): number {
  const delaySec = Math.min(2 ** attempts * baseDelaySec, maxDelaySec);
  return nowMs + delaySec * 1000;
}
