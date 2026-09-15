import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { BulkV2 } from '../../../../utilities/bulkv2.js';
import { JobInfo } from '../../../../types/bulkv2.js';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

// Load the specific messages for this file.
const messages = Messages.loadMessages('siri', 'siri.data.bulkv2');
export type BulkV2StatusResult = JobInfo;
type DisplaySummary = Omit<JobInfo, 'createdDate' | 'systemModstamp'> & {
  createdDate?: string;
  systemModstamp?: string;
};

export default class BulkV2Status extends SfCommand<BulkV2StatusResult> {
  public static readonly summary = messages.getMessage('status.summary');
  public static readonly description = messages.getMessage('status.description');
  public static readonly examples = messages.getMessages('status.examples');
  public static readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      char: 'a',
      summary: messages.getMessage('flags.api-version.summary'),
    }),
    jobid: Flags.string({
      char: 'i',
      summary: messages.getMessage('flags.jobid.summary'),
      description: messages.getMessage('flags.jobid.description'),
      required: true,
    }),
    type: Flags.string({
      char: 't',
      summary: messages.getMessage('flags.statustype.summary'),
      description: messages.getMessage('flags.statustype.description'),
      required: false,
      default: 'STATUS',
    }),
  };

  public async run(): Promise<BulkV2StatusResult> {
    const { flags } = await this.parse(BulkV2Status);
    this.spinner.start('Getting Status');
    try {
      const connection = flags['target-org'].getConnection(flags['api-version']);
      const bulkv2 = new BulkV2(connection);
      const jobsummary: JobInfo = await bulkv2.status(flags.jobid, flags.type.toUpperCase());
      this.statusSummary(jobsummary);
      return jobsummary;
    } catch (err) {
      throw SfError.wrap(err);
    } finally {
      this.spinner.stop();
    }
  }

  private statusSummary(summary: JobInfo): JobInfo {
    this.log('');
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    for (const field of Object.keys(summary)) {
      if (field === '$') {
        delete summary[field as keyof JobInfo];
      }
    }
    this.styledHeader(messages.getMessage('info.jobStatus'));
    // Convert Date objects to ISO strings for display

    const displaySummary: DisplaySummary = {
      ...summary,
      createdDate: summary.createdDate?.toString(),
      systemModstamp: summary.systemModstamp?.toString(),
    };
    this.styledObject(displaySummary);
    return summary;
  }
}
