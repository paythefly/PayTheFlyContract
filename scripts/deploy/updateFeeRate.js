/**
 * Update fee rate on all chains
 *
 * Usage:
 *   NEW_FEE_RATE=20 npx hardhat run scripts/deploy/updateFeeRate.js
 */

const { ethers, ContractFactory } = require("ethers");
const { vars } = require("hardhat/config");
const { TronWeb } = require("tronweb");

const newFeeRate = parseInt(process.env.NEW_FEE_RATE || "20");

const abi = [
    'function setFeeRate(uint256 newFeeRate) external',
    'function feeRate() view returns (uint256)',
    'function owner() view returns (address)'
];

// 链配置
const chains = [
    {
        name: "BSC Mainnet",
        rpc: "https://bsc-dataseed1.binance.org",
        factory: "0xeaADa26c5B9E59ab3BBA1D50fA40813CbB40a65C",
        keyName: "PRODUCT_KEY",
        type: "evm"
    },
    {
        name: "BSC Testnet",
        rpc: "https://data-seed-prebsc-1-s1.binance.org:8545",
        factory: "0x4B48555E9368E9E6e1081f81811dB4d2b269cBc2",
        keyName: "DEVELOPMENT_KEY",
        type: "evm"
    },
    {
        name: "TRON Nile",
        rpc: "https://nile.trongrid.io",
        factory: "TJnbELzQWH7DL7X9qJ3GYctgaPvYSH9wkj",
        keyName: "TRON_DEVELOPMENT_KEY",
        type: "tron"
    }
];

async function updateEVM(chain) {
    console.log(`\n${chain.name}:`);
    console.log("  Factory:", chain.factory);

    const privateKey = vars.get(chain.keyName);
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    const factory = new ethers.Contract(chain.factory, abi, wallet);

    const currentRate = await factory.feeRate();
    console.log("  Current fee rate:", currentRate.toString());

    if (currentRate.toString() === newFeeRate.toString()) {
        console.log("  Already set to", newFeeRate);
        return;
    }

    const gasPrice = (await provider.getFeeData()).gasPrice;
    const tx = await factory.setFeeRate(newFeeRate, { gasPrice });
    console.log("  TX:", tx.hash);

    const receipt = await tx.wait();
    console.log("  Confirmed in block:", receipt.blockNumber);

    const updatedRate = await factory.feeRate();
    console.log("  New fee rate:", updatedRate.toString(), "✓");
}

async function updateTRON(chain) {
    console.log(`\n${chain.name}:`);
    console.log("  Factory:", chain.factory);

    const privateKey = vars.get(chain.keyName);
    const tronWeb = new TronWeb({
        fullHost: chain.rpc,
        privateKey: privateKey
    });

    const factoryAbi = [
        {"inputs":[{"name":"newFeeRate","type":"uint256"}],"name":"setFeeRate","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[],"name":"feeRate","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
    ];

    const factory = await tronWeb.contract(factoryAbi, chain.factory);

    const currentRate = await factory.feeRate().call();
    console.log("  Current fee rate:", currentRate.toString());

    if (currentRate.toString() === newFeeRate.toString()) {
        console.log("  Already set to", newFeeRate);
        return;
    }

    const tx = await factory.setFeeRate(newFeeRate).send({
        feeLimit: 100000000
    });
    console.log("  TX:", tx);

    // Wait for confirmation
    await new Promise(r => setTimeout(r, 5000));

    const updatedRate = await factory.feeRate().call();
    console.log("  New fee rate:", updatedRate.toString(), "✓");
}

async function main() {
    console.log("========================================");
    console.log("Updating Fee Rate to", newFeeRate, `(${newFeeRate / 100}%)`);
    console.log("========================================");

    for (const chain of chains) {
        try {
            if (chain.type === "evm") {
                await updateEVM(chain);
            } else if (chain.type === "tron") {
                await updateTRON(chain);
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }

    console.log("\n========================================");
    console.log("Fee rate update complete!");
    console.log("========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
