# Multisig

This generic-purpose multi-signature contract is used to execute operations (transfer, contract entrypoints) that have been approved by a required number of managers.

The process is three steps:
* ***propose*** : a manager propose a list of operations to execute
* ***approve*** : managers may approve the proposal
* ***execute*** : operations may be executed (by anyone) when the required number of approvals has been reached

## Deploy

The [Archetype](https://archetype-lang.org/) contract may be deployed with [Completium](https://completium.com/docs/cli) with the following command:

```bash
$ completium-cli deploy ./contract/multisig.arl --parameters '{ "owner" : "$OWNER", "required" : $REQUIRED, "min_duration" : "$MIN", "max_duration" : "$MAX" }'
```

where:
* `$OWNER` is the address of the owner
* `$REQUIRED` is the minimum number of approvals
* `$MIN` is the minimum validity duration of a proposal
* `$MAX` is the maximum validity duration of a proposal

## Propose

A proposal is made of a list of operations materialised as a lambda value of type `lambda unit (list operation)`, that is a function with no argument that returns a list of operations.

A lambda value is an anonymous function that can be stored, passed as an argument to a function or an entry point, and executed programmatically.

Passing a lambda value rather than a list of operations is necessary because in Michleson there is no literal for operations; operations are only obtained with the *transfer* instruction.

A proposal also has an expiration duration; it cannot be executed beyond the expiration date, which is the date of proposal plus the expiration duration.

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
| `int` | `int` | `-42` |
| `string` | `string` | `"Hello multisig"` |
| `address` | `address` | `"tz1hyc1CRQpjskJUUaGrh85UZXPi6kU4JuGd"` |
| `bytes` | `bytes` | `0x000001` |
| `option<TYPE>` | `option TYPE` | example of `option nat`: `None`, `Some 42` |
| `list<TYPE>` | `list TYPE` | example of `list nat`: `{ 42; 5567; 756786 }` |
| `(TYPE1 * TYPE2)` | `pair TYPE1 TYPE2` | example of `pair nat string`: `Pair 45 "Hello"` |

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

## Example usage scenario

The Usage scenario presented here has an owner and three managers:

| State | Action |
| -- | -- |
| - | Contract is deployed with parameters:<ul><li>owner: (an address)</li><li>required: `1`</li>min_duration: `3600` (one hour)</li><li>max_duration: `15552000` (180 days)</li></ul> |
| Starting | `owner` calls `control` to add manager 1 |
| Starting | `owner` calls `control` to add manager 2 |
| Starting | `owner` calls `control` to add manager 3 |
| Starting | `owner` calls `require` to set required number of approvals to `2` |
| Starting | `owner` calls `run`; it transfers the contract ownership to managers |
| Running | `manager1` calls `propose` to propose an action (for example call another contract) |
| Running | `manager2` calls `approve` to approve it (with proposal id `0`) |
| Running | `manager3` calls `approve` to approve it (with proposal id `0`) |
| Running | `owner` calls `execute` with proposal id `0` to execute the proposed action |
| Running | `manager2` calls `propose` to pause the contract |
| Running | `manager1` calls `approve` to approve and approve the contract pausing (with proposal id `1`) |
| Running | `owner` calls `execute` with proposal id `1`|
| Paused | `manager3` calls `approve_unpause` |
| Paused | `manager2` calls `approve_unpause` |
| Paused | `owner` calls `unpause` |
| Running | ... |

## Test scenario

The first time, install dependencies with:
```
$ npm i
```

Execute the test scenario ([00-test.js](./tests/00-tests.js)) with:

```bash
$ npm test
```