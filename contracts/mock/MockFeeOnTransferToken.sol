// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockFeeOnTransferToken
 * @notice Simulates a fee-on-transfer token for testing
 * @dev Deducts a fee from every transfer, so received amount < sent amount
 */
contract MockFeeOnTransferToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    uint256 public feePercent = 1; // 1% fee

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

    function setFeePercent(uint256 fee) external {
        require(fee <= 50, "Fee too high");
        feePercent = fee;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        require(to != address(0), "Transfer to zero address");

        uint256 fee = (amount * feePercent) / 100;
        uint256 received = amount - fee;

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += received;
        // Fee is burned/lost
        totalSupply -= fee;

        emit Transfer(msg.sender, to, received);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        require(to != address(0), "Transfer to zero address");

        uint256 fee = (amount * feePercent) / 100;
        uint256 received = amount - fee;

        balanceOf[from] -= amount;
        balanceOf[to] += received;
        allowance[from][msg.sender] -= amount;
        totalSupply -= fee;

        emit Transfer(from, to, received);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}
