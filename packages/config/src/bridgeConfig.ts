import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAddress } from 'viem';

export type BridgeTokenConfig = {
  l1Address: string;
  symbol: string;
  name: string;
  decimals: number;
  assetId: string;
  l2Address: string;
};

export type BridgeConfig = {
  l1: {
    chainId: number;
    bridgehub: `0x${string}`;
    assetRouter: `0x${string}`;
    nativeTokenVault: `0x${string}`;
    forwarderFactory: `0x${string}`;
  };
  l2: {
    chainId: number;
    vaultFactory: `0x${string}`;
    rpcUrl?: string;
  };
  tokens: BridgeTokenConfig[];
};

export function resolveBridgeConfigPath(): string {
  return process.env.BRIDGE_CONFIG_JSON_PATH ?? resolve(process.cwd(), '../../infra/bridge-config.json');
}

export function loadBridgeConfig(path = resolveBridgeConfigPath()): BridgeConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as BridgeConfig;
  return {
    ...parsed,
    l1: {
      ...parsed.l1,
      bridgehub: getAddress(parsed.l1.bridgehub),
      assetRouter: getAddress(parsed.l1.assetRouter),
      nativeTokenVault: getAddress(parsed.l1.nativeTokenVault),
      forwarderFactory: getAddress(parsed.l1.forwarderFactory)
    },
    l2: {
      ...parsed.l2,
      vaultFactory: getAddress(parsed.l2.vaultFactory)
    },
    tokens: (parsed.tokens ?? []).map((t) => ({
      ...t,
      l1Address: getAddress(t.l1Address),
      l2Address: getAddress(t.l2Address)
    }))
  };
}
