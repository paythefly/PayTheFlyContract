# Bytecode Structure Explanation

## Creation Bytecode vs Runtime Bytecode

### 1. Creation Bytecode (部署时的完整字节码)

```
Creation Bytecode = Constructor Code + Constructor Args + Runtime Bytecode
                    ^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^
                    构造函数逻辑        构造函数参数         运行时代码
```

#### Example: BeaconProxy Deployment

```solidity
constructor(address beacon, bytes memory data) payable {
    _upgradeBeaconToAndCall(beacon, data);
}
```

**Deployed Contract A:**
```
Creation Bytecode =
  [Constructor Code: 0x608060405234801561001057...]  // 构造函数逻辑（固定）
  +
  [Constructor Args: 0x00000000000000000000000041f8D4AB...  // beacon地址（不同）
                     000000000000000000000000000000...  // data长度
                     db0ed6a0000000000000...]           // initialize data（不同）
  +
  [Runtime Bytecode: 0x608060405260043610...（省略）]    // 运行时代码（固定）
```

**Deployed Contract B:**
```
Creation Bytecode =
  [Constructor Code: 相同]
  +
  [Constructor Args: 不同的 projectId, name, admin...]  ← 这里不同！
  +
  [Runtime Bytecode: 相同]
```

### 2. Runtime Bytecode (部署后链上存储的代码)

部署完成后，链上**只保留 Runtime Bytecode**：

```
链上存储: Runtime Bytecode only
├── 所有逻辑函数
├── fallback/receive
├── 状态变量布局
└── metadata hash
```

**所有 BeaconProxy 实例的 Runtime Bytecode 完全相同**，因为：
- 代理逻辑相同
- 都委托调用到同一个 Beacon
- 状态变量布局相同

## Why Creation Bytecode Differs

### BeaconProxy Constructor Parameters

```solidity
// Contract 1
new BeaconProxy(
    0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC,  // beacon
    abi.encodeCall(
        PayTheFlyPro.initialize,
        ("c590139a...", "UPB-BSC-PROD-01", 0x831C..., 0x831C..., 0x831C...)
    )
);

// Contract 2
new BeaconProxy(
    0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC,  // beacon (相同)
    abi.encodeCall(
        PayTheFlyPro.initialize,
        ("a15e0b33...", "no390", 0x571d..., 0x571d..., 0x571d...)  // 不同！
    )
);
```

### ABI Encoding Differences

```javascript
// Contract 1 的构造参数编码
const args1 = ethers.AbiCoder.defaultAbiCoder().encode(
  ['address', 'bytes'],
  [
    '0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC',
    '0xdb0ed6a0...c590139a...UPB-BSC-PROD-01...'  // projectId="c590139a", name="UPB-BSC-PROD-01"
  ]
);

// Contract 2 的构造参数编码
const args2 = ethers.AbiCoder.defaultAbiCoder().encode(
  ['address', 'bytes'],
  [
    '0x41f8D4AB1f4F9062a531ABB66333E41C0BD2f0cC',
    '0xdb0ed6a0...a15e0b33...no390...'           // projectId="a15e0b33", name="no390"
  ]
);

// args1 !== args2 → Creation Bytecode 不同
```

## Verification Process

### What Sourcify Verifies

```
Sourcify 验证流程:
1. 获取链上的 Runtime Bytecode
2. 用提供的源码编译，得到编译后的 Runtime Bytecode
3. 比对两者是否匹配

✅ Runtime Match = 合约逻辑完全一致
❌ Creation Match = 构造参数不同（预期行为）
```

### What BscScan Needs

```
BscScan 验证需要:
1. 源代码文件
2. 编译器版本和设置
3. 构造函数参数（精确值）
4. 库地址（如果有）

Only then can BscScan:
- 显示源代码
- 显示构造参数
- 提供 Read/Write Contract 功能
- 标记绿色验证勾号
```

## Why It Matters for BeaconProxy

### Factory Pattern Characteristics

```
Factory creates 100 projects:
├── Project 1: Creation Bytecode = [Constructor Code] + [Args1] + [Runtime]
├── Project 2: Creation Bytecode = [Constructor Code] + [Args2] + [Runtime]
├── Project 3: Creation Bytecode = [Constructor Code] + [Args3] + [Runtime]
...
└── Project 100: Creation Bytecode = [Constructor Code] + [Args100] + [Runtime]

Runtime Bytecode: 100% 相同
Creation Bytecode: 100% 不同（因为 Args 不同）
```

### Verification Strategy

**Option 1: Sourcify (Free)**
- ✅ Verifies Runtime Bytecode
- ✅ One-time source upload
- ✅ All instances automatically verified
- ⚠️  Warning: "Constructor may differ"
- 🔗 View on Sourcify

**Option 2: BscScan with Paid API (Automated)**
- ✅ Verifies complete contract
- ✅ Shows constructor args
- ✅ Green checkmark on BscScan
- 💰 Requires paid API ($49/month)
- 🤖 Scriptable

**Option 3: BscScan Manual (Free but tedious)**
- ✅ Verifies complete contract
- ❌ Each contract needs individual verification
- ⏱️  5-10 minutes per contract
- 🔗 Shows on BscScan

## Technical Details

### Metadata Hash in Bytecode

```solidity
// Compiled bytecode ends with metadata
Runtime Bytecode = [contract code] + [metadata]

Metadata includes:
{
  "compiler": {
    "version": "0.8.28+commit.7893614e"
  },
  "sources": {
    "BeaconProxy.sol": {
      "keccak256": "0x...",
      "urls": ["bzzr://..."]
    }
  },
  "settings": {
    "optimizer": { "enabled": true, "runs": 100 },
    "viaIR": true
  }
}

Metadata Hash = keccak256(JSON.stringify(metadata))
```

### Why Exact Compiler Settings Matter

```
Same source code, different settings:

Compiler v0.8.28, optimizer=true, runs=100:
→ Runtime Bytecode = 0x6080604052...a264697066735822

Compiler v0.8.28, optimizer=true, runs=200:
→ Runtime Bytecode = 0x6080604052...b375788967  ← Different!

Compiler v0.8.28, optimizer=false:
→ Runtime Bytecode = 0x6080604052...c486899078  ← Very different!
```

## Conclusion

### Why Runtime Match ≠ Auto Verification

1. **Bytecode alone doesn't provide source code**
2. **Explorer needs to display Solidity, not hex**
3. **Constructor args need to be decoded**
4. **Metadata must be indexed**

### Why Creation Bytecode Differs

1. **Constructor arguments are part of creation bytecode**
2. **Each proxy instance has unique initialization data**
3. **projectId, name, admin, signer are different**
4. **This is expected and normal for factory-created contracts**

### Security Implications

✅ **Runtime bytecode match = Safe**
- All business logic is identical
- Proxy behavior is identical
- Delegation mechanism is identical
- Auditable on Sourcify

⚠️ **Creation bytecode mismatch = Normal**
- Only affects constructor display
- Constructor runs once during deployment
- Does not affect runtime behavior
- Each project has different initialization params

---

**Bottom Line**: For BeaconProxy contracts created by a factory, Runtime Bytecode match is the correct and expected verification status. Creation Bytecode will always differ due to unique constructor arguments for each project.
