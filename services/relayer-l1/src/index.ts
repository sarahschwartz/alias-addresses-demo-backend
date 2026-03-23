import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { FORWARDER_FACTORY_L1_ABI, STEALTH_FORWARDER_L1_ABI } from '@prividium-poc/types';
import { createRpcTransport, loadBridgeConfig } from '@prividium-poc/config';
import { createPublicClient, createWalletClient, erc20Abi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { computeNextAttemptAt, loadSupportedTokens, toTokenAllowlist, tryAcquireInflight } from './lib.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serviceDir = resolve(moduleDir, '..');
const repoRoot = resolve(serviceDir, '../..');

if (process.env.ENV_FILE) {
  dotenv.config({ path: process.env.ENV_FILE, override: true });
} else {
  dotenv.config({ path: resolve(repoRoot, '.env') });
}
const pk = process.env.RELAYER_L1_PRIVATE_KEY;
const rpc = process.env.L1_RPC_URL;
if (!pk || !rpc) throw new Error('RELAYER_L1_PRIVATE_KEY and L1_RPC_URL required');

const bridgeConfig = loadBridgeConfig();
const sqlitePath = process.env.SQLITE_PATH ?? resolve(repoRoot, 'services/data/poc.db');
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
const supportedTokens = loadSupportedTokens(process.env.BRIDGE_CONFIG_JSON_PATH ?? resolve(repoRoot, 'infra/bridge-config.json'));
const tokenAllowlist = toTokenAllowlist(supportedTokens);
const account = privateKeyToAccount(pk as `0x${string}`);
const l1Transport = createRpcTransport(rpc, process.env.L1_RPC_URL_BACKUP);
const publicClient = createPublicClient({ transport: l1Transport });
const walletClient = createWalletClient({ transport: l1Transport, account });

const defaultMintEth = BigInt(process.env.MINT_VALUE_WEI_ETH_DEFAULT ?? '2000000000000000');
const defaultMintErc20 = BigInt(process.env.MINT_VALUE_WEI_ERC20_DEFAULT ?? '3000000000000000');
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? 5);
const baseDelaySeconds = Number(process.env.BASE_DELAY_SECONDS ?? 15);
const maxDelaySeconds = Number(process.env.MAX_DELAY_SECONDS ?? 900);
const pollMs = Number(process.env.RELAYER_POLL_MS ?? 7000);
const shortIdlePollMs = Number(process.env.L1_IDLE_POLL_MS_SHORT ?? 15000);
const mediumIdlePollMs = Number(process.env.L1_IDLE_POLL_MS_MEDIUM ?? 60000);
const longIdlePollMs = Number(process.env.L1_IDLE_POLL_MS_LONG ?? 300000);
const staleIdlePollMs = Number(process.env.L1_IDLE_POLL_MS_STALE ?? 900000);
const defaultRefundRecipient = (() => {
  const explicit = process.env.REFUND_RECIPIENT_L2?.trim();
  if (explicit) return getAddress(explicit);
  const refundPk = process.env.RELAYER_L2_PRIVATE_KEY?.trim();
  if (refundPk) return privateKeyToAccount(refundPk as `0x${string}`).address;
  return null;
})();

function computeIdlePollMs(createdAt: number, now: number): number {
  const ageMs = Math.max(0, now - createdAt);
  if (ageMs < 5 * 60_000) return Math.max(pollMs, shortIdlePollMs);
  if (ageMs < 60 * 60_000) return Math.max(pollMs, mediumIdlePollMs);
  if (ageMs < 24 * 60 * 60_000) return Math.max(pollMs, longIdlePollMs);
  return Math.max(pollMs, staleIdlePollMs);
}

function createEvent(trackingId: string, kind: 'ETH' | 'ERC20', amount: bigint, token?: string | null) {
  const now = Date.now();
  const result = db
    .prepare('INSERT INTO deposit_events(trackingId, kind, l1TokenAddress, amount, status, detectedAtL1, attempts, nextAttemptAt, stuck, createdAt) VALUES(?, ?, ?, ?, ?, ?, 0, 0, 0, ?)')
    .run(trackingId, kind, token ?? null, amount.toString(), 'detected_l1', now, now);
  return Number(result.lastInsertRowid);
}

function updateEvent(eventId: number, status: string, fields: Record<string, any> = {}) {
  const keys = Object.keys(fields);
  const set = ['status=?', ...keys.map((k) => `${k}=?`)].join(', ');
  db.prepare(`UPDATE deposit_events SET ${set} WHERE id=?`).run(status, ...keys.map((k) => fields[k]), eventId);
}

function markEventError(eventId: number, err: unknown) {
  const event = db.prepare('SELECT attempts FROM deposit_events WHERE id=?').get(eventId) as any;
  const attempts = Number(event?.attempts ?? 0) + 1;
  const now = Date.now();
  const stuck = attempts >= maxAttempts ? 1 : 0;
  const nextAttemptAt = stuck ? now : computeNextAttemptAt(now, attempts, baseDelaySeconds, maxDelaySeconds);
  db.prepare('UPDATE deposit_events SET status=?, error=?, attempts=?, nextAttemptAt=?, stuck=?, lastErrorAt=? WHERE id=?').run(stuck ? 'stuck' : 'l1_failed', String(err), attempts, nextAttemptAt, stuck, now, eventId);
}

