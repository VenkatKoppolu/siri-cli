import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Results from '../../../../../src/commands/siri/data/bulkv2/results.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 results', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let resultsStub: SinonStub;
  let uxStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const jobId = '750xx0000000044AAA';
  const baseArgs = ['--target-org', testOrg.username, '--jobid', jobId, '--outputfile', 'results.csv'];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    uxStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    resultsStub = $$.SANDBOX.stub(BulkV2.prototype, 'results').resolves(true);
  });

  afterEach(() => {
    $$.restore();
  });

  it('fetches results with the default SUCCESS type and logs the output file', async () => {
    await BulkV2Results.run(baseArgs);

    expect(resultsStub.calledOnceWithExactly(jobId, 'SUCCESS', 'results.csv')).to.be.true;
    expect(uxStubs.log.calledOnce).to.be.true;
    expect(String(uxStubs.log.firstCall.args[0])).to.include('results.csv');
  });

  it('upper-cases the --type flag before calling BulkV2.results', async () => {
    await BulkV2Results.run([...baseArgs, '--type', 'failed']);

    expect(resultsStub.firstCall.args[1]).to.equal('FAILED');
  });

  it('does not log a success message when the job is still running', async () => {
    resultsStub.resolves(false);

    await BulkV2Results.run(baseArgs);

    expect(uxStubs.log.called).to.be.false;
  });

  it('requires --jobid and --outputfile', async () => {
    const missingJob = await expectReject(() =>
      BulkV2Results.run(['--target-org', testOrg.username, '--outputfile', 'results.csv'])
    );
    const missingFile = await expectReject(() =>
      BulkV2Results.run(['--target-org', testOrg.username, '--jobid', jobId])
    );

    expect(missingJob.message).to.match(/Missing required flag/);
    expect(missingFile.message).to.match(/Missing required flag/);
    expect(resultsStub.called).to.be.false;
  });

  it('stops the spinner and rethrows when fetching fails', async () => {
    resultsStub.rejects(new Error('Results exploded'));

    const err = await expectReject(() => BulkV2Results.run(baseArgs));

    expect(err.message).to.include('Results exploded');
    expect(spinnerStubs.stop.called).to.be.true;
  });
});
