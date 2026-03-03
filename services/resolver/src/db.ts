import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function ensureColumn(db: Database.Database, table: string, columnDef: string, columnName: string) {
  if (!hasColumn(db, table, columnName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

export function openDb(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
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

    CREATE TABLE IF NOT EXISTS token_registry_cache (
      l1TokenAddress TEXT PRIMARY KEY,
      tokenAssetId TEXT NOT NULL,
      registeredAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deposit_requests_alias_created ON deposit_requests(aliasKey, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_deposit_events_tracking_created ON deposit_events(trackingId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_deposit_events_status ON deposit_events(status);
  `);

  // Migration support from old schema
  ensureColumn(db, 'deposit_requests', 'createdAt INTEGER', 'createdAt');
  ensureColumn(db, 'deposit_requests', 'lastActivityAt INTEGER DEFAULT 0', 'lastActivityAt');
  ensureColumn(db, 'deposit_requests', 'inflightL1 INTEGER DEFAULT 0', 'inflightL1');
  ensureColumn(db, 'deposit_requests', 'inflightL2 INTEGER DEFAULT 0', 'inflightL2');
  ensureColumn(db, 'deposit_requests', 'isActive INTEGER DEFAULT 1', 'isActive');
  ensureColumn(db, 'deposit_requests', 'recipientPrividiumAddress TEXT', 'recipientPrividiumAddress');

  if (hasColumn(db, 'deposit_requests', 'issuedAt')) {
    db.exec(`UPDATE deposit_requests SET createdAt = COALESCE(createdAt, issuedAt, strftime('%s','now')*1000)`);
  } else {
    db.exec(`UPDATE deposit_requests SET createdAt = COALESCE(createdAt, strftime('%s','now')*1000)`);
  }
  db.exec(`UPDATE deposit_requests SET lastActivityAt = COALESCE(lastActivityAt, createdAt)`);
  db.exec(`
    UPDATE deposit_requests
    SET recipientPrividiumAddress = COALESCE(
      recipientPrividiumAddress,
      (SELECT a.recipientPrividiumAddress FROM aliases a WHERE a.aliasKey = deposit_requests.aliasKey)
    )
  `);

  ensureColumn(db, 'deposit_events', 'l2DeployForwarderTxHash TEXT', 'l2DeployForwarderTxHash');
  ensureColumn(db, 'deposit_events', 'l2SweepYtoXTxHash TEXT', 'l2SweepYtoXTxHash');
  ensureColumn(db, 'deposit_events', 'l2DeployVaultTxHash TEXT', 'l2DeployVaultTxHash');
  ensureColumn(db, 'deposit_events', 'l2SweepXtoRTxHash TEXT', 'l2SweepXtoRTxHash');

  ensureColumn(db, 'deposit_events', 'attempts INTEGER DEFAULT 0', 'attempts');
  ensureColumn(db, 'deposit_events', 'nextAttemptAt INTEGER DEFAULT 0', 'nextAttemptAt');
  ensureColumn(db, 'deposit_events', 'stuck INTEGER DEFAULT 0', 'stuck');
  ensureColumn(db, 'deposit_events', 'lastErrorAt INTEGER', 'lastErrorAt');

  return db;
}
