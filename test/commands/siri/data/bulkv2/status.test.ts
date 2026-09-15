import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Status from '../../../../../src/commands/siri/data/bulkv2/status.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject, mockJob } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 status', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let statusStub: SinonStub;
  let uxStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const jobId = '750xx0000000049AAA';
  const baseArgs = ['--target-org', testOrg.username, '--jobid', jobId];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    uxStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    statusStub = $$.SANDBOX.stub(BulkV2.prototype, 'status').resolves(mockJob({ id: jobId, state: 'InProgress' }));
  });

  afterEach(() => {
    $$.restore();
  });

  it('returns the job status and renders a summary', async () => {
    const result = await BulkV2Status.run(baseArgs);

    expect(result.id).to.equal(jobId);
    expect(result.state).to.equal('InProgress');
    expect(uxStubs.styledHeader.calledOnce).to.be.true;
    expect(uxStubs.styledObject.calledOnce).to.be.true;
  });

  it('calls BulkV2.status with the job ID and the default STATUS type', async () => {
    await BulkV2Status.run(baseArgs);

    expect(statusStub.calledOnceWithExactly(jobId, 'STATUS')).to.be.true;
  });

  it('upper-cases the --type flag', async () => {
    await BulkV2Status.run([...baseArgs, '--type', 'query']);

    expect(statusStub.firstCall.args[1]).to.equal('QUERY');
  });

  it('requires --jobid', async () => {
    const err = await expectReject(() => BulkV2Status.run(['--target-org', testOrg.username]));

    expect(err.message).to.match(/Missing required flag/);
    expect(statusStub.called).to.be.false;
  });

  it('stops the spinner and rethrows when the status call fails', async () => {
    statusStub.rejects(new Error('Status exploded'));

    const err = await expectReject(() => BulkV2Status.run(baseArgs));

    expect(err.message).to.include('Status exploded');
    expect(spinnerStubs.stop.called).to.be.true;
  });
});
