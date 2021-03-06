const { deploy, getAccount, setQuiet, expectToThrow, setMockupNow, setEndpoint, exprMichelineToJson, packTyped, sign, runGetter } = require('@completium/completium-cli');
const assert = require('assert');

const errors = {
  INVALID_CALLER    : '"INVALID_CALLER"',
  NOT_APPROVED      : '"NOT_APPROVED"',
  EXPIRED_PROPOSAL  : '"EXPIRED_PROPOSAL"',
  INVALID_SIGNATURE : '"INVALID_SIGNATURE"',
  INVALID_STATE     : '"INVALID_STATE"'
}

setQuiet(true);

setEndpoint('mockup')

// contracts
let dummy;
let multisig;

// constants
const MAX_DURATION = 180 * 24 * 60 * 60 // 180 days
const MIN_DURATION = 60 * 60            // 1 hour
const now = Date.now() / 1000

const owner = getAccount('alice');
const manager1 = getAccount('bob');
const manager2 = getAccount('carl');
const manager3 = getAccount('bootstrap1');

let proposal_id     = 0
let actual_result   = 0
let expected_result = 0

// utils
const getCode = (dest, entrypoint, typ, value) => {
  return `{
      DROP;
      NIL operation;
      PUSH address "${dest}";
      CONTRACT %${entrypoint} ${typ};
      IF_NONE
        { PUSH string "EntryNotFound";
          FAILWITH }
        {  };
      PUSH mutez 0;
      PUSH ${typ} ${value};
      TRANSFER_TOKENS;
      CONS;
    }`;
}

describe("Deploy", async () => {
  it("Dummy Contract", async () => {
    [dummy, _] = await deploy('./tests/contracts/dummy.arl', {
      parameters: {
        owner: owner.pkh
      },
      named: 'test_unit_multisig_dummy',
      as: owner.pkh
    });
  });

  it("Multisig", async () => {
    [multisig, _] = await deploy('./contracts/multisig.arl', {
      parameters: {
        owner: owner.pkh,
        required : 1,
        max_duration : MAX_DURATION,
        min_duration : MIN_DURATION
      },
      named: 'test_unit_multisig_multisig',
      as: owner.pkh
    });
  });
})

describe("Init", async () => {
  it("Set time", async () => {
    setMockupNow(now);
  });

  it("Add 3 managers", async () => {
    await multisig.control({
      arg: {
        maddr: manager1.pkh,
        allowed: true
      },
      as: owner.pkh
    })
    await multisig.control({
      arg: {
        maddr: manager2.pkh,
        allowed: true
      },
      as: owner.pkh
    })
    await multisig.control({
      arg: {
        maddr: manager3.pkh,
        allowed: true
      },
      as: owner.pkh
    })
  });

  it("Run", async () => {
    await multisig.run({
      as : owner.pkh
    })
  })

})

describe("Change requested value", async () => {

  it("Propose 'request' action by manager1", async () => {
    const code = getCode(multisig.address, "require", "nat", "2");

    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Approve by Manager2 and Manager3", async () => {
    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager2.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager3.pkh
    })
  });

  it("Execute (by previous contract's owner)", async () => {
    const storage_before = await multisig.getStorage()
    assert(storage_before.required.toNumber() == 1)

    await multisig.execute({
      arg: {
        proposal_id: proposal_id
      },
      as: owner.pkh
    });

    proposal_id ++
    const storage_after = await multisig.getStorage()
    assert(storage_after.required.toNumber() == 2)
  });

})

describe("Basic check on Dummy contract", async () => {

  it("Invalid caller", async () => {
    await expectToThrow(async () => {
      await dummy.process({
        arg: {
          v: 1
        },
        as: manager1.pkh
      })
    }, errors.INVALID_CALLER)
  });

  it("Owner can call Dummy's process", async () => {
    const storage_before = await dummy.getStorage()
    assert(storage_before.result.toNumber() == actual_result)

    actual_result   = 1
    await dummy.process({
      arg: {
        v: actual_result
      },
      as: owner.pkh
    })
    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == actual_result)
  });

})

