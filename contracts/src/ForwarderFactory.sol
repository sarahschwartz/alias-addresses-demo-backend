// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StealthForwarder} from "./StealthForwarder.sol";

contract ForwarderFactory {
    event Deployed(address indexed deployed, bytes32 indexed salt, address indexed recipient, address adapter);

    function computeAddress(bytes32 salt, bytes memory initCode) public view returns (address) {
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)));
        return address(uint160(uint256(hash)));
    }

    function deploy(bytes32 salt, address recipient, address adapter) external returns (address deployed) {
        bytes memory initCode = abi.encodePacked(type(StealthForwarder).creationCode, abi.encode(recipient, adapter));
        address predicted = computeAddress(salt, initCode);
        require(predicted.code.length == 0, "already deployed");

        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed != address(0), "create2 failed");
        emit Deployed(deployed, salt, recipient, adapter);
    }
}
