import { createViemClient, createViemSdk } from "@matterlabs/zksync-js/viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";

// fetches bridgehub address for local networks
const account = privateKeyToAccount(
  "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110",
);

const l1ChainId = 31337;
const l1RpcUrl = "http://localhost:8545";
const l2RpcUrl = "http://localhost:3050";

const l1Chain = defineChain({
  id: l1ChainId,
  name: "Local L1",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [l1RpcUrl] },
  },
});

const localPrividium = defineChain({
  id: 6565,
  name: "Local L2",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [l2RpcUrl] } },
});

const l1 = createPublicClient({ transport: http(l1RpcUrl) });
const l2 = createPublicClient({ transport: http(l2RpcUrl) });
const l1Wallet = createWalletClient({
  chain: l1Chain,
  account,
  transport: http(l1RpcUrl),
});
const l2Wallet = createWalletClient({
  chain: localPrividium,
  account,
  transport: http(l2RpcUrl),
});

const client = createViemClient({ l1, l2, l1Wallet, l2Wallet });
const sdk = createViemSdk(client);

const { bridgehub } = await sdk.contracts.addresses();
console.log("bridgehub address: ", bridgehub);