describe("Test Multisig", async () => {

  it("Set Multisig as Dummy's owner", async () => {
    await dummy.set_owner({
      arg: {
        v: multisig.address
      },
      as: owner.pkh
    })
  });

  it("Previous owner cannot call Dummy's process", async () => {
    await expectToThrow(async () => {
      await dummy.process({
        arg: {
          v: 2
        },
        as: owner.pkh
      })
    }, errors.INVALID_CALLER)
  });

  it("Previous owner cannot add proposal", async () => {
    expected_result = 1
    const code = getCode(dummy.address, "process", "nat", "" + expected_result);

    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    await expectToThrow(async () => {
      const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
      await multisig.propose({
        argMichelson: arg,
        as: owner.pkh
      })
    }, errors.INVALID_CALLER)
  });

  it("Add proposal and approve by Manager1", async () => {
    expected_result = 2
    const code = getCode(dummy.address, "process", "nat", "" + expected_result);

    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Manager 1 cannot execute", async () => {
    await expectToThrow(async () => {
      await multisig.execute({
        arg: {
          proposal_id: proposal_id
        },
        as: manager1.pkh
      })
    }, errors.NOT_APPROVED);
  })

  it("Approve by Manager2 and Manager3", async () => {
    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager2.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager3.pkh
    })
  });

  it("Set 'now' beyond expiration date", async () => {
    setMockupNow(now + 49 * 60 * 60);
  });

  it("Proposal is expired", async () => {

    await expectToThrow(async () => {
      await multisig.execute({
        arg: {
          proposal_id: proposal_id
        },
        as: manager1.pkh
      })
    }, errors.EXPIRED_PROPOSAL);

  });

  it("Set 'now' before expiration date", async () => {
    setMockupNow(now + 47 * 60 * 60);
  });

  it("Execute (by previous Dummy's owner)", async () => {
    const storage_before = await dummy.getStorage()
    assert(storage_before.result.toNumber() == actual_result)

    await multisig.execute({
      arg: {
        proposal_id: proposal_id
      },
      as: owner.pkh
    });

    proposal_id ++

    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == expected_result)
    actual_result = expected_result
  });

})

describe("Test Multisig 2", async () => {

  it("Add proposal by Manager1", async () => {
    expected_result = 3
    const code = getCode(dummy.address, "process", "nat", expected_result);

    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'False';

    const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Approve by Managers 1, 2 and 3", async () => {
    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager1.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager2.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager3.pkh
    })
  });

  it("Set 'now' before expiration date", async () => {
    setMockupNow(now + 47 * 60 * 60);
  });

  it("Execute (by previous Dummy's owner)", async () => {
    const storage_before = await dummy.getStorage()
    assert(storage_before.result.toNumber() == actual_result)

    await multisig.execute({
      arg: {
        proposal_id: proposal_id
      },
      as: owner.pkh
    });
    proposal_id ++
    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == expected_result)
    actual_result = expected_result
  });

})

