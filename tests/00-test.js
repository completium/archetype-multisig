const { deploy, getAccount, setQuiet, expectToThrow, setMockupNow, setEndpoint } = require('@completium/completium-cli');
const assert = require('assert');

const errors = {
  INVALID_CALLER   : '"InvalidCaller"',
  NOT_APPROVED     : '"NOT_APPROVED"',
  EXPIRED_PROPOSAL : '"EXPIRED_PROPOSAL"'
}

setQuiet(true);

setEndpoint('mockup')

// contracts
let dummy;
let multisig;

// constants
const MAX_DURATION = 180 * 24 * 60 * 60
const MIN_DURATION = 60 * 60
const now = Date.now() / 1000

const owner = getAccount('alice');
const manager1 = getAccount('bob');
const manager2 = getAccount('carl');
const manager3 = getAccount('bootstrap1');

const expected_result = 6

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

    const expired_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    const arg = `(Pair ${code} (Pair ${expired_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Approve by Manager2 and Manager3", async () => {
    await multisig.approve({
      arg: {
        proposal_id: 0
      },
      as: manager2.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: 0
      },
      as: manager3.pkh
    })
  });

  it("Execute (by previous contract's owner)", async () => {
    const storage_before = await multisig.getStorage()
    assert(storage_before.required.toNumber() == 1)

    await multisig.execute({
      arg: {
        proposal_id: 0
      },
      as: owner.pkh
    });

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
    assert(storage_before.result.toNumber() == 0)

    await dummy.process({
      arg: {
        v: 1
      },
      as: owner.pkh
    })
    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == 1)
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
    const code = getCode(dummy.address, "process", "nat", "" + expected_result);

    const expired_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    await expectToThrow(async () => {
      const arg = `(Pair ${code} (Pair ${expired_duration} ${approved_by_caller}))`
      await multisig.propose({
        argMichelson: arg,
        as: owner.pkh
      })
    }, errors.INVALID_CALLER)
  });

  it("Add proposal and approve by Manager1", async () => {
    const code = getCode(dummy.address, "process", "nat", "" + expected_result);

    const expired_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    const arg = `(Pair ${code} (Pair ${expired_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Manager 1 cannot execute", async () => {
    await expectToThrow(async () => {
      await multisig.execute({
        arg: {
          proposal_id: 1
        },
        as: manager1.pkh
      })
    }, errors.NOT_APPROVED);
  })

  it("Approve by Manager2 and Manager3", async () => {
    await multisig.approve({
      arg: {
        proposal_id: 1
      },
      as: manager2.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: 1
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
          proposal_id: 1
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
    assert(storage_before.result.toNumber() == 1)

    await multisig.execute({
      arg: {
        proposal_id: 1
      },
      as: owner.pkh
    });

    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == expected_result)
  });

})

describe("Test Multisig 2", async () => {

  it("Add proposal by Manager1", async () => {
    const code = getCode(dummy.address, "process", "nat", "" + (2 * expected_result));

    const expired_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'False';

    const arg = `(Pair ${code} (Pair ${expired_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Approve by Managers 1, 2 and 3", async () => {
    await multisig.approve({
      arg: {
        proposal_id: 2
      },
      as: manager1.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: 2
      },
      as: manager2.pkh
    });

    await multisig.approve({
      arg: {
        proposal_id: 2
      },
      as: manager3.pkh
    })
  });

  it("Set 'now' before expiration date", async () => {
    setMockupNow(now + 47 * 60 * 60);
  });

  it("Execute (by previous Dummy's owner)", async () => {
    const storage_before = await dummy.getStorage()
    assert(storage_before.result.toNumber() == expected_result)

    await multisig.execute({
      arg: {
        proposal_id: 2
      },
      as: owner.pkh
    });

    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == 2 * expected_result)
  });

})