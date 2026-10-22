import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Insert from '../../../../../src/commands/siri/data/bulkv2/insert.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject, mockJob } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 insert', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let operateStub: SinonStub;
  let checkFileSizeStub: SinonStub;
  let uxStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const baseArgs = ['--target-org', testOrg.username, '--sobjecttype', 'Account', '--csvfile', 'test.csv'];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    uxStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    operateStub = $$.SANDBOX.stub(BulkV2.prototype, 'operate').resolves(mockJob({ operation: 'insert' }));
    checkFileSizeStub = $$.SANDBOX.stub(BulkV2.prototype, 'checkFileSizeAndAct').resolves(['test.csv']);
    $$.SANDBOX.stub(BulkV2.prototype, 'cleanupTempFiles');
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs the insert and returns one job per file', async () => {
    const result = await BulkV2Insert.run(baseArgs);

    expect(result).to.have.length(1);
    expect(result[0].id).to.equal('750xx0000000044AAA');
    expect(result[0].operation).to.equal('insert');
    expect(result[0].state).to.equal('UploadComplete');
    expect(uxStubs.log.calledOnce).to.be.true;
    expect(spinnerStubs.start.called).to.be.true;
    expect(spinnerStubs.stop.called).to.be.true;
  });

  it('splits the CSV first and runs one job per chunk', async () => {
    checkFileSizeStub.resolves(['/tmp/chunk-0.csv', '/tmp/chunk-1.csv']);

    const result = await BulkV2Insert.run(baseArgs);

    expect(checkFileSizeStub.calledOnceWithExactly('test.csv')).to.be.true;
    expect(operateStub.callCount).to.equal(2);
    expect(operateStub.secondCall.args[0]).to.include({ csvfile: '/tmp/chunk-1.csv' });
    expect(result).to.have.length(2);
  });

  it('passes the flags to BulkV2.operate with defaults applied', async () => {
    await BulkV2Insert.run(baseArgs);

    expect(operateStub.firstCall.args[0]).to.deep.equal({
      sobjecttype: 'Account',
      operation: 'insert',
      csvfile: 'test.csv',
      lineending: 'LF',
      delimiter: 'COMMA',
    });
  });

  it('honours explicit lineending and columndelimiter', async () => {
    await BulkV2Insert.run([...baseArgs, '--lineending', 'CRLF', '--columndelimiter', 'PIPE']);

    expect(operateStub.firstCall.args[0]).to.include({ lineending: 'CRLF', delimiter: 'PIPE' });
  });

  it('stops the spinner and rethrows when the operation fails', async () => {
    operateStub.rejects(new Error('Insert exploded'));

    const err = await expectReject(() => BulkV2Insert.run(baseArgs));

    expect(err.message).to.include('Insert exploded');
    expect(spinnerStubs.stop.called).to.be.true;
  });

  it('requires --sobjecttype and --csvfile', async () => {
    const missingSobject = await expectReject(() =>
      BulkV2Insert.run(['--target-org', testOrg.username, '--csvfile', 'test.csv'])
    );
    const missingCsv = await expectReject(() =>
      BulkV2Insert.run(['--target-org', testOrg.username, '--sobjecttype', 'Account'])
    );

    expect(missingSobject.message).to.match(/Missing required flag/);
    expect(missingCsv.message).to.match(/Missing required flag/);
    expect(operateStub.called).to.be.false;
  });
});
