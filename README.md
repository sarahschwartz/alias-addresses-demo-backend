# Prividium Addresses Backend

Backend for alias registration and cross-chain deposit relaying.

## What Is In This Repo

- `services/resolver`: HTTP API for alias registration and deposit request/status.
- `services/relayer-l1`: watches L1 deposit addresses and triggers bridging.
- `services/relayer-l2`: watches L2 arrivals and sweeps to recipient.
- `contracts`: deploy/fetch scripts for L1/L2 contract dependencies.
- `services/tools`: bridge config generator.
- `packages/config`, `packages/types`: shared config/types.

## Prerequisites for local setup

- Node.js 20+.
- `pnpm` 10.13.1 (`corepack enable && corepack prepare pnpm@10.13.1 --activate`).
- Local [ZKsync OS servers](https://github.com/matter-labs/zksync-os-server/tree/main/local-chains) running:
  - L1 at `http://localhost:8545`
  - L2 at `http://localhost:3050`

## Install

```bash
pnpm install
```

## Configure Local Environment

1. Copy env template:

```bash
cp .env.example .env
```

2. In `.env`, uncomment local config options and comment out testnet config options.
  Edit other values as needed.

Notes:
- If `L1_ERC20_TOKEN_ADDRESS` is empty, `bootstrap:local` deploys `MockERC20` automatically.
- Optional path overrides (`ENV_FILE`, `SQLITE_PATH`, `BRIDGE_CONFIG_JSON_PATH`) are supported but not required.

## Bootstrap Contracts And Bridge Config (Local)

Run once after env is configured:

```bash
pnpm bootstrap:local
```

This does:

1. Deploy contracts (outputs to `contracts/deployments/31337.json`).
2. Fetch bridge dependencies into deployment JSON.
3. Ensure a supported ERC20 token list (`infra/supported-erc20.json`).
4. Generate bridge config (`infra/bridge-config.json`).

## Run Backend Services

```bash
pnpm dev:backend
```

This starts:

- resolver API
- relayer-l1 worker
- relayer-l2 worker

SQLite data defaults to `services/data/poc.db`.

## End-to-End Local API Walkthrough

Use a second terminal.

1. Health check:

```bash
curl http://localhost:4000/health
```

2. Register alias:

```bash
curl -X POST http://localhost:4000/alias/register \
  -H 'content-type: application/json' \
  -d '{
    "nickname":"alice",
    "suffix":"demo",
    "recipientAddress":"0x1111111111111111111111111111111111111111"
  }'
```

3. Request deposit address:

```bash
curl -X POST http://localhost:4000/deposit/request \
  -H 'content-type: application/json' \
  -d '{"nickname":"alice","suffix":"demo"}'
```

Response includes:
- `trackingId`
- `l1DepositAddress`
- `l2VaultAddress`

4. Send funds to returned `l1DepositAddress` on your local chain (ETH or supported ERC20).

5. Poll deposit status:

```bash
curl http://localhost:4000/deposit/<trackingId>
```

6. List deposits by alias key:

```bash
curl "http://localhost:4000/alias/deposits?aliasKey=<aliasKey-from-alias-register-response>"
```

7. See accepted token metadata:

```bash
curl http://localhost:4000/accepted-tokens
```

## Production Deployment Notes

- Build and run:

```bash
pnpm build:backend
pnpm start:backend
```

- Set strict CORS in `.env`:
  - `CORS_ORIGINS=https://your-frontend.example`
- Keep resolver reachable:
  - `RESOLVER_HOST=0.0.0.0`
- Run with a process manager (systemd/pm2) and persistent disk for SQLite.

## Root Scripts

- `pnpm dev:backend`: run resolver + relayers in watch mode.
- `pnpm build:backend`: build shared packages and runtime services.
- `pnpm start:backend`: run built resolver + relayers.
- `pnpm bootstrap:local`: local deployment + bridge config.
- `pnpm bootstrap:testnet`: testnet deployment + bridge config.
