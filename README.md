# Plasma Parent Contract

## Transaction structure

### Input
An RLP encoded set with the following items:
- Block number, 4 bytes
- Transaction number in block, 4 bytes
- Output number in transaction, 1 byte
- "Amount" field, 32 bytes, that is more a data field, usually used for an amount of the output referenced by previous field, but has special meaning for "Deposit" transactions

### Output
An RLP encoded set with the following items:
- Output number in transaction, 1 byte
- Receiver's Ethereum address, 20 bytes
- "Amount" field, 32 bytes

### Transaction 
An RLP encoded set with the following items:
- Transaction type, 1 byte
- An array (list) of Inputs, maximum 2 items
- An array (list) of Outputs, maximum 3 items. One of the outputs is an explicit output to an address of Plasma operator.

### Signed transaction 
An RLP encoded set with the following items:
- Transaction, as described above
- Recoverable EC of the transaction sender:
   1) V value, 1 byte, expected values 27, 28
   2) R value, 32 bytes
   3) S value, 32 bytes

From this signature Plasma operator deduces a sender, checks that the sender is an owner of UTXOs referenced by inputs. Signature is based on EthereumPersonalHash(RLPEncode(Transaction)). Transaction should be well-formed, sum of inputs equal to sum of the outputs, etc 

### Block header
- Block number, 4 bytes, used in the main chain to double check proper ordering
- Number of transactions in block, 4 bytes, purely informational
- Parent hash, 32 bytes, hash of the previous block, hashes the full header
- Merkle root of the transactions tree, 32 bytes
- V value, 1 byte, expected values 27, 28
- R value, 32 bytes
- S value, 32 bytes

Signature is based on EthereumPersonalHash(block number || number of transactions || previous hash || merkle root), where || means concatenation. Values V, R, S are then concatenated to the header.

### Block
- Block header, as described above, 137 bytes
- RLP encoded array (list) of signed transactions, as described above

While some fields can be excessive, such block header can be submitted by anyone to the main Ethereum chain when block is available, but for some reason not sent to the smart contract. Transaction numbering is done by the operator, it should be monotonically increasing without spaces and number of transactions in header should (although this is not necessary for the functionality) match the number of transactions in the Merkle tree and the full block.

## This contract differs from Minimal Viable Plasma in the following:

- Other transactions structure with nested RLP fields
- Deposit transactions are declarative: new block with 1 transaction is not created automatically (although can be easily changed), but deposit record is created and can be withdrawn back to user if Plasma operator doesn't provide transaction of appropriate structure (referencing this deposit, having proper owner and amount).
- Anyone(!) can send a header of the block to the main chain, so if block is assembled and available, but not yet pushed to the main chain, anyone can send a header on behalf of Plasma operator.

## Implemented functionality:

All basic challenges and potential "cheats" for operator or user should be now covered

## List of intended challenges and tests
- [x] Block header uploads
    - [x] should accept one properly signed header
    - [x] should NOT accept same header twice
    - [x] should accept two headers in right sequence
    - [x] should accept two headers in right sequence in the same transaction
    - [x] should NOT accept two headers in wrong sequence
    - [x] should NOT accept invalidly signed block header
    - [x] should NOT accept invalidly signed block header in sequence in one transaction
    - [x] should property update two weeks old block number
    - [x] should check block hashes match in addition to block numbers in sequence
- [ ] Deposits
    - [x] should emit deposit event
    - [x] should allow deposit withdraw process
    - [x] should respond to deposit withdraw challenge
    - [x] should allow successful deposit withdraw
    - [x] should require bond for deposit withdraw start
    - [x] should stop Plasma on duplicate funding transaction
    - [x] should stop Plasma on funding without deposit
    - [x] should update total deposited amount for all tests above
    - [ ] should update amount pending exit for all tests above
- [ ] Exits (normal process)
    - [x] should start withdraw with proper proof
    - [x] should not allow non-owner of transaction to start a withdraw of UTXO
    - [x] should respond to withdraw challenge
    - [x] should allow successful withdraw
    - [x] should require bond for withdraw start 
    - [ ] should return bond on successful withdraw
    - [ ] should update amount pending withdraw for all tests above
    - [ ] should update total amount deposited for all tests above
    - [x] should allow offer for buyout
    - [x] should allow accepting a buyout offer
    - [x] should allow returning funds for expired offer 
- [ ] Limbo exits (when Plasma is stopped)
    - [x] should allow to start a limbo exit
    - [x] should require a collateral for each input
    - [ ] should allow to join a limbo exit
    - [ ] should maintain priority in the queue
    - [ ] should give the same priority for blocks that are older than 2 weeks
    - [ ] should respond to exit prevention challenge
    - [x] should allow successful exit
    - [ ] should update amount pending withdraw for all tests above
    - [ ] should update total amount deposited for all tests above
- [ ] Challenges
    - [x] Invalid transaction in block (unrealisable)
    - [x] should NOT stop on valid transaction (not malformed) in block
    - [x] Transaction in block references the future
    - [x] Two transactions have the same number in block
    - [x] Transaction is malformed (balance breaking)
    - [x] Double spend
    - [x] Spend without owner signature
    - [x] UTXO amount is not equal to input amount
    - [x] UTXO was successfully withdrawn and than spent in Plasma

## Getting started

### Download dependecies:

```
git submodule init
git submodule update --recursive
```

## Contribution

Everyone is welcome to spot mistakes in the logic of this contract as number of provided functions is substantial. If you find a potential error or security loophole (one that would allow Plasma operator or user to break the normal operation and not being caught) - please open an issue.

## Authors

Alex Vlasov, [@shamatar](https://github.com/shamatar),  alex.m.vlasov@gmail.com

## Further work

Make optimizations for reduced gas costs for most of the functions.

## License

All source code and information in this repository is available under the Apache License 2.0 license.
