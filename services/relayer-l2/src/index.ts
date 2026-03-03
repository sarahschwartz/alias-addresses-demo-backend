import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { FORWARDER_FACTORY_L1_ABI, ONE_WAY_VAULT_ABI, STEALTH_FORWARDER_L1_ABI, VAULT_FACTORY_ABI } from '@prividium-poc/types';
import { loadBridgeConfig } from '@prividium-poc/config';
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

if (process.env.ENV_FILE) {
  dotenv.config({ path: process.env.ENV_FILE, override: true });
} else {
  dotenv.config({ path: resolve(process.cwd(), '../../.env') });
}

const pk = process.env.RELAYER_L2_PRIVATE_KEY;
const rpc = process.env.L2_RPC_URL ?? 'https://zksync-os-testnet-alpha.zksync.dev/';
if (!pk || !rpc) throw new Error('RELAYER_L2_PRIVATE_KEY and L2_RPC_URL required');

const transport = http(rpc);
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ transport, account: privateKeyToAccount(pk as `0x${string}`) });
const sqlitePath = process.env.SQLITE_PATH ?? resolve(process.cwd(), '../data/poc.db');
mkdirSync(dirname(sqlitePath), { recursive: true });
const db = new Database(sqlitePath);
db.pragma('busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS aliases (
    aliasKey TEXT PRIMARY KEY,
    normalizedEmail TEXT NOT NULL,
    suffix TEXT NOT NULL,
    recipientPrividiumAddress TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deposit_requests (
    trackingId TEXT PRIMARY KEY,
    aliasKey TEXT NOT NULL,
    recipientPrividiumAddress TEXT,
    l1DepositAddressY TEXT NOT NULL,
    l2VaultAddressX TEXT NOT NULL,
    saltY TEXT NOT NULL,
    saltX TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    lastActivityAt INTEGER NOT NULL,
    inflightL1 INTEGER NOT NULL DEFAULT 0,
    inflightL2 INTEGER NOT NULL DEFAULT 0,
    isActive INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS deposit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trackingId TEXT NOT NULL,
    kind TEXT NOT NULL,
    l1TokenAddress TEXT,
    amount TEXT NOT NULL,
    status TEXT NOT NULL,
    detectedAtL1 INTEGER,
    l1DepositTxHash TEXT,
    l1DeployTxHash TEXT,
    l1BridgeTxHash TEXT,
    l2ArrivedAt INTEGER,
    l2DeployForwarderTxHash TEXT,
    l2SweepYtoXTxHash TEXT,
    l2DeployVaultTxHash TEXT,
    l2SweepXtoRTxHash TEXT,
    l2DeployTxHash TEXT,
    l2SweepTxHash TEXT,
    error TEXT,
    note TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt INTEGER NOT NULL DEFAULT 0,
    stuck INTEGER NOT NULL DEFAULT 0,
    lastErrorAt INTEGER,
    createdAt INTEGER NOT NULL
  );
`);
const bridgeConfig = loadBridgeConfig();
const tokenMap = Object.fromEntries(bridgeConfig.tokens.map((t) => [t.l1Address.toLowerCase(), t.l2Address]));
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? 5);
const baseDelaySeconds = Number(process.env.BASE_DELAY_SECONDS ?? 15);
const maxDelaySeconds = Number(process.env.MAX_DELAY_SECONDS ?? 900);
const forwarderFactoryL2 = getAddress(bridgeConfig.l1.forwarderFactory);
const defaultRefundRecipient = (() => {
  const explicit = process.env.REFUND_RECIPIENT_L2?.trim();
  if (explicit) return getAddress(explicit);
  const refundPk = process.env.RELAYER_L2_PRIVATE_KEY?.trim();
  if (refundPk) return privateKeyToAccount(refundPk as `0x${string}`).address;
  return null;
})();

function computeNextAttemptAt(nowMs: number, attempts: number): number {
  const delaySec = Math.min(2 ** attempts * baseDelaySeconds, maxDelaySeconds);
  return nowMs + delaySec * 1000;
}

function markEventError(eventId: number, err: unknown) {
  const row = db.prepare('SELECT attempts FROM deposit_events WHERE id=?').get(eventId) as any;
  const attempts = Number(row?.attempts ?? 0) + 1;
  const now = Date.now();
  const stuck = attempts >= maxAttempts ? 1 : 0;
  const nextAttemptAt = stuck ? now : computeNextAttemptAt(now, attempts);
  db.prepare('UPDATE deposit_events SET status=?, error=?, attempts=?, nextAttemptAt=?, stuck=?, lastErrorAt=? WHERE id=?').run(stuck ? 'stuck' : 'l2_failed', String(err), attempts, nextAttemptAt, stuck, now, eventId);
}

async function ensureForwarderAndSweepYtoX(y: `0x${string}`, request: any, kind: 'ETH' | 'ERC20', l2Token?: `0x${string}` | null) {
  const code = await publicClient.getCode({ address: y });
  let deployTx: `0x${string}` | null = null;
  if (!code || code === '0x') {
    const refundRecipient = defaultRefundRecipient ?? request.recipientPrividiumAddress;
    deployTx = await walletClient.writeContract({
      chain: null,
      address: forwarderFactoryL2,
      abi: FORWARDER_FACTORY_L1_ABI,
      functionName: 'deploy',
      args: [request.saltY, bridgeConfig.l1.bridgehub, BigInt(bridgeConfig.l2.chainId), request.l2VaultAddressX, refundRecipient, bridgeConfig.l1.assetRouter, bridgeConfig.l1.nativeTokenVault]
    });
    await publicClient.waitForTransactionReceipt({ hash: deployTx });
  }

  const sweepTx = await walletClient.writeContract({
    chain: null,
    address: y,
    abi: STEALTH_FORWARDER_L1_ABI,
    functionName: kind === 'ETH' ? 'sweepETH' : 'sweepERC20',
    args: kind === 'ETH' ? [] : [getAddress(l2Token!)]
  });
  await publicClient.waitForTransactionReceipt({ hash: sweepTx });
  return { deployTx, sweepTx };
}

async function ensureVaultAndSweep(x: `0x${string}`, saltX: `0x${string}`, recipient: `0x${string}`, kind: 'ETH' | 'ERC20', token?: string | null) {
  const code = await publicClient.getCode({ address: x });
  let deployTx: `0x${string}` | null = null;
  if (!code || code === '0x') {
    deployTx = await walletClient.writeContract({ chain: null, address: bridgeConfig.l2.vaultFactory, abi: VAULT_FACTORY_ABI, functionName: 'deployVault', args: [saltX, recipient] });
    await publicClient.waitForTransactionReceipt({ hash: deployTx });
  }

  const sweepTx = await walletClient.writeContract({
    chain: null,
    address: x,
    abi: ONE_WAY_VAULT_ABI,
    functionName: kind === 'ETH' ? 'sweepETH' : 'sweepERC20',
    args: kind === 'ETH' ? [] : [getAddress(token!)]
  });
  await publicClient.waitForTransactionReceipt({ hash: sweepTx });
  return { deployTx, sweepTx };
}

async function processSubmittedEvent(event: any, request: any, recipient: `0x${string}`) {
  const y = getAddress(request.l1DepositAddressY);
  const x = getAddress(request.l2VaultAddressX);
  const kind = event.kind as 'ETH' | 'ERC20';
  const mapped = tokenMap[(event.l1TokenAddress ?? '').toLowerCase()] ?? event.l1TokenAddress;
  const l2Token = kind === 'ERC20' ? getAddress(mapped) : null;
  const yBal = kind === 'ETH'
    ? await publicClient.getBalance({ address: y })
    : ((await publicClient.readContract({ address: l2Token!, abi: erc20Abi, functionName: 'balanceOf', args: [y] })) as bigint);
  if (yBal === 0n) return;

  db.prepare('UPDATE deposit_events SET status=?, l2ArrivedAt=? WHERE id=?').run('l2_arrived', Date.now(), event.id);

  const yStep = await ensureForwarderAndSweepYtoX(y, request, kind, l2Token);
  if (yStep.deployTx) {
    db.prepare('UPDATE deposit_events SET status=?, l2DeployForwarderTxHash=? WHERE id=?').run('l2_forwarder_deployed', yStep.deployTx, event.id);
  }
  db.prepare('UPDATE deposit_events SET status=?, l2SweepYtoXTxHash=? WHERE id=?').run('l2_swept_y_to_x', yStep.sweepTx, event.id);

  const xBal = kind === 'ETH'
    ? await publicClient.getBalance({ address: x })
    : ((await publicClient.readContract({ address: l2Token!, abi: erc20Abi, functionName: 'balanceOf', args: [x] })) as bigint);
  if (xBal === 0n) {
    throw new Error('sweep Y->X executed but X has zero balance');
  }

  const { deployTx, sweepTx } = await ensureVaultAndSweep(x, request.saltX, recipient, kind, l2Token);
  if (deployTx) {
    db.prepare('UPDATE deposit_events SET status=?, l2DeployVaultTxHash=?, l2DeployTxHash=? WHERE id=?').run('l2_vault_deployed', deployTx, deployTx, event.id);
  }
  db.prepare('UPDATE deposit_events SET status=?, l2SweepXtoRTxHash=?, l2SweepTxHash=? WHERE id=?').run('credited', sweepTx, sweepTx, event.id);
  db.prepare('UPDATE deposit_requests SET lastActivityAt=? WHERE trackingId=?').run(Date.now(), request.trackingId);
}

async function tick() {
  const rows = db
    .prepare(`SELECT e.*, dr.saltY, dr.saltX, dr.l1DepositAddressY, dr.l2VaultAddressX, dr.trackingId, COALESCE(dr.recipientPrividiumAddress, a.recipientPrividiumAddress) AS recipientPrividiumAddress
      FROM deposit_events e
      JOIN deposit_requests dr ON dr.trackingId = e.trackingId
      JOIN aliases a ON a.aliasKey = dr.aliasKey
      WHERE (e.status='l1_bridging_submitted' OR e.status='l2_failed') AND e.stuck=0 AND e.nextAttemptAt<=?
      ORDER BY e.createdAt ASC LIMIT 30`)
    .all(Date.now()) as any[];

  for (const row of rows) {
    try {
      await processSubmittedEvent(row, row, row.recipientPrividiumAddress);
    } catch (e) {
      console.log(`Error processing submitted event ${row.id} for trackingId ${row.trackingId}:`, e);
      markEventError(row.id, e);
    }
  }
}

setInterval(() => void tick(), Number(process.env.RELAYER_POLL_MS ?? 7000));
void tick();
