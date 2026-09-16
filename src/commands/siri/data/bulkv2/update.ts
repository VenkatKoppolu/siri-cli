import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { BulkV2 } from '../../../../utilities/bulkv2.js';
import { BulkV2Input, JobInfo } from '../../../../types/bulkv2.js';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

// Load the specific messages for this file.
const messages = Messages.loadMessages('siri', 'siri.data.bulkv2');
export type BulkV2UpdateResult = JobInfo;

export default class BulkV2Update extends SfCommand<BulkV2UpdateResult> {
  public static readonly summary = messages.getMessage('update.summary');
  public static readonly description = messages.getMessage('update.description');
  public static readonly examples = messages.getMessages('update.examples');

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
  };

  public async run(): Promise<BulkV2UpdateResult> {
    const { flags } = await this.parse(BulkV2Update);
    this.spinner.start('BulkV2 Update');
    try {
      const connection = flags['target-org'].getConnection(flags['api-version']);
      const bulkv2 = new BulkV2(connection);
      const input: BulkV2Input = {
        sobjecttype: flags.sobjecttype,
        operation: 'update',
        csvfile: flags.csvfile,
        lineending: flags.lineending,
        delimiter: flags.columndelimiter,
      };
      const response: JobInfo = await bulkv2.operate(input);
      this.log(messages.getMessage('info.jobDetails', [response.id, response.id]));
      return response;
    } catch (err) {
      throw SfError.wrap(err);
    } finally {
      this.spinner.stop();
    }
  }
}
