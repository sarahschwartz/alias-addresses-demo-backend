// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBridgehub {
    struct L2TransactionRequestTwoBridgesOuter {
        uint256 chainId;
        uint256 mintValue;
        uint256 l2Value;
        uint256 l2GasLimit;
        uint256 l2GasPerPubdataByteLimit;
        address refundRecipient;
        address secondBridgeAddress;
        uint256 secondBridgeValue;
        bytes secondBridgeCalldata;
    }
    struct L2TransactionRequestDirect {
        uint256 chainId; // This will be our L2 chain id
        uint256 mintValue; // how many tokens should be "created" on L2 chain (see explanations below)
        address l2Contract; // L2 contract -- this will be our new account
        uint256 l2Value; // how much value should we pass it it (see explanations below)
        bytes l2Calldata; // Calldata will be 0x (as we're just passing value)
        uint256 l2GasLimit; // gas limit for this call
        uint256 l2GasPerPubdataByteLimit; // This is zksync specific
        bytes[] factoryDeps; // Empty for now - this would be needed if we wanted to deploy some contract
        address refundRecipient; // Where should "rest" of the tokens go.
    }

    function requestL2TransactionDirect(
        L2TransactionRequestDirect calldata request
    ) external payable returns (bytes32);

    function requestL2TransactionTwoBridges(
        L2TransactionRequestTwoBridgesOuter calldata request
    ) external payable returns (bytes32);
}

interface NativeTokenVault {
    function assetId(address l1Token) external view returns (bytes32);
}

contract StealthForwarderL1 {
    address public immutable bridgehub;
    uint256 public immutable l2ChainId;
    address public immutable xDestination;
    address public immutable refundRecipient;
    address public immutable assetRouter;
    address public immutable nativeTokenVault;

    event SweptETH(
        address indexed xDestination,
        uint256 amount,
        bytes32 canonicalTxHash
    );
    event SweptERC20(
        address indexed l1Token,
        uint256 amount,
        address indexed xDestination,
        bytes32 canonicalTxHash
    );

    constructor(
        address bridgehub_,
        uint256 l2ChainId_,
        address xDestination_,
        address refundRecipient_,
        address assetRouter_,
        address nativeTokenVault_
    ) {
        require(bridgehub_ != address(0), "bridgehub=0");
        require(xDestination_ != address(0), "x=0");
        require(refundRecipient_ != address(0), "refund=0");
        require(assetRouter_ != address(0), "assetRouter=0");
        require(nativeTokenVault_ != address(0), "nativeTokenVault=0");
        bridgehub = bridgehub_;
        l2ChainId = l2ChainId_;
        xDestination = xDestination_;
        refundRecipient = refundRecipient_;
        assetRouter = assetRouter_;
        nativeTokenVault = nativeTokenVault_;
    }

    receive() external payable {}

    function _isL2Execution() internal view returns (bool) {
        return block.chainid == l2ChainId;
    }

    function sweepETH() external payable {
        uint256 bal = address(this).balance;
        require(bal > 0, "empty");

        if (_isL2Execution()) {
            (bool ok, ) = payable(xDestination).call{value: bal}("");
            require(ok, "eth transfer failed");
            emit SweptETH(xDestination, bal, bytes32(0));
            return;
        }

        bytes[] memory deps = new bytes[](0);
        bytes32 txHash = IBridgehub(bridgehub).requestL2TransactionDirect{
            value: bal
        }(
            IBridgehub.L2TransactionRequestDirect({
                chainId: l2ChainId,
                mintValue: bal,
                // Self-deposit only: sender on L1 must equal recipient on L2.
                l2Contract: address(this),
                l2Value: bal - msg.value,
                l2Calldata: "",
                l2GasLimit: 200000,
                l2GasPerPubdataByteLimit: 800,
                factoryDeps: deps,
                refundRecipient: refundRecipient
            })
        );

        emit SweptETH(address(this), bal - msg.value, txHash);
    }

    function sweepERC20(address l1Token) external payable {
        // Amount should be the full token balance.
        uint256 amount = IERC20(l1Token).balanceOf(address(this));
        require(amount > 0, "empty");

        if (_isL2Execution()) {
            require(IERC20(l1Token).transfer(xDestination, amount), "transfer failed");
            emit SweptERC20(l1Token, amount, xDestination, bytes32(0));
            return;
        }

        bytes32 tokenAssetId = NativeTokenVault(nativeTokenVault).assetId(
            l1Token
        );
        // Make sure it is not zero
        require(tokenAssetId != bytes32(0), "Token not registered");

        require(
            IERC20(l1Token).approve(nativeTokenVault, amount),
            "approve failed"
        );

        // Self-deposit only: sender on L1 must equal recipient on L2.
        bytes memory depositData = abi.encode(amount, address(this), address(0));
        bytes memory encoded = abi.encode(tokenAssetId, depositData);
        bytes memory bridgeCalldata = bytes.concat(hex"01", encoded);

        IBridgehub.L2TransactionRequestTwoBridgesOuter memory req = IBridgehub
            .L2TransactionRequestTwoBridgesOuter({
                chainId: l2ChainId,
                mintValue: msg.value,
                l2Value: 0,
                l2GasLimit: 2_000_000, // TODO: first deployment vs repeated.
                l2GasPerPubdataByteLimit: 800,
                refundRecipient: refundRecipient,
                secondBridgeAddress: assetRouter,
                secondBridgeValue: 0,
                secondBridgeCalldata: bridgeCalldata
            });

        bytes32 txHash = IBridgehub(bridgehub).requestL2TransactionTwoBridges{
            value: msg.value
        }(req);
        IERC20(l1Token).approve(nativeTokenVault, 0);
        emit SweptERC20(l1Token, amount, address(this), txHash);
    }
}
