// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StealthForwarderL1} from "./StealthForwarderL1.sol";

contract ForwarderFactoryL1 {
    event Deployed(address deployed, bytes32 salt, address xDestination);

    function _initCode(
        address bridgehub,
        uint256 l2ChainId,
        address xDestination,
        address refundRecipient,
        address assetRouter,
        address nativeTokenVault
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            type(StealthForwarderL1).creationCode,
            abi.encode(bridgehub, l2ChainId, xDestination, refundRecipient, assetRouter, nativeTokenVault)
        );
    }

    function computeAddress(
        bytes32 salt,
        address bridgehub,
        uint256 l2ChainId,
        address xDestination,
        address refundRecipient,
        address assetRouter,
        address nativeTokenVault
    ) external view returns (address) {
        bytes memory initCode = _initCode(bridgehub, l2ChainId, xDestination, refundRecipient, assetRouter, nativeTokenVault);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)));
        return address(uint160(uint256(hash)));
    }

    function deploy(
        bytes32 salt,
        address bridgehub,
        uint256 l2ChainId,
        address xDestination,
        address refundRecipient,
        address assetRouter,
        address nativeTokenVault
    ) external returns (address deployed) {
        bytes memory initCode = _initCode(bridgehub, l2ChainId, xDestination, refundRecipient, assetRouter, nativeTokenVault);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)));
        address predicted = address(uint160(uint256(hash)));
        require(predicted.code.length == 0, "already deployed");

        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        require(deployed != address(0), "create2 failed");
        emit Deployed(deployed, salt, xDestination);
    }
}
