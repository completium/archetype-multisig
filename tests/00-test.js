const { deploy, getAccount, setQuiet, expectToThrow, setMockupNow, setEndpoint } = require('@completium/completium-cli');
const assert = require('assert');

const errors = {
  INVALID_CALLER: '"InvalidCaller"',
}

setQuiet(true);

setEndpoint('mockup')

// contracts
let dummy;
let multisig;

// constants
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
        owner: owner.pkh
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

  it("Set nb of approvals to 3", async () => {
    await multisig.require({
      arg: { 
        new_required : "3" 
      },
      as: owner.pkh
    })
  })

})

describe("Basic check", async () => {

  it("Invalid simple caller", async () => {
    await expectToThrow(async () => {
      await dummy.process({
        arg: {
          v: 1
        },
        as: manager1.pkh
      })
    }, errors.INVALID_CALLER)
  });

  it("Check if owner can call process", async () => {
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


describe("Test multisig", async () => {

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

  it("Add purpose and approve by Manager1", async () => {
    const code = getCode(dummy.address, "process", "nat", "" + expected_result);

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

  it("Set 'now' beyond expiration date", async () => {
    setMockupNow(now + 49 * 60 * 60);
  });

  it("Execute", async () => {
    const storage_before = await dummy.getStorage()
    assert(storage_before.result.toNumber() == 1)

    await multisig.execute({
      arg: {
        proposal_id: 0
      },
      as: manager1.pkh
    });

    const storage_after = await dummy.getStorage()
    assert(storage_after.result.toNumber() == expected_result)
  });


})