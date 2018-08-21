const util = require("util");
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN;
const t = require('truffle-test-utils')
t.init()
const expectThrow = require("../helpers/expectThrow");
const {addresses, keys} = require("./keys.js");
const {createTransaction, parseTransactionIndex} = require("./createTransaction");
const {createBlock, createMerkleTree} = require("./createBlock");
const testUtils = require('./utils');
const deploy = require("./deploy");

const increaseTime = async function(addSeconds) {
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [addSeconds], id: 0})
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 1})
}



const {
    TxTypeFund, 
    TxTypeMerge, 
    TxTypeSplit} = require("../lib/Tx/RLPtx.js");

contract('PlasmaParent buyout procedure', async (accounts) => {

    const operatorAddress = accounts[0];
    const operatorKey = keys[0];

    let queue;
    let plasma;
    let storage;
    let challenger;
    let exitProcessor;
    let limboExitGame;
    let firstHash;

    const operator = accounts[0];

    const alice    = addresses[2];
    const aliceKey = keys[2];
    const bob      = addresses[3];
    const bobKey = keys[3];
    
    beforeEach(async () => {
        const result = await deploy(operator, operatorAddress);
        ({plasma, firstHash, challenger, limboExitGame, exitProcessor, queue, storage} = result);
    })

    it('Simulate exit procedure for deposit transactions', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        
        // do deposits

        await plasma.deposit({from: alice, value: "100"})
        let totalDeposited = await plasma.totalAmountDeposited();
        assert(totalDeposited.toString(10) === "100");
        let depositRecordAlice = await plasma.depositRecords(0);
        assert(depositRecordAlice[0] == alice);
        assert(depositRecordAlice[1].toString(10) === "1");
        assert(depositRecordAlice[3].toString(10) === "100");

        await plasma.deposit({from: bob, value: "200"})
        totalDeposited = await plasma.totalAmountDeposited();
        assert(totalDeposited.toString(10) === "300");
        let depositRecordBob = await plasma.depositRecords(1);
        assert(depositRecordBob[0] == bob);
        assert(depositRecordBob[1].toString(10) === "1");
        assert(depositRecordBob[3].toString(10) === "200");

        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        const reencodedTXAlice = tx.serialize();
        const proofAlice = block.merkleTree.getProof(0, true);
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");

        let newHash = await plasma.hashOfLastSubmittedBlock();
        tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 200,
                to: bob
            }],
                operatorKey
        )

        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        const reencodedTXBob = tx.serialize();
        const proofBob = block.merkleTree.getProof(0, true);

        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // than we spend an output, but now Bob signs instead of Alice

        newHash = await plasma.hashOfLastSubmittedBlock();
        const tx2 = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        const tx3 = createTransaction(TxTypeSplit, 1, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(3, 2, newHash, [tx2, tx3],  operatorKey)
        const reencodedTX2 = tx2.serialize();
        const proof2 = Buffer.concat(block.merkleTree.getProof(0, true));

        const reencodedTX3 = tx3.serialize();
        const proof3 = Buffer.concat(block.merkleTree.getProof(1, true));

        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        bl = await storage.blocks(3);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));                            
        // const balanceBefore = await web3.eth.getBalance(operator);
        // submissionReceipt = await challenger.proveDoubleSpend(
        //     3, 0, ethUtil.bufferToHex(reencodedTX2), ethUtil.bufferToHex(proof2),
        //     3, 0, ethUtil.bufferToHex(reencodedTX3), ethUtil.bufferToHex(proof3));
        // const plasmaIsStopped = await plasma.plasmaErrorFound();
        // assert(plasmaIsStopped);
        // const balanceAfter = await web3.eth.getBalance(operator);

        // assert(balanceAfter.sub(balanceBefore).gt(new web3.BigNumber("4900000000000000000"))); // we receive only half of the collateral

        // now we should be able to exit
        submissionReceipt = await exitProcessor.startExit(2, 0, ethUtil.bufferToHex(reencodedTXBob), ethUtil.bufferToHex(proofBob), {from: bob, value: withdrawCollateral})
        let withdrawIndexBob = submissionReceipt.logs[1].args._index;
        let withdrawRecordBob = await plasma.publishedUTXOs(withdrawIndexBob);
        assert(withdrawRecordBob[9].toString(10) === "200");
        assert(withdrawRecordBob[7] === bob);

        submissionReceipt = await exitProcessor.startExit(1, 0, ethUtil.bufferToHex(reencodedTXAlice), ethUtil.bufferToHex(proofAlice), {from: alice, value: withdrawCollateral})
        let withdrawIndexAlice = submissionReceipt.logs[1].args._index;
        let withdrawRecordAlice = await plasma.publishedUTXOs(withdrawIndexAlice);
        assert(withdrawRecordAlice[9].toString(10) === "100");
        assert(withdrawRecordAlice[7] === alice);

        // priority is effectively the same, so BOB comes first as sends first


        let size = await queue.currentSize();
        assert(size.toString(10) === "2");
        let minimalItem = await queue.getMin();
        assert(minimalItem[0].toString(10) === "1");
        assert((new BN(ethUtil.toBuffer(minimalItem[1]))).toString(10) === withdrawIndexBob.toString(10));

        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        submissionReceipt = await plasma.finalizeExits(1);

        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        minimalItem = await queue.getMin();
        assert(minimalItem[0].toString(10) === "1");
        assert((new BN(ethUtil.toBuffer(minimalItem[1]))).toString(10) === withdrawIndexAlice.toString(10));

        submissionReceipt = await plasma.finalizeExits(1);
        
        size = await queue.currentSize();
        assert(size.toString(10) === "0");

    })

    it('should send an offer and accept it', async () => {
        // deposit to prevent stopping

        await plasma.deposit({from: alice, value: "100"})

        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();

        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )

        let block = createBlock(1, 2, firstHash, [tx],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = Buffer.concat(block.merkleTree.getProof(0, true));
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // should be in principle able to withdraw an output before the procedure

        submissionReceipt = await exitProcessor.startExit(1, 0, ethUtil.bufferToHex(reencodedTX),
        ethUtil.bufferToHex(proof), {from: alice, value: withdrawCollateral});

        let withdrawIndex = submissionReceipt.logs[1].args._index;
        let withdrawRecord = await plasma.publishedUTXOs(withdrawIndex);

        assert(withdrawRecord[9].toString(10) === "100");
        assert(withdrawRecord[7] === alice);
        assert(withdrawRecord[3]);
        assert(withdrawRecord[4]);


        //now lets offer a buyoyt for half of the amount
        // offerOutputBuyout(uint256 _withdrawIndex)
        submissionReceipt = await plasma.offerOutputBuyout(withdrawIndex, bob, {from: bob, value: 50})
        assert(submissionReceipt.logs.length == 1);
        let offer = await plasma.exitBuyoutOffers(withdrawIndex);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        assert(!offer[2]);

        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.acceptBuyoutOffer(withdrawIndex, {from: alice, gasPrice: 0});
        let newBalanceAlice = await web3.eth.getBalance(alice);

        assert(newBalanceAlice.gt(oldBalanceAlice));

        withdrawRecord = await plasma.publishedUTXOs(withdrawIndex);
        assert(withdrawRecord[8] === bob);
        
        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        let oldBalanceBob = await web3.eth.getBalance(bob);
        submissionReceipt = await plasma.finalizeExits(1, {from: operator});
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.gt(oldBalanceBob));

        oldBalanceAlice = newBalanceAlice
        newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.eq(oldBalanceAlice));
    })

    return

    it('should allow returning funds for expired offer', async () => {
        // deposit to prevent stopping

        await plasma.deposit({from: alice, value: "1000000000"})

        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();

        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )

        let tx2 = createTransaction(TxTypeFund, 1, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 2
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 2, firstHash, [tx, tx2],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = Buffer.concat(block.merkleTree.getProof(0, true));
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // should be in principle able to withdraw an output before the procedure

        submissionReceipt = await plasma.startWithdraw(1, 0, ethUtil.bufferToHex(reencodedTX),
        ethUtil.bufferToHex(proof), {from: alice, value: withdrawCollateral});

        let withdrawIndex = submissionReceipt.logs[0].args._withdrawIndex;
        let withdrawRecord = await plasma.withdrawRecords(withdrawIndex);

        assert(withdrawRecord[8].toString(10) === "100");
        assert(withdrawRecord[7] === alice);
        assert(withdrawRecord[3].toString(10) === "1");
        //now lets offer a buyoyt for half of the amount
        // offerOutputBuyout(uint256 _withdrawIndex)
        submissionReceipt = await buyouts.offerOutputBuyout(withdrawIndex, bob, {from: bob, value: 50})

        let offer = await plasma.withdrawBuyoutOffers(withdrawIndex);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        
        withdrawRecord = await plasma.withdrawRecords(withdrawIndex);
        assert(withdrawRecord[8].toString(10) === "100");
        assert(withdrawRecord[7] === alice);
        
        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        submissionReceipt = await plasma.finalizeExits(1, {from: alice});

        submissionReceipt = await buyouts.returnExpiredBuyoutOffer(withdrawIndex, {from: bob})
        offer = await plasma.withdrawBuyoutOffers(withdrawIndex);
        assert(offer[0].toString(10) === "0");

        let status = await plasma.withdrawRecords(withdrawIndex);
        assert(status[3].toNumber() === 3);

    })

    it('should allow returning funds for expired offer on timeout', async () => {
        // deposit to prevent stopping

        await plasma.deposit({from: alice, value: "1000000000"})

        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();

        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )

        let tx2 = createTransaction(TxTypeFund, 1, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 2
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 2, firstHash, [tx, tx2],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = Buffer.concat(block.merkleTree.getProof(0, true));
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // should be in principle able to withdraw an output before the procedure

        submissionReceipt = await plasma.startWithdraw(1, 0, ethUtil.bufferToHex(reencodedTX),
        ethUtil.bufferToHex(proof), {from: alice, value: withdrawCollateral});

        let withdrawIndex = submissionReceipt.logs[0].args._withdrawIndex;
        let withdrawRecord = await plasma.withdrawRecords(withdrawIndex);

        assert(withdrawRecord[8].toString(10) === "100");
        assert(withdrawRecord[7] === alice);
        assert(withdrawRecord[3].toString(10) === "1");
        //now lets offer a buyoyt for half of the amount
        // offerOutputBuyout(uint256 _withdrawIndex)
        submissionReceipt = await buyouts.offerOutputBuyout(withdrawIndex, bob, {from: bob, value: 50})

        let offer = await plasma.withdrawBuyoutOffers(withdrawIndex);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        
        withdrawRecord = await plasma.withdrawRecords(withdrawIndex);
        assert(withdrawRecord[8].toString(10) === "100");
        assert(withdrawRecord[7] === alice);
        
        const delay = await plasma.WithdrawDelay();
        await increaseTime(delay.toNumber() + 1);

        submissionReceipt = await buyouts.returnExpiredBuyoutOffer(withdrawIndex, {from: bob})
        offer = await plasma.withdrawBuyoutOffers(withdrawIndex);
        assert(offer[0].toString(10) === "0");

        let status = await plasma.withdrawRecords(withdrawIndex);
        assert(status[3].toNumber() === 1);

    })
    

    it('should not allow non-owner of transaction to start a withdraw of UTXO', async () => {
        // deposit to prevent stopping

        await plasma.deposit({from: alice, value: "1000000000"})

        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();

        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )

        let tx2 = createTransaction(TxTypeFund, 1, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 2
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 2, firstHash, [tx, tx2],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = Buffer.concat(block.merkleTree.getProof(0, true));
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // should be in principle able to withdraw an output before the procedure

        await expectThrow(plasma.startWithdraw(1, 0, ethUtil.bufferToHex(reencodedTX),
        ethUtil.bufferToHex(proof), {from: bob, value: withdrawCollateral}));
    })

    it('Should challenge a withdraw', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        
        await plasma.deposit({from: alice, value: "10000000000000"})
        let totalDeposited = await plasma.totalAmountDeposited();
        assert(totalDeposited.toString(10) === "10000000000000");
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        const reencodedTXAlice = tx.serialize();
        const proofAlice = block.merkleTree.getProof(0, true);
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");

        let newHash = await plasma.hashOfLastSubmittedBlock();
        tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 2
            }],
            [{
                amount: 200,
                to: bob
            }],
                operatorKey
        )

        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        const reencodedTXBob = tx.serialize();
        const proofBob = block.merkleTree.getProof(0, true);

        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // than we spend an output, but now Bob signs instead of Alice

        newHash = await plasma.hashOfLastSubmittedBlock();
        const tx2 = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        const tx3 = createTransaction(TxTypeSplit, 1, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(3, 2, newHash, [tx2, tx3],  operatorKey)
        const reencodedTX2 = tx2.serialize();
        const proof2 = Buffer.concat(block.merkleTree.getProof(0, true));

        const reencodedTX3 = tx3.serialize();
        const proof3 = Buffer.concat(block.merkleTree.getProof(1, true));

        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        bl = await storage.blocks(3);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // function proveDoubleSpend(uint32 _plasmaBlockNumber1, //references and proves transaction number 1
        //     uint32 _plasmaTxNumInBlock1,
        //     uint8 _inputNumber1,
        //     bytes _plasmaTransaction1,
        //     bytes _merkleProof1,
        //     uint32 _plasmaBlockNumber2, //references and proves transaction number 2
        //     uint32 _plasmaTxNumInBlock2,
        //     uint8 _inputNumber2,
        //     bytes _plasmaTransaction2,
        //     bytes _merkleProof2)

        submissionReceipt = await plasma.startWithdraw(
            1, 0, ethUtil.bufferToHex(reencodedTXAlice), ethUtil.bufferToHex(proofAlice),
             {from: alice, value: withdrawCollateral}
        )

        let withdrawIndexAlice = submissionReceipt.logs[0].args._withdrawIndex;

                            
        submissionReceipt = await plasma.challengeWithdraw(
            3, 0, ethUtil.bufferToHex(reencodedTX2), ethUtil.bufferToHex(proof2), withdrawIndexAlice
        )

        let withdrawRecordAlice = await plasma.withdrawRecords(withdrawIndexAlice);
        assert(withdrawRecordAlice[8].toString(10) === "100");
        assert(withdrawRecordAlice[7] === alice);
        assert(withdrawRecordAlice[3].toString(10) === "4");

    })

    it('Should withdraw succesfully', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        
        await plasma.deposit({from: alice, value: "10000000000000"})
        let totalDeposited = await plasma.totalAmountDeposited();
        assert(totalDeposited.toString(10) === "10000000000000");
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let spendingTX = tx.signedTransaction.serialize();
        const proofObject = block.getProofForTransaction(spendingTX)
        const reencodedTXAlice = tx.serialize();
        const proofAlice = block.merkleTree.getProof(0, true);
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");

        let newHash = await plasma.hashOfLastSubmittedBlock();
        
        submissionReceipt = await plasma.startWithdraw(
            1, 0, ethUtil.bufferToHex(proofObject.tx.serialize()), ethUtil.bufferToHex(proofObject.proof),
             {from: alice, value: withdrawCollateral}
        )

        let withdrawDelay = await plasma.WithdrawDelay();
        await increaseTime(withdrawDelay.toNumber() + 1);
        let withdrawIndexAlice = submissionReceipt.logs[0].args._withdrawIndex;

        submissionReceipt = await plasma.finalizeWithdraw(withdrawIndexAlice);

        let withdrawRecordAlice = await plasma.withdrawRecords(withdrawIndexAlice);
        assert(withdrawRecordAlice[8].toString(10) === "100");
        assert(withdrawRecordAlice[7] === alice);
        assert(withdrawRecordAlice[3].toString(10) === "3");

    })

})