describe("Feeless process (propose, approve)", async () => {

  it("Manager1 proposes and approves (injected by owner)", async () =>{
    const validity_duration   = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';
    const pk                 = manager1.pubk
    const pkh                = manager1.pkh
    const counter            = 0
    const entryname          = "propose"

    expected_result = 4
    const code = getCode(dummy.address, "process", "nat", "" + expected_result);

    // Build signature
    const dataType = exprMichelineToJson("(pair address (pair nat (pair string (pair (lambda unit (list operation)) nat))))");
    const data     = exprMichelineToJson(`(Pair "${pkh}" (Pair ${counter} (Pair "${entryname}" (Pair ${code} ${validity_duration}))))`);

    const tosign    = packTyped(data, dataType);
    const signature = await sign(tosign, { as: manager1.name }); // signed by manager1
    const sig       = signature.prefixSig

    const arg = `(Pair ${code} (Pair ${validity_duration} (Pair ${approved_by_caller} (Pair "${pk}" "${sig}"))))`
    await multisig.propose_feeless({
      argMichelson: arg,
      as: owner.pkh
    })

  });

  it("Manager2 approves with INVALID signature", async () => {
    const counter     = 0
    const entryname   = "approve"
    const pk          = manager2.pubk
    const pkh         = manager2.pkh

    // Build invalid signature
    const dataType = exprMichelineToJson("(pair address (pair nat (pair string nat)))");
    const data     = exprMichelineToJson(`(Pair "${pkh}" (Pair ${counter} (Pair "${entryname}" ${proposal_id})))`);

    const tosign    = packTyped(data, dataType);
    const signature = await sign(tosign, { as: manager1.name }); // signed by manager1 instead of manager2
    const sig       = signature.prefixSig

    const arg = `(Pair ${proposal_id} (Pair "${pk}" "${sig}"))`

    await expectToThrow(async () => {
      await multisig.approve_feeless({
        argMichelson: arg,
        as: owner.pkh
      })
    }, errors.INVALID_SIGNATURE)
  })

  it("Manager2 approves (injected by owner)", async () =>{
    await approve_feeless(manager2)
  });

  it("Manager3 approves (injected by owner)", async () =>{
    await approve_feeless(manager3)
  });

  const approve_feeless = async (manager) => {
    const counter     = 0
    const entryname   = "approve"
    const pk          = manager.pubk
    const pkh         = manager.pkh

    // Build signature
    const dataType = exprMichelineToJson("(pair address (pair nat (pair string nat)))");
    const data     = exprMichelineToJson(`(Pair "${pkh}" (Pair ${counter} (Pair "${entryname}" ${proposal_id})))`);

    const tosign    = packTyped(data, dataType);
    const signature = await sign(tosign, { as: manager.name }); // signed by manager2
    const sig       = signature.prefixSig

    const arg = `(Pair ${proposal_id} (Pair "${pk}" "${sig}"))`
    await multisig.approve_feeless({
      argMichelson: arg,
      as: owner.pkh
    })
  }

  it("Execute (by owner)", async () => {
    const storage_before = await dummy.getStorage()
    assert(storage_before.result.toNumber() == actual_result)

    await multisig.execute({
      arg: {
        proposal_id: proposal_id
      },
      as: owner.pkh
    });

    proposal_id ++

    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == expected_result)
    actual_result = expected_result
  });

});

describe("Pause / Unpause", async () => {
  it("Manager1 proposes and approves to pause", async () => {
    const code = getCode(multisig.address, "pause", "unit", "Unit");
    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';
    const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });
  it("Manager2 and Manager3 approve", async () => {
    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager2.pkh
    });
    await multisig.approve({
      arg: {
        proposal_id: proposal_id
      },
      as: manager3.pkh
    })
  });
  it("Owner executes", async () => {
    await multisig.execute({
      arg: {
        proposal_id: proposal_id
      },
      as: owner.pkh
    });
  });
  it("Manager 1 cannot propose", async () => {
    const code = getCode(multisig.address, "require", "nat", "10");
    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';
    const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
    await expectToThrow(async () => {
      await multisig.propose({
        argMichelson: arg,
        as: manager1.pkh
      })
    }, errors.INVALID_STATE)
  });
  it("Managers (2 and 3) approve unpause", async () => {
    await multisig.approve_unpause({
      as: manager2.pkh
    });
    await multisig.approve_unpause({
      as: manager3.pkh
    })
  });
  it("Owner unpauses", async () => {
    await multisig.unpause({
      as: owner.pkh
    });
  });
  it("Manager 1 can now propose", async () => {
    const code = getCode(multisig.address, "set_duration", "(pair nat nat)", `(Pair 60 ${MAX_DURATION})`);
    const validity_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';
    const arg = `(Pair ${code} (Pair ${validity_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });
})