import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import hre from 'hardhat';

const BRIDGEHUB_ABI = [
  {
    type: 'function',
    name: 'assetRouter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  }
] as const;

const ASSET_ROUTER_ABI = [
  {
    type: 'function',
    name: 'nativeTokenVault',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }]
  }
] as const;

async function main() {
  const l1ChainId = Number(process.env.L1_CHAIN_ID ?? 11155111);
  const envContractsPath = process.env.CONTRACTS_JSON_PATH?.trim();
  const path = envContractsPath || resolve(process.cwd(), `deployments/${l1ChainId}.json`);
  const bridgehub = process.env.BRIDGEHUB_ADDRESS as `0x${string}`;
  if (!bridgehub) throw new Error('BRIDGEHUB_ADDRESS required');
  if (!existsSync(path)) {
    throw new Error(`Deployment file not found at ${path}. Run contracts deploy first or set CONTRACTS_JSON_PATH.`);
  }

  const { viem } = hre;
  const publicClient = await viem.getPublicClient();
  const assetRouter = await publicClient.readContract({ address: bridgehub, abi: BRIDGEHUB_ABI, functionName: 'assetRouter' });
  const nativeTokenVault = await publicClient.readContract({ address: assetRouter, abi: ASSET_ROUTER_ABI, functionName: 'nativeTokenVault' });

  const current = JSON.parse(readFileSync(path, 'utf8'));
  current.assetRouter = assetRouter;
  current.nativeTokenVault = nativeTokenVault;

  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(current, null, 2));
  console.log({ bridgehub, assetRouter, nativeTokenVault });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
