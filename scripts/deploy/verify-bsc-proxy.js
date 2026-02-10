/**
 * Verify BSC Proxy Contract via Sourcify
 */
const { ethers } = require('ethers');

async function main() {
    const implementation = '0x8a3a2A14F593eEf6bC749D841BcFf4480d0a53cd';
    const initData = '0x1794bb3c0000000000000000000000000a6d45cdadbae845f5f85d6ab7c9549ec8b3db23000000000000000000000000831c1b82a8f5d538990759432ea95417f2d19f020000000000000000000000000000000000000000000000000000000000000064';

    // ERC1967Proxy constructor: (address implementation, bytes memory _data)
    const abiCoder = new ethers.AbiCoder();
    const encodedArgs = abiCoder.encode(['address', 'bytes'], [implementation, initData]);

    console.log('=== BSC Proxy 验证信息 ===');
    console.log('');
    console.log('代理合约地址: 0xeaADa26c5B9E59ab3BBA1D50fA40813CbB40a65C');
    console.log('');
    console.log('构造函数参数:');
    console.log('  implementation:', implementation);
    console.log('  _data:', initData);
    console.log('');
    console.log('ABI 编码后的构造函数参数:');
    console.log(encodedArgs);
    console.log('');
    console.log('=== 手动验证步骤 ===');
    console.log('');
    console.log('1. 访问 https://bscscan.com/address/0xeaADa26c5B9E59ab3BBA1D50fA40813CbB40a65C#code');
    console.log('2. 点击 "Verify and Publish"');
    console.log('3. 选择:');
    console.log('   - Compiler Type: Solidity (Single file)');
    console.log('   - Compiler Version: v0.8.28');
    console.log('   - License: MIT');
    console.log('4. 粘贴 ERC1967Proxy 源码');
    console.log('5. 构造函数参数 (ABI-encoded):');
    console.log('   ' + encodedArgs.slice(2));  // 去掉 0x 前缀
}

main().catch(console.error);
