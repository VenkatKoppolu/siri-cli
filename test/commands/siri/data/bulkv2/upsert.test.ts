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
  let checkFileSizeStub: SinonStub;
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
    checkFileSizeStub = $$.SANDBOX.stub(BulkV2.prototype, 'checkFileSizeAndAct').resolves(['upserts.csv']);
    $$.SANDBOX.stub(BulkV2.prototype, 'cleanupTempFiles');
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs the upsert and returns one job per file', async () => {
    const result = await BulkV2Upsert.run(baseArgs);

    expect(result).to.have.length(1);
    expect(result[0].id).to.equal('750xx0000000044AAA');
    expect(result[0].operation).to.equal('upsert');
  });

  it('splits the CSV first and runs one job per chunk', async () => {
    checkFileSizeStub.resolves(['/tmp/chunk-0.csv', '/tmp/chunk-1.csv']);

    const result = await BulkV2Upsert.run(baseArgs);

    expect(checkFileSizeStub.calledOnceWithExactly('upserts.csv')).to.be.true;
    expect(operateStub.callCount).to.equal(2);
    expect(operateStub.secondCall.args[0]).to.include({ csvfile: '/tmp/chunk-1.csv' });
    expect(result).to.have.length(2);
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
