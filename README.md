# Prividium Addresses Backend

This repo is trimmed to backend-only workflows.

## Supported root scripts

- `pnpm bootstrap:local`
- `pnpm bootstrap:testnet`
- `pnpm dev:backend`

## Included packages

- `contracts`
- `services/resolver`
- `services/relayer-l1`
- `services/relayer-l2`
- `services/tools`
- `packages/config`
- `packages/types`

## Usage

1. Configure `.env` for your target network.
2. Run `pnpm bootstrap:local` or `pnpm bootstrap:testnet`.
3. Run `pnpm dev:backend`.
