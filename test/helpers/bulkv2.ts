import { JobInfo } from '../../src/types/bulkv2.js';

/** Build a realistic Bulk API 2.0 job info payload for command tests. */
export function mockJob(overrides: Partial<JobInfo> = {}): JobInfo {
  return {
    id: '750xx0000000044AAA',
    operation: 'insert',
    object: 'Account',
    createdById: '005xx000001Sv1',
    createdDate: new Date('2024-01-01T00:00:00Z'),
    systemModstamp: new Date('2024-01-01T00:00:00Z'),
    state: 'UploadComplete',
    concurrencyMode: 'Parallel',
    contentType: 'CSV',
    apiVersion: 59,
    contentUrl: '/services/data/v59.0/jobs/ingest/750xx0000000044AAA',
    numberRecordsProcessed: 100,
    numberRecordsFailed: 0,
    ...overrides,
  };
}

/** Assert that an async call rejects and return the error for further checks. */
export async function expectReject(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('Expected the call to reject, but it resolved');
}
