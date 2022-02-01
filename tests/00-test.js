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

const owner = getAccount('alice');
const user1 = getAccount('bob');
const user2 = getAccount('carl');
const user3 = getAccount('bootstrap1');

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

describe("Dummy check", async () => {

  it("Invalid simple caller", async () => {
    await expectToThrow(async () => {
      await dummy.process({
        arg: {
          v: 1
        },
        as: user1.pkh
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


describe("Test", async () => {

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
          v: 1
        },
        as: owner.pkh
      })
    }, errors.INVALID_CALLER)
  });


})