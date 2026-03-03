import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { createPublicClient, erc20Abi, getAddress, http, parseAbi } from 'viem';

if (process.env.ENV_FILE) {
  dotenv.config({ path: process.env.ENV_FILE, override: true });
} else {
  dotenv.config({ path: resolve(process.cwd(), '../../.env') });
}

const envContractsPath = process.env.CONTRACTS_JSON_PATH?.trim();
const envSupportedPath = process.env.SUPPORTED_ERC20_JSON_PATH?.trim();
const envOutPath = process.env.BRIDGE_CONFIG_JSON_PATH?.trim();

const contractsPath = envContractsPath
  || resolve(process.cwd(), `../../contracts/deployments/${Number(process.env.L1_CHAIN_ID ?? 11155111)}.json`);
const supportedPath = envSupportedPath || resolve(process.cwd(), '../../infra/supported-erc20.json');
const outPath = envOutPath || resolve(process.cwd(), '../../infra/bridge-config.json');
const autoRegister = process.env.AUTO_REGISTER_TOKENS === '1';

const cfg = JSON.parse(readFileSync(contractsPath, 'utf8')) as any;
const supported = JSON.parse(readFileSync(supportedPath, 'utf8')) as Array<{ l1Address: string }>;

const l1Rpc = process.env.L1_RPC_URL ?? process.env.RPC_URL_SEPOLIA;
const l2Rpc = process.env.L2_RPC_URL ?? 'https://zksync-os-testnet-alpha.zksync.dev/';
if (!l1Rpc || !l2Rpc) throw new Error('L1_RPC_URL and L2_RPC_URL required');

const nativeTokenVaultAbi = parseAbi([
  'function assetId(address token) view returns (bytes32)',
  'function tokenAddress(bytes32 tokenAssetId) view returns (address)',
  'function ensureTokenIsRegistered(address token) returns (bytes32)'
]);

const L2NativeTokenVault = `0x0000000000000000000000000000000000010004`;

async function main() {
  const l1 = createPublicClient({ transport: http(l1Rpc) });
  const l2 = createPublicClient({ transport: http(l2Rpc) });

  const nativeTokenVault = getAddress(cfg.nativeTokenVault);

  const tokens = [] as Array<{ l1Address: string; symbol: string; name: string; decimals: number; assetId: string; l2Address: string }>;
  for (const entry of supported) {
    const l1Address = getAddress(entry.l1Address);
    const [symbol, name, decimals] = await Promise.all([
      l1.readContract({ address: l1Address, abi: erc20Abi, functionName: 'symbol' }),
      l1.readContract({ address: l1Address, abi: erc20Abi, functionName: 'name' }),
      l1.readContract({ address: l1Address, abi: erc20Abi, functionName: 'decimals' })
    ]);

    let assetId = (await l1.readContract({ address: nativeTokenVault, abi: nativeTokenVaultAbi, functionName: 'assetId', args: [l1Address] })) as `0x${string}`;
    let l2Address = (await l2.readContract({ address: L2NativeTokenVault, abi: nativeTokenVaultAbi, functionName: 'tokenAddress', args: [assetId] })) as `0x${string}`;
    if (l2Address === '0x0000000000000000000000000000000000000000' && autoRegister) {
      throw new Error('AUTO_REGISTER_TOKENS requires signer-enabled flow; unsupported in read-only script');
    }

    tokens.push({ l1Address, symbol, name, decimals, assetId, l2Address });
  }

  const output = {
    l1: {
      chainId: Number(cfg.l1?.chainId ?? process.env.L1_CHAIN_ID ?? 11155111),
      bridgehub: getAddress(cfg.l1?.bridgehub ?? cfg.bridgehub),
      assetRouter: getAddress(cfg.assetRouter),
      nativeTokenVault,
      forwarderFactory: getAddress(cfg.l1?.forwarderFactoryL1 ?? cfg.l1?.forwarderFactory)
    },
    l2: {
      chainId: Number(cfg.l2?.chainId ?? process.env.L2_CHAIN_ID ?? 8022833),
      vaultFactory: getAddress(cfg.l2?.vaultFactory),
      rpcUrl: l2Rpc
    },
    tokens
  };

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`wrote bridge config to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
