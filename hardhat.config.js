const { vars } = require("hardhat/config");

require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require('@openzeppelin/hardhat-upgrades');
require("hardhat-contract-sizer");
require("hardhat-gas-reporter");
require("@layerzerolabs/hardhat-deploy");
require("@layerzerolabs/hardhat-tron");


task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
      console.log(account.address);
  }
});

const DEVELOPMENT_KEY = vars.get("DEVELOPMENT_KEY");
const LOCLHOST_KEY = vars.get("LOCHOST_KEY");
const PRODUCT_KEY = vars.get("PRODUCT_KEY");
const TRON_DEVELOPMENT_KEY = vars.get("TRON_DEVELOPMENT_KEY");
const TRE_LOCAL_TRON_DEVELOPMENT_KEY_1 = vars.get("TRE_LOCAL_TRON_DEVELOPMENT_KEY_1");
const TRE_LOCAL_TRON_DEVELOPMENT_KEY_2 = vars.get("TRE_LOCAL_TRON_DEVELOPMENT_KEY_2");

// API Keys and RPC URLs
const ETHERSCAN_API_KEY = vars.get("ETHERSCAN_API_KEY", "");
const BSCSCAN_API_KEY = vars.get("BSCSCAN_API_KEY", "");
const QUICKNODE_BSC_URL = vars.get("QUICKNODE_BSC_URL", "https://bsc-dataseed.binance.org");
const QUICKNODE_BSC_TESTNET_URL = vars.get("QUICKNODE_BSC_TESTNET_URL", "https://data-seed-prebsc-1-s1.binance.org:8545");
const SEPOLIA_RPC_URL = vars.get("SEPOLIA_RPC_URL", "https://ethereum-sepolia.publicnode.com");
const ETH_MAINNET_RPC_URL = vars.get("ETH_MAINNET_RPC_URL", "https://eth.llamarpc.com");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  tronSolc: {
    enable: true,
    filter: [],
    compilers: [{ version: "0.8.24" }], // Tron supports up to 0.8.24
    versionRemapping: [
      ["0.8.28", "0.8.24"],
      ["0.8.27", "0.8.24"],
      ["0.8.26", "0.8.24"],
      ["0.8.25", "0.8.24"],
    ],
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100  // 极低的runs值以最大化部署大小优化
      },
      viaIR: true,
      // metadata: {
      //   bytecodeHash: "none"  // 移除元数据以减少大小
      // }
    }
  },
  sourcify: {
    enabled: true,
  },
  etherscan: {
    apiKey: {
      mainnet: ETHERSCAN_API_KEY,
      sepolia: ETHERSCAN_API_KEY,
      bsc: BSCSCAN_API_KEY,
      bscTestnet: BSCSCAN_API_KEY
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545/",
      chainId: 31337, // 本地开发网络的 chainId
      accounts: [LOCLHOST_KEY,
      ],
      gas: "auto",
      gasPrice: "auto"
    },
    amoy: {
      url: "https://polygon-amoy.gateway.tenderly.co",
      chainId: 80001, // Polygon Amoy 测试网的 chainId
      accounts: [DEVELOPMENT_KEY],
      gas: "auto",
      gasPrice: "auto"
    },
    polygon: {
      url: "https://polygon.llamarpc.com",
      chainId: 137, // Polygon 主网的 chainId
      accounts: [DEVELOPMENT_KEY],
      gas: "auto",
      gasPrice: "auto"
    },
    bsc: {
      url: QUICKNODE_BSC_URL,
      chainId: 56,
      accounts: [PRODUCT_KEY],
      gas: 30000000,
      gasPrice: "auto"
    },
    bscTestnet: {
      url: QUICKNODE_BSC_TESTNET_URL,
      chainId: 97,
      accounts: [DEVELOPMENT_KEY],
      gas: "auto",
      gasPrice: "auto"
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: [DEVELOPMENT_KEY],
      gas: "auto",
      gasPrice: "auto"
    },
    mainnet: {
      url: ETH_MAINNET_RPC_URL,
      chainId: 1,
      accounts: [PRODUCT_KEY],
      gas: "auto",
      gasPrice: "auto"
    },
    // Tron local TRE node (docker tronbox/tre)
    tronLocal: {
      url: "http://127.0.0.1:9090/jsonrpc",  // TRE JSON-RPC endpoint
      accounts: [
        // TRE test accounts (run: curl http://127.0.0.1:9090/admin/accounts)
        TRE_LOCAL_TRON_DEVELOPMENT_KEY_1,
        TRE_LOCAL_TRON_DEVELOPMENT_KEY_2
      ],
      tpiUrl: "http://127.0.0.1:9090", // TRE Tron API endpoint
      tron: true  // Mark this as a Tron network
    },
    // Tron Shasta Testnet
    tronShasta: {
      url: "https://api.shasta.trongrid.io",
      accounts: [TRON_DEVELOPMENT_KEY],
      tpiUrl: "https://api.shasta.trongrid.io",
      tron: true
    },
    // Tron Nile Testnet
    tronNile: {
      url: "https://nile.trongrid.io",
      accounts: [TRON_DEVELOPMENT_KEY],
      tpiUrl: "https://nile.trongrid.io",
      tron: true
    },
    // Tron Mainnet
    tronMainnet: {
      url: "https://api.trongrid.io",
      accounts: [TRON_DEVELOPMENT_KEY],
      tpiUrl: "https://api.trongrid.io",
      tron: true
    }
  },
  gasReporter: {
    enabled: true,
  },
  mocha: {
    timeout: 600000 // 单位：毫秒
  },
  contractSizer: {
    alphaSort: true,    // 按名称排序
    disambiguatePaths: false,
    runOnCompile: true, // 编译时自动显示
    strict: true       // 超限时报错
  },
  namedAccounts: {
    deployer: {
      default: 0, // First account
    },
  }
};