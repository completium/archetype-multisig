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
  it("Dummy", async () => {
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

  it("Add managers", async () => {
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


})

describe("Dummy check", async () => {

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

  it("Set multisig for owner of dummy", async () => {
    await dummy.set_owner({
      arg: {
        v: multisig.address
      },
      as: owner.pkh
    })
  });

  it("Check if previous owner cannot call process", async () => {
    await expectToThrow(async () => {
      await dummy.process({
        arg: {
          v: 2
        },
        as: owner.pkh
      })
    }, errors.INVALID_CALLER)
  });


  it("Add purpose", async () => {
    const code = getCode(dummy.address, "process", "nat", "2");

    const expired_duration = 48 * 60 * 60; // 48h
    const approved_by_caller = 'True';

    const arg = `(Pair ${code} (Pair ${expired_duration} ${approved_by_caller}))`
    await multisig.propose({
      argMichelson: arg,
      as: manager1.pkh
    })
  });

  it("Approve", async () => {
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
    assert(storage_after.result.toNumber() == 2)
  });


})