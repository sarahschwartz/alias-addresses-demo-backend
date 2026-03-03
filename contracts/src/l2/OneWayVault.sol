// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract OneWayVault {
    address public immutable recipient;

    constructor(address recipient_) {
        require(recipient_ != address(0), "recipient=0");
        recipient = recipient_;
    }

    receive() external payable {}

    function sweepETH() external {
        uint256 bal = address(this).balance;
        require(bal > 0, "empty");
        (bool ok,) = payable(recipient).call{value: bal}("");
        require(ok, "eth send failed");
    }

    function sweepERC20(address token) external {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "empty");
        require(IERC20(token).transfer(recipient, bal), "transfer failed");
    }
}
