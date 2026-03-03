// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OneWayVault} from "./OneWayVault.sol";

contract VaultFactory {
    event VaultDeployed(address vault, bytes32 salt, address recipient);

    function computeVaultAddress(bytes32 salt, address recipient) public view returns (address) {
        bytes memory initCode = abi.encodePacked(type(OneWayVault).creationCode, abi.encode(recipient));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)));
        return address(uint160(uint256(hash)));
    }

    function deployVault(bytes32 salt, address recipient) external returns (address vault) {
        bytes memory initCode = abi.encodePacked(type(OneWayVault).creationCode, abi.encode(recipient));
        address predicted = computeVaultAddress(salt, recipient);
        require(predicted.code.length == 0, "already deployed");

        assembly {
            vault := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(vault != address(0), "create2 failed");
        emit VaultDeployed(vault, salt, recipient);
    }
}
