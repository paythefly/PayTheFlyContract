/**
 * TronEthersAdapter - Makes TronWeb compatible with Ethers.js interface
 *
 * This adapter wraps TronWeb to provide an Ethers.js-like API,
 * allowing unified contract deployment and interaction code.
 */

const { TronWeb } = require("tronweb");

/**
 * Adapter class that mimics ethers.ContractFactory
 */
class TronContractFactory {
  constructor(abi, bytecode, signer) {
    this.abi = abi;
    this.bytecode = bytecode;
    this.signer = signer;
    this.tronWeb = signer.tronWeb;
  }

  /**
   * Deploy contract - compatible with ethers.ContractFactory.deploy()
   */
  async deploy(...args) {
    // Extract deploy options if last arg is an object with value/gasLimit
    let deployOptions = {};
    let constructorArgs = [...args];

    if (args.length > 0 && typeof args[args.length - 1] === "object") {
      const lastArg = args[args.length - 1];
      if (lastArg.value !== undefined || lastArg.gasLimit !== undefined) {
        deployOptions = constructorArgs.pop();
      }
    }

    // Convert value from wei/ether format to sun
    let callValue = 0;
    if (deployOptions.value) {
      // Handle BigInt or string
      const valueStr = deployOptions.value.toString();
      // Assume value is in sun for Tron
      callValue = parseInt(valueStr);
    }

    // Deploy using TronWeb
    const contract = await this.tronWeb.contract().new({
      abi: this.abi,
      bytecode: this.bytecode,
      feeLimit: deployOptions.gasLimit || 1000000000,
      callValue: callValue,
      parameters: constructorArgs
    });

    // Return a contract instance that mimics ethers.Contract
    return new TronContract(contract, this.abi, this.tronWeb);
  }
}

/**
 * Adapter class that mimics ethers.Contract
 */
class TronContract {
  constructor(tronContract, abi, tronWeb) {
    this._tronContract = tronContract;
    this._abi = abi;
    this._tronWeb = tronWeb;
    this._address = tronContract.address;

    // Create method proxies for each function in ABI
    this._setupMethods();
  }

  _setupMethods() {
    for (const item of this._abi) {
      if (item.type === "function") {
        this[item.name] = this._createMethod(item);
      }
    }
  }

  _createMethod(abiItem) {
    const self = this;
    return async function (...args) {
      const method = self._tronContract.methods[abiItem.name](...args);

      if (
        abiItem.stateMutability === "view" ||
        abiItem.stateMutability === "pure"
      ) {
        // Read-only call
        return await method.call();
      } else {
        // Transaction
        return await method.send({
          feeLimit: 100000000
        });
      }
    };
  }

  /**
   * Get deployed address - compatible with ethers.Contract.getAddress()
   */
  async getAddress() {
    return TronWeb.address.fromHex(this._address);
  }

  /**
   * Get hex address
   */
  getHexAddress() {
    return this._address;
  }

  /**
   * Wait for deployment - no-op for Tron (already confirmed)
   */
  async waitForDeployment() {
    return this;
  }

  /**
   * Get deployment transaction - mock for compatibility
   */
  deploymentTransaction() {
    return {
      hash: this._address // Use address as placeholder
    };
  }
}

/**
 * Adapter class that mimics ethers.Signer
 */
class TronSigner {
  constructor(tronWeb) {
    this.tronWeb = tronWeb;
    this.address = tronWeb.defaultAddress.hex;
  }

  async getAddress() {
    return TronWeb.address.fromHex(this.address);
  }

  async getBalance() {
    const balance = await this.tronWeb.trx.getBalance(this.address);
    return BigInt(balance);
  }
}

/**
 * Adapter class that mimics ethers.Provider
 */
class TronProvider {
  constructor(tronWeb) {
    this.tronWeb = tronWeb;
  }

  async getBalance(address) {
    let hexAddress = address;
    if (address.startsWith("T")) {
      hexAddress = TronWeb.address.toHex(address);
    }
    const balance = await this.tronWeb.trx.getBalance(hexAddress);
    return BigInt(balance);
  }

  async getBlockNumber() {
    const block = await this.tronWeb.trx.getCurrentBlock();
    return block.block_header.raw_data.number;
  }
}

/**
 * Create Ethers-compatible objects from Tron network config
 */
function createTronEthersAdapter(networkConfig) {
  // Handle 0x prefix
  let privateKey = networkConfig.privateKey || networkConfig.accounts?.[0];
  if (privateKey && privateKey.startsWith("0x")) {
    privateKey = privateKey.slice(2);
  }

  const tronWeb = new TronWeb({
    fullHost: networkConfig.fullHost || networkConfig.tpiUrl,
    privateKey: privateKey,
    headers: networkConfig.headers || networkConfig.httpHeaders || {}
  });

  const provider = new TronProvider(tronWeb);
  const signer = new TronSigner(tronWeb);

  return {
    provider,
    signer,
    tronWeb,

    /**
     * Get contract factory - compatible with ethers.getContractFactory()
     */
    getContractFactory: (abi, bytecode) => {
      return new TronContractFactory(abi, bytecode, signer);
    },

    /**
     * Parse units - convert to sun (1 TRX = 1,000,000 sun)
     */
    parseEther: (value) => {
      return BigInt(Math.floor(parseFloat(value) * 1000000));
    },

    /**
     * Format units - convert from sun to TRX
     */
    formatEther: (value) => {
      return (Number(value) / 1000000).toString();
    }
  };
}

module.exports = {
  TronContractFactory,
  TronContract,
  TronSigner,
  TronProvider,
  createTronEthersAdapter
};
