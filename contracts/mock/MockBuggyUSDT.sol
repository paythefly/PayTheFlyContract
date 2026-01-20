// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockBuggyUSDT
 * @notice Simulates TRON USDT bug where transfer/transferFrom return false instead of true
 * @dev This mimics the real TRON USDT contract behavior:
 *      - transfer() declares `returns (bool)` but the function body has no return statement
 *      - In Solidity 0.4.x, this results in returning 0 (false)
 *      - The actual transfer still succeeds, but the return value is incorrect
 *
 * Used for testing SafeERC20Universal library's balance verification approach.
 */
contract MockBuggyUSDT {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Configuration flags for testing different scenarios
    bool public returnFalseOnTransfer = true;
    bool public returnFalseOnApprove = false;
    bool public requireZeroAllowanceFirst = false;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    /**
     * @dev Set whether transfer functions return false (default: true, mimics TRON USDT)
     */
    function setReturnFalseOnTransfer(bool value) external {
        returnFalseOnTransfer = value;
    }

    /**
     * @dev Set whether approve returns false
     */
    function setReturnFalseOnApprove(bool value) external {
        returnFalseOnApprove = value;
    }

    /**
     * @dev Set whether approve requires setting to 0 first (like USDT on Ethereum)
     */
    function setRequireZeroAllowanceFirst(bool value) external {
        requireZeroAllowanceFirst = value;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    /**
     * @dev Transfer tokens - mimics TRON USDT bug by returning false even on success
     * The actual transfer succeeds, but the return value is incorrect.
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        require(to != address(0), "Transfer to zero address");

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);

        // TRON USDT bug: returns false even though transfer succeeded
        return !returnFalseOnTransfer;
    }

    /**
     * @dev TransferFrom - mimics TRON USDT bug by returning false even on success
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        require(to != address(0), "Transfer to zero address");

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;

        emit Transfer(from, to, amount);

        // TRON USDT bug: returns false even though transfer succeeded
        return !returnFalseOnTransfer;
    }

    /**
     * @dev Approve with optional requirement to set to 0 first (like USDT on Ethereum)
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        // USDT-style: require setting to 0 first before setting a new non-zero value
        if (requireZeroAllowanceFirst && amount > 0 && allowance[msg.sender][spender] > 0) {
            revert("Must set allowance to 0 first");
        }

        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);

        return !returnFalseOnApprove;
    }
}
