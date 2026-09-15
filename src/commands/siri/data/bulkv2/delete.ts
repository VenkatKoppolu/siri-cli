import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { BulkV2Input, JobInfo } from '../../../../types/bulkv2.js';
import { BulkV2 } from '../../../../utilities/bulkv2.js';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

// Load the specific messages for this file.
const messages = Messages.loadMessages('siri', 'siri.data.bulkv2');
export type BulkV2DeleteResult = JobInfo;

export default class BulkV2Delete extends SfCommand<BulkV2DeleteResult[]> {
  public static readonly summary = messages.getMessage('delete.summary');
  public static readonly description = messages.getMessage('delete.description');
  public static readonly examples = messages.getMessages('delete.examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      char: 'a',
      summary: messages.getMessage('flags.api-version.summary'),
    }),
    sobjecttype: Flags.string({
      char: 's',
      summary: messages.getMessage('flags.sobjecttype.summary'),
      description: messages.getMessage('flags.sobjecttype.description'),
      required: true,
    }),
    csvfile: Flags.string({
      char: 'f',
      summary: messages.getMessage('flags.csvfile.summary'),
      description: messages.getMessage('flags.csvfile.description'),
      required: true,
    }),
    lineending: Flags.string({
      char: 'l',
      summary: messages.getMessage('flags.lineending.summary'),
      description: messages.getMessage('flags.lineending.description'),
      required: false,
      default: 'LF',
    }),
    columndelimiter: Flags.string({
      char: 'd',
      summary: messages.getMessage('flags.columndelimiter.summary'),
      description: messages.getMessage('flags.columndelimiter.description'),
      required: false,
      default: 'COMMA',
    }),
    hard: Flags.boolean({
      char: 'x',
      summary: messages.getMessage('flags.hard.summary'),
      description: messages.getMessage('flags.hard.description'),
      required: false,
      default: false,
    }),
  };

  public async run(): Promise<BulkV2DeleteResult[]> {
    const { flags } = await this.parse(BulkV2Delete);

    // Start the spinner
    this.spinner.start('BulkV2 Delete');
    const responses: JobInfo[] = [];
    let bulkv2: BulkV2 | undefined;
    try {
      // Get the Salesforce org and Connection (validated --api-version applied if given)
      const conn = flags['target-org'].getConnection(flags['api-version']);
      bulkv2 = new BulkV2(conn);
      const files: string[] = await bulkv2.checkFileSizeAndAct(flags.csvfile);

      // eslint-disable-next-line no-await-in-loop
      for (const file of files) {
        const input: BulkV2Input = {
          sobjecttype: flags.sobjecttype,
          operation: flags.hard ? 'hardDelete' : 'delete',
          csvfile: file,
          lineending: flags.lineending,
          delimiter: flags.columndelimiter,
        };
        // Perform the operation
        // eslint-disable-next-line no-await-in-loop
        const response: JobInfo = await bulkv2.operate(input);
        responses.push(response);
        this.log(messages.getMessage('info.jobDetails', [response.id, response.id]));
      }
      return responses;
    } catch (err) {
      const sfErr = SfError.wrap(err instanceof Error ? err : new Error(String(err)));
      // Print the underlying error and full stack trace, not just the summary line.
      const causeStack = sfErr.cause instanceof Error ? sfErr.cause.stack : undefined;
      const stack = causeStack ?? sfErr.stack;
      if (stack) {
        this.logToStderr(stack);
      }
      throw sfErr;
    } finally {
      // Remove any temp chunk files created when splitting a large CSV.
      bulkv2?.cleanupTempFiles();
      this.spinner.stop();
    }
  }
}
