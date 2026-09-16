import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Upsert from '../../../../../src/commands/siri/data/bulkv2/upsert.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject, mockJob } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 upsert', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let operateStub: SinonStub;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const baseArgs = [
    '--target-org',
    testOrg.username,
    '--sobjecttype',
    'Account',
    '--csvfile',
    'upserts.csv',
    '--externalid',
    'External_Id__c',
  ];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    operateStub = $$.SANDBOX.stub(BulkV2.prototype, 'operate').resolves(mockJob({ operation: 'upsert' }));
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs the upsert and returns the job info', async () => {
    const result = await BulkV2Upsert.run(baseArgs);

    expect(result.id).to.equal('750xx0000000044AAA');
    expect(result.operation).to.equal('upsert');
  });

  it('passes the external ID field to BulkV2.operate', async () => {
    await BulkV2Upsert.run(baseArgs);

    expect(operateStub.firstCall.args[0]).to.deep.equal({
      sobjecttype: 'Account',
      externalid: 'External_Id__c',
      operation: 'upsert',
      csvfile: 'upserts.csv',
      lineending: 'LF',
      delimiter: 'COMMA',
    });
  });

  it('requires --externalid', async () => {
    const err = await expectReject(() =>
      BulkV2Upsert.run(['--target-org', testOrg.username, '--sobjecttype', 'Account', '--csvfile', 'upserts.csv'])
    );

    expect(err.message).to.match(/Missing required flag/);
    expect(err.message).to.include('externalid');
    expect(operateStub.called).to.be.false;
  });

  it('stops the spinner and rethrows when the operation fails', async () => {
    operateStub.rejects(new Error('Upsert exploded'));

    const err = await expectReject(() => BulkV2Upsert.run(baseArgs));

    expect(err.message).to.include('Upsert exploded');
    expect(spinnerStubs.stop.called).to.be.true;
  });
});
