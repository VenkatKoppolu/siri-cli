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
  let uxStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const baseArgs = ['--target-org', testOrg.username, '--sobjecttype', 'Account', '--csvfile', 'test.csv'];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    uxStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    operateStub = $$.SANDBOX.stub(BulkV2.prototype, 'operate').resolves(mockJob({ operation: 'insert' }));
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs the insert and returns the job info', async () => {
    const result = await BulkV2Insert.run(baseArgs);

    expect(result.id).to.equal('750xx0000000044AAA');
    expect(result.operation).to.equal('insert');
    expect(result.state).to.equal('UploadComplete');
    expect(uxStubs.log.calledOnce).to.be.true;
    expect(spinnerStubs.start.called).to.be.true;
    expect(spinnerStubs.stop.called).to.be.true;
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
