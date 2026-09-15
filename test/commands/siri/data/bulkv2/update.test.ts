import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Update from '../../../../../src/commands/siri/data/bulkv2/update.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject, mockJob } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 update', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let operateStub: SinonStub;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const baseArgs = ['--target-org', testOrg.username, '--sobjecttype', 'Account', '--csvfile', 'updates.csv'];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    operateStub = $$.SANDBOX.stub(BulkV2.prototype, 'operate').resolves(mockJob({ operation: 'update' }));
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs the update and returns the job info', async () => {
    const result = await BulkV2Update.run(baseArgs);

    expect(result.id).to.equal('750xx0000000044AAA');
    expect(result.operation).to.equal('update');
  });

  it('passes the update operation to BulkV2.operate', async () => {
    await BulkV2Update.run(baseArgs);

    expect(operateStub.firstCall.args[0]).to.deep.equal({
      sobjecttype: 'Account',
      operation: 'update',
      csvfile: 'updates.csv',
      lineending: 'LF',
      delimiter: 'COMMA',
    });
  });

  it('stops the spinner and rethrows when the operation fails', async () => {
    operateStub.rejects(new Error('Update exploded'));

    const err = await expectReject(() => BulkV2Update.run(baseArgs));

    expect(err.message).to.include('Update exploded');
    expect(spinnerStubs.stop.called).to.be.true;
  });

  it('requires --sobjecttype and --csvfile', async () => {
    const err = await expectReject(() => BulkV2Update.run(['--target-org', testOrg.username]));

    expect(err.message).to.match(/Missing required flag/);
    expect(operateStub.called).to.be.false;
  });
});
