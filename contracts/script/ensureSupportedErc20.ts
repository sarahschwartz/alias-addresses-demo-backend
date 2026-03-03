import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import hre from 'hardhat';
import { getAddress } from 'viem';

const ZERO_CODE = '0x';

async function main() {
  const supportedPath = process.env.SUPPORTED_ERC20_JSON_PATH ?? resolve(process.cwd(), '../infra/supported-erc20.json');
  const configuredAddress = process.env.L1_ERC20_TOKEN_ADDRESS?.trim();

  const { viem } = hre;
  const publicClient = await viem.getPublicClient();

  let l1Address: `0x${string}`;
  if (configuredAddress) {
    const normalized = getAddress(configuredAddress);
    const code = await publicClient.getCode({ address: normalized });
    if (!code || code === ZERO_CODE) {
      throw new Error(`L1_ERC20_TOKEN_ADDRESS is set (${normalized}) but no contract code exists at that address on current L1 network.`);
    }
    l1Address = normalized;
  } else {
    const token = await viem.deployContract('MockERC20');
    l1Address = token.address;
    console.log(`Deployed MockERC20 at ${l1Address}`);
  }

  mkdirSync(resolve(supportedPath, '..'), { recursive: true });
  writeFileSync(supportedPath, JSON.stringify([{ l1Address }], null, 2));
  console.log(`Wrote supported ERC20 config to ${supportedPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
