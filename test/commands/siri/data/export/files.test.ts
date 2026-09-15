import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { SinonStub } from 'sinon';
import { Connection } from '@salesforce/core';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import SiriDataExportFiles from '../../../../../src/commands/siri/data/export/files.js';
import { expectReject } from '../../../../helpers/bulkv2.js';

type QueryResult = Awaited<ReturnType<Connection['query']>>;

const asQueryResult = (records: unknown[]): QueryResult =>
  ({ done: true, totalSize: records.length, records } as unknown as QueryResult);

// Only SOQL against the file objects belongs to the export; org resolution may run
// its own queries through the same stubbed Connection.query.
const EXPORT_SOQL = /FROM (Attachment|ContentVersion|Document)\b/i;

describe('siri data export files', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let queryStub: SinonStub;
  let uxStubs: ReturnType<typeof stubSfCommandUx>;
  let outputDir: string;
  let exportRecords: unknown[];

  const attachmentRecords = [
    { Id: '00P000000000001AAA', Name: 'file1.txt', Body: Buffer.from('test content').toString('base64') },
  ];

  const exportQueryCount = (): number => queryStub.getCalls().filter((c) => EXPORT_SOQL.test(String(c.args[0]))).length;

  const argsFor = (...extra: string[]): string[] => [
    '--target-org',
    testOrg.username,
    '--filetype',
    'attachment',
    '--query',
    'SELECT Id, Name, Body FROM Attachment',
    '--output-dir',
    outputDir,
    ...extra,
  ];

  beforeEach(async () => {
    // Earlier tests (and SfCommand's own error handler) may have set a failure exit code.
    process.exitCode = undefined;
    exportRecords = attachmentRecords;
    await $$.stubAuths(testOrg);
    uxStubs = stubSfCommandUx($$.SANDBOX);
    stubSpinner($$.SANDBOX);
    const fakeQuery = (soql: unknown): Promise<QueryResult> =>
      Promise.resolve(EXPORT_SOQL.test(String(soql)) ? asQueryResult(exportRecords) : asQueryResult([]));
    queryStub = $$.SANDBOX.stub(Connection.prototype, 'query').callsFake(fakeQuery as unknown as Connection['query']);
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siri-export-cmd-'));
  });

  afterEach(() => {
    $$.restore();
    fs.rmSync(outputDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('exports attachments into the output directory', async () => {
    await SiriDataExportFiles.run(argsFor());

    expect(exportQueryCount()).to.equal(1);
    expect(fs.readFileSync(path.join(outputDir, 'file1.txt'), 'utf8')).to.equal('test content');
    const logged = uxStubs.log.getCalls().map((c) => String(c.args[0]));
    expect(logged.some((l) => l.includes('File Export Summary'))).to.be.true;
    expect(process.exitCode).to.be.undefined;
  });

  it('logs the result as JSON when --json is set', async () => {
    await SiriDataExportFiles.run(argsFor('--json'));

    const logged = uxStubs.log.getCalls().map((c) => String(c.args[0]));
    const jsonLine = logged.find((l) => l.includes('filesExported'));
    expect(jsonLine).to.exist;
    expect(JSON.parse(jsonLine ?? '{}')).to.include({ success: true, filesExported: 1, filesFailed: 0 });
  });

  it('supports the contentdocument file type with nested title resolution', async () => {
    exportRecords = [
      {
        Id: '068000000000001AAA',
        ContentDocument: { Title: 'doc.pdf' },
        VersionData: Buffer.from('pdf data').toString('base64'),
      },
    ];

    await SiriDataExportFiles.run([
      '--target-org',
      testOrg.username,
      '--filetype',
      'contentdocument',
      '--query',
      'SELECT Id, ContentDocument.Title, VersionData FROM ContentVersion',
      '--output-dir',
      outputDir,
    ]);

    expect(fs.readFileSync(path.join(outputDir, 'doc.pdf'), 'utf8')).to.equal('pdf data');
  });

  it('sets a non-zero exit code when some files fail', async () => {
    exportRecords = [
      ...attachmentRecords,
      { Id: '00P000000000002AAA', Name: 'huge.bin', Body: Buffer.alloc(64).toString('base64') },
    ];

    await SiriDataExportFiles.run(argsFor('--max-file-size', '32'));

    expect(process.exitCode).to.equal(1);
    const logged = uxStubs.log.getCalls().map((c) => String(c.args[0]));
    expect(logged.some((l) => l.includes('huge.bin') && l.includes('exceeds max allowed size'))).to.be.true;
  });

  it('rejects an unsupported --filetype value', async () => {
    const err = await expectReject(() =>
      SiriDataExportFiles.run([
        '--target-org',
        testOrg.username,
        '--filetype',
        'spreadsheet',
        '--query',
        'SELECT Id FROM Attachment',
        '--output-dir',
        outputDir,
      ])
    );

    expect(err.message).to.match(/Expected --filetype=spreadsheet to be one of/);
    expect(exportQueryCount()).to.equal(0);
  });

  it('requires --filetype, --query and --output-dir', async () => {
    const cases = [
      ['--target-org', testOrg.username, '--query', 'SELECT Id FROM Attachment', '--output-dir', outputDir],
      ['--target-org', testOrg.username, '--filetype', 'attachment', '--output-dir', outputDir],
      ['--target-org', testOrg.username, '--filetype', 'attachment', '--query', 'SELECT Id FROM Attachment'],
    ];
    for (const args of cases) {
      // eslint-disable-next-line no-await-in-loop
      const err = await expectReject(() => SiriDataExportFiles.run(args));
      expect(err.message).to.match(/Missing required flag/);
    }
    expect(exportQueryCount()).to.equal(0);
  });
});
