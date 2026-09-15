import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Delete from '../../../../../src/commands/siri/data/bulkv2/delete.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject, mockJob } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 delete', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let operateStub: SinonStub;
  let checkFileSizeStub: SinonStub;
  let cleanupStub: SinonStub;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const baseArgs = ['--target-org', testOrg.username, '--sobjecttype', 'Account', '--csvfile', 'delete.csv'];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    operateStub = $$.SANDBOX.stub(BulkV2.prototype, 'operate').resolves(mockJob({ operation: 'delete' }));
    checkFileSizeStub = $$.SANDBOX.stub(BulkV2.prototype, 'checkFileSizeAndAct').resolves(['delete.csv']);
    cleanupStub = $$.SANDBOX.stub(BulkV2.prototype, 'cleanupTempFiles');
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs a soft delete by default and returns one job per file', async () => {
    const result = await BulkV2Delete.run(baseArgs);

    expect(result).to.have.length(1);
    expect(result[0].id).to.equal('750xx0000000044AAA');
    expect(operateStub.firstCall.args[0]).to.include({ operation: 'delete', csvfile: 'delete.csv' });
  });

  it('uses hardDelete when --hard is set', async () => {
    await BulkV2Delete.run([...baseArgs, '--hard']);

    expect(operateStub.firstCall.args[0]).to.include({ operation: 'hardDelete' });
  });

  it('splits the CSV first and runs one job per chunk', async () => {
    checkFileSizeStub.resolves(['/tmp/chunk-0.csv', '/tmp/chunk-1.csv']);

    const result = await BulkV2Delete.run(baseArgs);

    expect(checkFileSizeStub.calledOnceWithExactly('delete.csv')).to.be.true;
    expect(operateStub.callCount).to.equal(2);
    expect(operateStub.secondCall.args[0]).to.include({ csvfile: '/tmp/chunk-1.csv' });
    expect(result).to.have.length(2);
  });

  it('always removes temp chunks and stops the spinner, even on failure', async () => {
    operateStub.rejects(new Error('Delete exploded'));

    const err = await expectReject(() => BulkV2Delete.run(baseArgs));

    expect(err.message).to.include('Delete exploded');
    expect(cleanupStub.calledOnce).to.be.true;
    expect(spinnerStubs.stop.called).to.be.true;
  });

  it('requires --sobjecttype and --csvfile', async () => {
    const err = await expectReject(() => BulkV2Delete.run(['--target-org', testOrg.username]));

    expect(err.message).to.match(/Missing required flag/);
    expect(operateStub.called).to.be.false;
  });
});
