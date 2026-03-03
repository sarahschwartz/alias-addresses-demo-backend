// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBridgeAdapter {
    function bridgeNative(address recipient, bytes calldata metadata) external payable;
}

contract StealthForwarder {
    address public immutable recipient;
    address public immutable adapter;

    event SweptNative(address indexed recipient, address indexed adapter, uint256 amount);

    constructor(address recipient_, address adapter_) {
        require(recipient_ != address(0), "recipient=0");
        require(adapter_ != address(0), "adapter=0");
        recipient = recipient_;
        adapter = adapter_;
    }

    receive() external payable {}

    function sweepNative(bytes calldata metadata) external {
        uint256 balance = address(this).balance;
        require(balance > 0, "empty");
        IBridgeAdapter(adapter).bridgeNative{value: balance}(recipient, metadata);
        emit SweptNative(recipient, adapter, balance);
    }
}
