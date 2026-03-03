import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import hre from 'hardhat';
import { concatHex, createPublicClient, createWalletClient, getAddress, http, keccak256, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const CREATE2_DEPLOYER = getAddress('0x4e59b44847b379578588920cA78FbF26c0B4956C');
const CREATE2_DEPLOYER_BOOTSTRAP_FUNDER = getAddress('0x3fab184622dc19b6109349b94811493bf2a45362');
const CREATE2_DEPLOYER_BOOTSTRAP_RAW_TX =
  '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222';
const FORWARDER_FACTORY_CREATE2_SALT = (process.env.FORWARDER_FACTORY_CREATE2_SALT ?? '0x' + '00'.repeat(32)) as `0x${string}`;

function computeCreate2Address(deployer: `0x${string}`, salt: `0x${string}`, initCode: `0x${string}`): `0x${string}` {
  const hash = keccak256(concatHex(['0xff', deployer, salt, keccak256(initCode)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

async function deployCreate2IfNeeded(params: {
  publicClient: any;
  sendTransaction: (tx: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
  initCode: `0x${string}`;
  salt: `0x${string}`;
  label: string;
}) {
  const { publicClient, sendTransaction, initCode, salt, label } = params;
  const deployed = computeCreate2Address(CREATE2_DEPLOYER, salt, initCode);
  const code = await publicClient.getCode({ address: deployed });
  if (!code || code === '0x') {
    const hash = await sendTransaction({ to: CREATE2_DEPLOYER, data: concatHex([salt, initCode]) });
    await publicClient.waitForTransactionReceipt({ hash });
    const codeAfter = await publicClient.getCode({ address: deployed });
    if (!codeAfter || codeAfter === '0x') throw new Error(`${label} deterministic deployment failed at ${deployed}`);
  }
  return deployed;
}

async function ensureCreate2DeployerOnL2(params: {
  l2RpcUrl: string;
  l2PublicClient: ReturnType<typeof createPublicClient>;
  l2WalletClient: ReturnType<typeof createWalletClient>;
}) {
  const { l2RpcUrl, l2PublicClient, l2WalletClient } = params;

  const code = await l2PublicClient.getCode({ address: CREATE2_DEPLOYER });
  if (code && code !== '0x') return;

  console.log(`CREATE2 deployer missing on L2 at ${CREATE2_DEPLOYER}. Bootstrapping...`);

  const fundTx = await l2WalletClient.sendTransaction({
    chain: null,
    to: CREATE2_DEPLOYER_BOOTSTRAP_FUNDER,
    value: parseEther('0.1'),
    account: l2WalletClient.account!.address
  });
  await l2PublicClient.waitForTransactionReceipt({ hash: fundTx });

  const rpcResp = await fetch(l2RpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [CREATE2_DEPLOYER_BOOTSTRAP_RAW_TX]
    })
  });
  const payload = (await rpcResp.json()) as { result?: `0x${string}`; error?: { message?: string } };
  const txHash = payload.result;
  const maybeAlreadyKnown = (payload.error?.message ?? '').toLowerCase();

  if (txHash) {
    await l2PublicClient.waitForTransactionReceipt({ hash: txHash });
  } else if (!maybeAlreadyKnown.includes('already known') && !maybeAlreadyKnown.includes('nonce too low')) {
    throw new Error(`Failed to bootstrap CREATE2 deployer on L2: ${payload.error?.message ?? 'unknown RPC error'}`);
  }

  const codeAfter = await l2PublicClient.getCode({ address: CREATE2_DEPLOYER });
  if (!codeAfter || codeAfter === '0x') {
    throw new Error(`CREATE2 deployer bootstrap failed. No code at ${CREATE2_DEPLOYER} on L2.`);
  }
}

async function main() {
  const bridgehub = process.env.BRIDGEHUB_ADDRESS as `0x${string}` | undefined;
  const l2ChainId = Number(process.env.L2_CHAIN_ID ?? 0);
  if (!l2ChainId) throw new Error('L2_CHAIN_ID  is required');

  const { viem, network } = hre;

  const [l1Deployer] = await viem.getWalletClients();
  const l1PublicClient = await viem.getPublicClient();

  // Deploy L2 vault factory via explicit L2 RPC + signer so it lands on L2, not the active Hardhat network.
  const l2RpcUrl = process.env.L2_RPC_URL;
  const l2Pk = (process.env.L2_DEPLOYER_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!l2RpcUrl || !l2Pk) {
    throw new Error('L2_RPC_URL and L2_DEPLOYER_PRIVATE_KEY are required');
  }

  const vaultFactoryArtifactPath = resolve(process.cwd(), 'artifacts/src/l2/VaultFactory.sol/VaultFactory.json');
  const vaultFactoryArtifact = JSON.parse(readFileSync(vaultFactoryArtifactPath, 'utf8')) as {
    abi: readonly unknown[];
    bytecode: `0x${string}`;
  };

  const l2Account = privateKeyToAccount(l2Pk);
  const l2WalletClient = createWalletClient({ account: l2Account, transport: http(l2RpcUrl) });
  const l2PublicClient = createPublicClient({ transport: http(l2RpcUrl) });
  await ensureCreate2DeployerOnL2({ l2RpcUrl, l2PublicClient, l2WalletClient });

  const forwarderFactoryArtifactPath = resolve(process.cwd(), 'artifacts/src/l1/ForwarderFactoryL1.sol/ForwarderFactoryL1.json');
  const forwarderFactoryArtifact = JSON.parse(readFileSync(forwarderFactoryArtifactPath, 'utf8')) as {
    bytecode: `0x${string}`;
  };

  const forwarderFactoryL1Address = await deployCreate2IfNeeded({
    publicClient: l1PublicClient,
    sendTransaction: ({ to, data }) => l1Deployer.sendTransaction({ to, data }),
    initCode: forwarderFactoryArtifact.bytecode,
    salt: FORWARDER_FACTORY_CREATE2_SALT,
    label: 'ForwarderFactoryL1 on L1'
  });

  const forwarderFactoryL2Address = await deployCreate2IfNeeded({
    publicClient: l2PublicClient,
    sendTransaction: ({ to, data }) => l2WalletClient.sendTransaction({ chain: null, to, data }),
    initCode: forwarderFactoryArtifact.bytecode,
    salt: FORWARDER_FACTORY_CREATE2_SALT,
    label: 'ForwarderFactoryL1 on L2'
  });

  if (forwarderFactoryL1Address.toLowerCase() !== forwarderFactoryL2Address.toLowerCase()) {
    throw new Error(`ForwarderFactoryL1 deterministic address mismatch. L1=${forwarderFactoryL1Address}, L2=${forwarderFactoryL2Address}`);
  }

  const l2DeployTx = await l2WalletClient.deployContract({
    chain: null,
    abi: vaultFactoryArtifact.abi,
    bytecode: vaultFactoryArtifact.bytecode,
    args: []
  });
  const l2Receipt = await l2PublicClient.waitForTransactionReceipt({ hash: l2DeployTx });
  if (!l2Receipt.contractAddress) throw new Error('L2 vault factory deployment did not return contractAddress');
  const vaultFactoryAddress = l2Receipt.contractAddress;

  const payload = {
    l1: {
      chainId: Number(network.config.chainId ?? process.env.L1_CHAIN_ID ?? 11155111),
      forwarderFactory: forwarderFactoryL1Address,
      bridgehub: bridgehub ?? '0x0000000000000000000000000000000000000000'
    },
    l2: {
      chainId: l2ChainId,
      forwarderFactory: forwarderFactoryL2Address,
      vaultFactory: vaultFactoryAddress
    },
    assetRouter: process.env.ASSET_ROUTER_ADDRESS ?? '',
    nativeTokenVault: process.env.NATIVE_TOKEN_VAULT_ADDRESS ?? '',
    deployedAt: new Date().toISOString()
  };

  if (process.env.CONTRACTS_JSON_PATH) {
    writeFileSync(process.env.CONTRACTS_JSON_PATH, JSON.stringify(payload, null, 2));
    console.log(`Deployment info written to ${process.env.CONTRACTS_JSON_PATH}`);
  } else {
    const outDir = resolve(process.cwd(), 'deployments');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `${payload.l1.chainId}.json`), JSON.stringify(payload, null, 2));
  }
  console.log(payload);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
