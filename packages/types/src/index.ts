import { concatHex, encodeAbiParameters, getAddress, keccak256, parseAbi, toHex } from 'viem';

export const depositStatus = [
  'detected_l1',
  'l1_forwarder_deployed',
  'l1_bridging_submitted',
  'l2_arrived',
  'l2_forwarder_deployed',
  'l2_swept_y_to_x',
  'l2_vault_deployed',
  'l2_swept_to_R',
  'credited',
  'failed'
] as const;
export type DepositStatus = (typeof depositStatus)[number];

export interface DepositRequestRow {
  trackingId: string;
  aliasKey: string;
  recipientPrividiumAddress?: string;
  l1DepositAddressY: string;
  l2VaultAddressX: string;
  saltY: string;
  saltX: string;
  createdAt: number;
  lastActivityAt: number;
  inflightL1: number;
  inflightL2: number;
  isActive: number;
}

export const FORWARDER_FACTORY_L1_ABI = parseAbi([
  'function computeAddress(bytes32,address,uint256,address,address,address,address) view returns (address)',
  'function deploy(bytes32,address,uint256,address,address,address,address) returns (address)'
]);

export const VAULT_FACTORY_ABI = parseAbi([
  'function computeVaultAddress(bytes32,address) view returns (address)',
  'function deployVault(bytes32,address) returns (address)'
]);

export const STEALTH_FORWARDER_L1_ABI = parseAbi([
  'function sweepETH() payable',
  'function sweepERC20(address l1Token) payable'
]);

export const ONE_WAY_VAULT_ABI = parseAbi(['function sweepETH()', 'function sweepERC20(address token)']);

export function normalizeAlias(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeEmail(input: string): string {
  return normalizeAlias(input);
}

export function parseEmailAndSuffix(emailInput: string, suffixInput?: string): { normalizedEmail: string; suffix: string } {
  const trimmed = emailInput.trim();
  let base = trimmed;
  let inferredSuffix = '';
  const hashIdx = trimmed.lastIndexOf('#');
  if (hashIdx > -1) {
    base = trimmed.slice(0, hashIdx);
    inferredSuffix = trimmed.slice(hashIdx + 1);
  }
  return { normalizedEmail: normalizeAlias(base), suffix: (suffixInput ?? inferredSuffix ?? '').trim().toLowerCase() };
}

export function aliasKeyFromParts(normalizedEmail: string, suffix: string): `0x${string}` {
  return keccak256(toHex(`${normalizedEmail}#${suffix}`));
}

export function computeSalt(aliasKey: `0x${string}`, requestNonce: `0x${string}`, suffix: 'X' | 'Y'): `0x${string}` {
  return keccak256(concatHex([aliasKey, requestNonce, toHex(suffix)]));
}

export function buildForwarderL1InitCode(
  creationCode: string,
  bridgehub: string,
  l2ChainId: bigint,
  xDestination: string,
  refundRecipient: string,
  assetRouter: string,
  nativeTokenVault: string
): `0x${string}` {
  return concatHex([
    creationCode as `0x${string}`,
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' }
      ],
      [
        getAddress(bridgehub),
        l2ChainId,
        getAddress(xDestination),
        getAddress(refundRecipient),
        getAddress(assetRouter),
        getAddress(nativeTokenVault)
      ]
    )
  ]);
}
