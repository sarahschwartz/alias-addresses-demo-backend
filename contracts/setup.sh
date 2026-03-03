#!/usr/bin/env bash
set -euo pipefail

L1_NETWORK="${CONTRACTS_L1_NETWORK:-sepolia}"

pnpm --filter contracts build
CONTRACTS_L1_NETWORK="${L1_NETWORK}" pnpm --filter contracts run deploy
CONTRACTS_L1_NETWORK="${L1_NETWORK}" pnpm --filter contracts run fetch-bridge-deps
CONTRACTS_L1_NETWORK="${L1_NETWORK}" pnpm --filter contracts run ensure-token
pnpm --filter tools run fetch-bridge-config
