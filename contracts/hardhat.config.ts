import { config as dotenvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';
import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';

if (process.env.ENV_FILE) {
  dotenvConfig({ path: process.env.ENV_FILE, override: true });
} else {
  dotenvConfig({ path: '../.env' });
}

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  paths: {
    sources: './src',
    tests: './test'
  },
  networks: {
    localhost: {
      url: process.env.L1_RPC_URL ?? 'http://127.0.0.1:8545',
      accounts: process.env.RELAYER_L1_PRIVATE_KEY ? [process.env.RELAYER_L1_PRIVATE_KEY] : []
    },
    sepolia: {
      url: process.env.L1_RPC_URL ?? '',
      accounts: process.env.RELAYER_L1_PRIVATE_KEY ? [process.env.RELAYER_L1_PRIVATE_KEY] : []
    }
  }
};

export default config;