async function withMintRetry<T>(fn: (mint: bigint) => Promise<T>, base: bigint): Promise<T> {
  let mint = base;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn(mint);
    } catch (e) {
      if (i === 2) throw e;
      mint = (mint * 3n) / 2n;
    }
  }
  throw new Error('unreachable');
}

async function processDeposit(row: any) {
  const now = Date.now();
  const idlePollMs = computeIdlePollMs(Number(row.createdAt ?? now), now);
  if (now - Number(row.lastActivityAt ?? 0) < idlePollMs) return;
  if (!tryAcquireInflight(Number(row.inflightL1 ?? 0))) return;

  const lock = db.prepare('UPDATE deposit_requests SET inflightL1=1 WHERE trackingId=? AND inflightL1=0').run(row.trackingId);
  if (lock.changes === 0) return;

  let eventId = 0;
  try {
    const y = getAddress(row.l1DepositAddressY);

    const ethBal = await publicClient.getBalance({ address: y });
    let erc20Candidate: { tokenAddr: `0x${string}`; bal: bigint } | null = null;
    if (ethBal === 0n) {
      const contracts = supportedTokens
        .map((token) => getAddress(token.l1Address))
        .filter((tokenAddr) => tokenAllowlist.has(tokenAddr.toLowerCase()))
        .map((tokenAddr) => ({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [y] as const
        }));
      const results = await publicClient.multicall({ contracts, allowFailure: true });
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status !== 'success' || result.result === 0n) continue;
        erc20Candidate = { tokenAddr: contracts[i]!.address, bal: result.result };
        break;
      }
    }

    if (ethBal === 0n && !erc20Candidate) {
      db.prepare('UPDATE deposit_requests SET lastActivityAt=? WHERE trackingId=?').run(now, row.trackingId);
      return;
    }

    const code = await publicClient.getCode({ address: y });
    let deployTx: `0x${string}` | null = null;
    if (!code || code === '0x') {
      const refundRecipient = process.env.REFUND_RECIPIENT_L2 ?? defaultRefundRecipient ?? row.recipientPrividiumAddress;
      deployTx = await walletClient.writeContract({
        chain: null,
        address: bridgeConfig.l1.forwarderFactory,
        abi: FORWARDER_FACTORY_L1_ABI,
        functionName: 'deploy',
        args: [row.saltY, bridgeConfig.l1.bridgehub, BigInt(bridgeConfig.l2.chainId), row.l2VaultAddressX, refundRecipient, bridgeConfig.l1.assetRouter, bridgeConfig.l1.nativeTokenVault]
      });
      await publicClient.waitForTransactionReceipt({ hash: deployTx });
      db.prepare('UPDATE deposit_requests SET lastActivityAt=? WHERE trackingId=?').run(Date.now(), row.trackingId);
    }

    if (ethBal > 0n) {
      eventId = createEvent(row.trackingId, 'ETH', ethBal);
      if (deployTx) updateEvent(eventId, 'l1_forwarder_deployed', { l1DeployTxHash: deployTx });
      const sweepTx = await withMintRetry((mint) => walletClient.writeContract({ chain: null, address: y, abi: STEALTH_FORWARDER_L1_ABI, functionName: 'sweepETH', args: [], value: mint }), defaultMintEth);
      await publicClient.waitForTransactionReceipt({ hash: sweepTx });
      updateEvent(eventId, 'l1_bridging_submitted', { l1BridgeTxHash: sweepTx });
      db.prepare('UPDATE deposit_requests SET lastActivityAt=? WHERE trackingId=?').run(Date.now(), row.trackingId);
      return;
    }

    if (erc20Candidate) {
      eventId = createEvent(row.trackingId, 'ERC20', erc20Candidate.bal, erc20Candidate.tokenAddr);
      if (deployTx) updateEvent(eventId, 'l1_forwarder_deployed', { l1DeployTxHash: deployTx });
      const sweepTx = await withMintRetry(
        (mint) =>
          walletClient.writeContract({
            chain: null,
            address: y,
            abi: STEALTH_FORWARDER_L1_ABI,
            functionName: 'sweepERC20',
            args: [erc20Candidate.tokenAddr],
            value: mint
          }),
        defaultMintErc20
      );
      await publicClient.waitForTransactionReceipt({ hash: sweepTx });
      updateEvent(eventId, 'l1_bridging_submitted', { l1BridgeTxHash: sweepTx });
      db.prepare('UPDATE deposit_requests SET lastActivityAt=? WHERE trackingId=?').run(Date.now(), row.trackingId);
      return;
    }
  } catch (e) {
    console.log(`Error processing deposit for trackingId ${row.trackingId}:`, e);
    if (eventId) markEventError(eventId, e);
  } finally {
    db.prepare('UPDATE deposit_requests SET inflightL1=0 WHERE trackingId=?').run(row.trackingId);
  }
}

async function tick() {
  const rows = db
    .prepare('SELECT dr.*, COALESCE(dr.recipientPrividiumAddress, a.recipientPrividiumAddress) AS recipientPrividiumAddress FROM deposit_requests dr JOIN aliases a ON a.aliasKey = dr.aliasKey WHERE dr.isActive = 1 ORDER BY dr.lastActivityAt ASC LIMIT 30')
    .all() as any[];
  for (const row of rows) await processDeposit(row);
}

setInterval(() => void tick(), Number(process.env.RELAYER_POLL_MS ?? 7000));
void tick();
