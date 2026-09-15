import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import BulkV2Query from '../../../../../src/commands/siri/data/bulkv2/query.js';
import { BulkV2 } from '../../../../../src/utilities/bulkv2.js';
import { expectReject, mockJob } from '../../../../helpers/bulkv2.js';

describe('siri data bulkv2 query', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let operateStub: SinonStub;
  let spinnerStubs: ReturnType<typeof stubSpinner>;

  const soql = 'SELECT Id, Name FROM Account';
  const baseArgs = ['--target-org', testOrg.username, '--sobjecttype', 'Account', '--query', soql];

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    operateStub = $$.SANDBOX.stub(BulkV2.prototype, 'operate').resolves(
      mockJob({ operation: 'query', state: 'JobComplete' })
    );
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs the query and returns the job info', async () => {
    const result = await BulkV2Query.run(baseArgs);

    expect(result.id).to.equal('750xx0000000044AAA');
    expect(result.operation).to.equal('query');
  });

  it('passes the SOQL and defaults to BulkV2.operate', async () => {
    await BulkV2Query.run(baseArgs);

    expect(operateStub.firstCall.args[0]).to.deep.equal({
      csvfile: undefined,
      sobjecttype: 'Account',
      operation: 'query',
      query: soql,
      lineending: 'LF',
      delimiter: 'COMMA',
    });
  });

  it('forwards --outputfile as the CSV destination', async () => {
    await BulkV2Query.run([...baseArgs, '--outputfile', 'out.csv']);

    expect(operateStub.firstCall.args[0]).to.include({ csvfile: 'out.csv' });
  });

  it('requires --query', async () => {
    const err = await expectReject(() =>
      BulkV2Query.run(['--target-org', testOrg.username, '--sobjecttype', 'Account'])
    );

    expect(err.message).to.match(/Missing required flag/);
    expect(operateStub.called).to.be.false;
  });

  it('stops the spinner and rethrows when the operation fails', async () => {
    operateStub.rejects(new Error('Query exploded'));

    const err = await expectReject(() => BulkV2Query.run(baseArgs));

    expect(err.message).to.include('Query exploded');
    expect(spinnerStubs.stop.called).to.be.true;
  });
});
