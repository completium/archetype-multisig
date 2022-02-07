# Multisig

This generic-purpose multi-signature contract is used to execute operations (transfer, contract entrypoints) that have been approved by a required number of managers.

The process is three steps:
* ***propose*** : a manager propose a list of operations to execute
* ***approve*** : managers may approve the proposal
* ***execute*** : operations may be executed (by anyone) when the required number of approvals has been reached

## Deploy

The [Archetype](https://archetype-lang.org/) contract may be deployed with [Completium](https://completium.com/docs/cli) with the following command:

```bash
$ completium-cli deploy ./contract/multisig.arl --parameters '{ "owner" : "$OWNER", "required" : "$REQUIRED", "min_duration" : "$MIN", "max_duration" : "$MAX" }'
```

where:
* `$OWNER` is the address of the owner
* `$REQUIRED` is the minimum number of approvals
* `$MIN` is the minimum validity duration of a proposal (in seconds)
* `$MAX` is the maximum validity duration of a proposal (in seconds)

## Run tests

The first time, install dependencies with:
```
$ npm i
```

Execute tests ([00-test.js](./tests/00-tests.js)) with:

```bash
$ npm test
```

## Propose

A proposal is made of a list of operations materialised as a lambda value of type `lambda unit (list operation)`, that is a function with no argument that returns a list of operations.

A lambda value is an anonymous function that can be stored, passed as an argument to a function or an entry point, and executed programmatically.

Passing a lambda value rather than a list of operations is necessary because in Michleson there is no literal for operations (for security reason); operations are only obtained with the *transfer* instruction.

A proposal also has a *validity duration*; it cannot be executed beyond the expiration date, which is the date of proposal plus the validity duration.

### Calling one entrypoint

The lambda value to returns a list of one operation that calls an entrypoint of a contract is presented here:

```bash
{
  DROP;                                    # drops the Unit argument
  NIL operation;                           # stacks the empty operation list
  PUSH address "${contract_address}";      # stacks the contract address
  CONTRACT %${entrypoint_name} ${type};    # creates an option of contract's entrypoint (from address)
  IF_NONE                                  # if contract address or entry not found
    { PUSH string "EntryNotFound";         # stacks error message
      FAILWITH }                           # fails
    {  };
  PUSH mutez 0;                            # stacks number of tez to send contract
  PUSH ${type} ${value};                   # stacks entrypoint argument
  TRANSFER_TOKENS;                         # generates operation
  CONS;                                    # adds it to the empty operation list
}
```

where:
* `contract_address` is the address of the contract to call
* `entrypoint_name` is the name of the entrypoint to execute
* `type` is the type of the argument
* `value` is the value to pass to the entrypoint

NB : these values must be set in the lambda value.

### Michelson types and values

The table below presents the Michelson syntax for the main types and corresponding value examples to pass to the entrypoint, as well as the Archetype types:

| Archetype type | Michelson type | Michelson value example |
| -- | -- | -- |
| `bool` | `bool` | `True`, `False` |
| `nat` | `nat` | `2022` |
| `int` | `int` | `2022`, `-42` |
| `string` | `string` | `"Hello multisig"` |
| `address` | `address` | `"tz1hyc1CRQpjskJUUaGrh85UZXPi6kU4JuGd"` |
| `bytes` | `bytes` | `0x000001` |
| `option<TYPE>` | `option TYPE` | example of `option nat`: `None`, `Some 42` |
| `list<TYPE>` | `list TYPE` | example of `list nat`: `{ 42; 5567; 756786 }` |
| `(TYPE1 * TYPE2)` | `pair TYPE1 TYPE2` | example of `pair nat string`: `Pair 45 "Hello"` |
| `map<TYPE1, TYPE2>` | `map TYPE1 TYPE2` | example of `map nat string`: `{ Elt 45 "Hello" }` |

## State Machine

The contract has 3 states :

| State | Description |
| -- | -- |
| Starting | Initial state. The declared owner sets the parameters of the contract (add/remove manager, number of required approval, ...). No proposal can be submitted. |
| Running | Contract ownership is transferred to the contract itself (`owner = selfaddress`). The Propose/approve/execute process is operational.
| Paused | No proposal can be submitted. |

> Note that in `Running` state, the owner of the contract is the contract itself. This implies that changes in the contract parameters must follow the propose/approve/execute process (including pausing the contract).

### Transitions

The table below presents the entrypoints to go from one state to another

| From | To | entrypoint |
| -- | -- | -- |
| Starting | Running | `run` |
| Running | Paused | `pause` |
| Paused | Running | `unpause` |

> Note that the `unpause` mechanism uses its own approval mechanism: the required number of manager needs to call entrypoint `approve_unpause` for the `unpause` entrypoint to be executable.

## Number of required managers

The best practice to setup the multisig process is that the maximum value for the `required` data (number of required managers to execute the operations) is the *number of registered managers minus 1*.

This rule is coded in the contract in the execution condition `r7` of the `require` entrypoint:

```js
entry %require(new_required : nat) {
  called by owner
  state is Running
  require {
    r7 : 0 < new_required < manager.count()
  }
  effect {
    required := new_required
  }
}
```

This is for security reason: if one of the manager's private key is compromised, it is necessary to have one extra manager to vote for the removal of the compromised manager.

The extra manager may typically be the initial owner of the contract.

## Feeless

The contract provides with (one step) feeless process for proposal and approval, respectively with the entrypoints `propose_feeless` and `approve_feeless`.

The feeless approach splits the process in two:
 - the manager signs the required data to propose or approve
 - an "injector" can then call the feeless entries with the signed data

 The benefit is that managers do not pay the blockchain fee. Hence managers are not required to have tez, nor to have a revealed address on the blockchain; they are just required to be able to sign with a wallet.

 The injector is the one paying the fee to the blockchain. It is typically a backend process.

 ### Data to sign

 The table below presents the data to sign for each feeless entrypoint:

 | Entrypoint | Michelson data type | Michelson value |
 | -- | -- | -- |
 | `propose_feeless` | `pair address (pair nat (pair string (pair (lambda unit (list operation)) nat)))` | Tuple of:<ul><li>manager address (public key hash)</li><li>manager counter</li><li>`"propose"`</li><li>lambda value</li><li>validity duration (before expiration)</li></ul> |
 | `approve_feeless` | `pair address (pair nat (pair string nat))` | Tuple of: <ul><li>manager address (public key hash)</li><li>manager counter</li><li>`"approve"`</li><li>validity duration (before expiration)</li></ul>|

 Each manager is associated to a counter that is incremented by the contract each time a feeless entry is called. This is a security feature to prevent from replay attack (so that one cannot use the signed data twice).

## Storage

| Element | Michelson type | Desc. |
| -- | -- | -- |
| `owner` | `address` | Contract's owner address. |
| `required` | `nat` | Minimum number of approvals to execute operations. |
| `min_duration` | `nat` | Minimum validity duration of a proposal. |
| `max_duration` | `nat` | Maximum validity duration of a proposal. |
| `id_count` | `nat` | Id of next proposal. |
| `manager` | `map address nat` | Map of managers; a manager is associated to a counter (security data for feeless process). |
| `proposal` | `map nat (pair nat (pair (set address) (lambda Unit (list operation))))` | Map of proposals; a proposal is associated to: <ul><li>expiration date</li><li>set of approvers</li><li>list of operations (as a lambda)</li></ul> |
| `owner_candidate` | `option address` | Optional address of owner candidate. |
| `approve_unpause_set` | `set address` | Set of addresses that approve unpausing the contract. |
| `_state` | `int` | <ul><li>`O` : Starting</li><li>`1` : Running</li><li>`2` : Paused</li></ul>

## API

| Entrypoint | Called by | Argument Michelson type | Argument | Desc. |
| -- | -- | -- | -- | -- |
| `declare_ownership` | Owner | `address` | Candidate address for new owner. | |
| `accept_ownership` | Owner candidate | `address` |  | Owner is now caller. |
| `set_metadata_uri` | Owner | `bytes` | metadata | See [TZIP-16](https://gitlab.com/tezos/tzip/-/blob/master/proposals/tzip-16/tzip-16.md). |
| `pause` | Owner | | |
| `approve_unpause` | Manager | | |
| `unpause` | *any* | | |
| `control` | Owner | `pair address bool` | <ul><li>manager address</li><li>`True` to add, `False` to remove</li></ul> | |
| `run` | Owner | | | Transfers ownership to contract and set state to `Running`|
| `require` | Owner | `nat` | new `required` value | |
| `set_duration` | Owner | `pair nat nat` | <ul><li>minimum validity duration</li><li>maximum validity duration</li></ul> | |
| `propose` | Manager | `pair (lambda Unit (list operation)) (pair nat bool))` | <ul><li>lambda value for operations</li><li>validity duration</li><li>approved by calling manager</li></ul> | |
| `approve` | Manager | `nat` | proposal id | |
| `execute` | *any* | `nat` | proposal id | |
| `propose_feeless` | Manager | `pair (lambda Unit (list operation)) (pair nat (pair bool (pair signature key))))` | <ul><li>lambda value for operations</li><li>validity duration</li><li>approved by calling manager</li><li>data signed by manager</li><li>manager's public key</li></ul> | |
| `approve_feeless` | Manager | `pair nat (pair signature key)` | <ul><li>proposal id</li><li>data signed by manager</li><li>manager's public key</li></ul> | |
| `get_manager_counter` | *any* | `address` | manager address | view (TZIP4) to get the counter of a manager |
| `get_approvals` | *any* | `nat` | proposal id |  view (TZIP4) to get the set of managers that approved the proposal |

## Example usage scenario

The Usage scenario presented here has an owner and three managers:

* Contract is deployed with parameters:<ul><li>owner: (an address)</li><li>required: `1`</li>min_duration: `3600` (one hour)</li><li>max_duration: `15552000` (180 days)</li></ul>
* Owner calls `control` to add manager 1
* Owner calls `control` to add manager 2
* Owner calls `control` to add manager 3
* Owner calls `require` to set required number of approvals to `2`
* Owner calls `run`; it transfers the contract ownership to managers and sets the contract state to `Running`
* Manager 1 calls `propose` to propose an action (for example call another contract)
* Manager 2 calls `approve` to approve it (with proposal id `0`)
* Manager 3 calls `approve` to approve it (with proposal id `0`)
* Owner calls `execute` with proposal id `0` to execute the proposed action
* Manager 2 calls `propose` to pause the contract
* Manager 1 calls `approve` (with proposal id `1`)
* Owner calls `execute` with proposal id `1`; as a result contract is paused
* Manager 3 calls `approve_unpause`
* Manager 2 calls `approve_unpause`
* Owner calls `unpause`
* ...

