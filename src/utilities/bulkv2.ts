import * as fs from 'node:fs';
import * as os from 'node:os';
import * as util from 'node:util';
import * as readline from 'node:readline';
import path, { resolve as pathResolve } from 'node:path';
import { Connection, Logger, Messages, SfError } from '@salesforce/core';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { BulkV2Input, JobInfo } from '../types/bulkv2.js';
import { Common } from './common.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('siri', 'siri.data.bulkv2');

// Max size (MB) of a single CSV chunk uploaded to the Bulk API 2.0 ingest endpoint.
// Kept under the 150 MB API limit while minimizing the number of jobs a large
// input CSV is split into. Splitting only kicks in above this size.
const MAX_CHUNK_MB = 100;
const MAX_CHUNK_BYTES = MAX_CHUNK_MB * 1024 * 1024;

const logger = (await Logger.child('Org')).getRawLogger();

enum ENDPOINT {
  QUERY = '%s/services/data/v%s/jobs/query',
  QUERY_STATUS = '%s/services/data/v%s/jobs/query/%s',
  QUERY_RESULT = '%s/services/data/v%s/jobs/query/%s/results',

  CREATE = '%s/services/data/v%s/jobs/ingest',
  UPLOAD = '%s/services/data/v%s/jobs/ingest/%s/batches',
  STATUS = '%s/services/data/v%s/jobs/ingest/%s',
  // CLOSE = '%s/services/data/v%s/jobs/ingest/%s',
  // ABORT = '%s/services/data/v%s/jobs/ingest/%s',
  // DELETE = '%s/services/data/v%s/jobs/ingest/%s',
  FAILED = '%s/services/data/v%s/jobs/ingest/%s/failedResults',
  UNPROCESSED = '%s/services/data/v%s/jobs/ingest/%s/unprocessedrecords',
  SUCCESS = '%s/services/data/v%s/jobs/ingest/%s/successfulResults',
}

export class BulkV2 {
  private conn: Connection;
  private query: boolean = false;
  // Temp chunk files created by checkFileSizeAndAct; removed by cleanupTempFiles.
  private tempFiles: string[] = [];
  // Max bytes per split chunk. Defaults to the API-safe cap; overridable for tests.
  private maxChunkBytes: number = MAX_CHUNK_BYTES;

  public constructor(conn: Connection) {
    this.conn = conn;
  }

  public static async fastFileWrite(file: string, data: NodeJS.ReadableStream): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const filePath = path.resolve(Common.cwd, file);
      const writeStream = fs.createWriteStream(filePath, { flags: 'w' });
      data.pipe(writeStream);
      writeStream.on('close', () => {
        resolvePromise();
      });
      writeStream.on('error', (err) => {
        reject(new SfError(`Failed to write file: ${err.message}`, 'FileWriteError'));
      });
    });
  }

  public static generateRequestBody(input: BulkV2Input): string {
    let requestBody: Record<string, string>;

    if (input.operation === 'upsert') {
      requestBody = {
        object: input.sobjecttype,
        externalIdFieldName: input.externalid ?? '',
        operation: input.operation,
        lineEnding: input.lineending ?? 'LF',
        columnDelimiter: input.delimiter ?? 'COMMA',
      };
    } else if (input.operation === 'query') {
      requestBody = {
        operation: 'query',
        query: input.query ?? '',
        contentType: 'CSV',
        columnDelimiter: input.delimiter ?? 'COMMA',
        lineEnding: input.lineending ?? 'LF',
      };
    } else {
      requestBody = {
        object: input.sobjecttype,
        operation: input.operation,
        lineEnding: input.lineending ?? 'LF',
        columnDelimiter: input.delimiter ?? 'COMMA',
      };
    }

    return JSON.stringify(requestBody);
  }

  /**
   * Convert an error from an axios call into an SfError that includes the
   * Salesforce response body (e.g. [{ errorCode, message }]) instead of the
   * opaque "Request failed with status code 4xx" message.
   */
  private static toSfError(err: unknown, context: string): SfError {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body: unknown = err.response?.data;
      const detail =
        body === undefined || body === null || body === ''
          ? err.message
          : typeof body === 'string'
          ? body
          : JSON.stringify(body);
      const sfErr = new SfError(
        `${context} failed${status !== undefined ? ` (HTTP ${status})` : ''}: ${detail}`,
        'BulkApiError'
      );
      // Preserve the original error so its stack is available (shown with --dev-debug).
      sfErr.cause = err;
      return sfErr;
    }
    const base = err instanceof Error ? err : new Error(String(err));
    const sfErr = new SfError(`${context} failed: ${base.message}`, 'BulkApiError');
    sfErr.cause = base;
    return sfErr;
  }

  /**
   * Return the list of CSV files to ingest.
   *
   * Files under MAX_CHUNK_MB are used as-is. Larger files are split into chunks,
   * each under MAX_CHUNK_MB, so no single Bulk API upload exceeds the 150 MB limit.
   *
   * The input is read line-by-line via a stream and never held in memory whole;
   * at most one chunk (~MAX_CHUNK_MB) is buffered at a time. The original header
   * row is preserved on every chunk. Chunks are written to unique paths in the OS
   * temp directory and tracked for later removal via {@link cleanupTempFiles}.
   */
  public async checkFileSizeAndAct(filename: string): Promise<string[]> {
    const absPath = pathResolve(process.cwd(), filename);
    if (this.getFilesizeInMegaBytes(absPath) < MAX_CHUNK_MB) {
      return [filename];
    }

    const rl = readline.createInterface({
      input: fs.createReadStream(absPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    let header: string | undefined;
    let chunkLines: string[] = [];
    let chunkBytes = 0;
    let chunkIndex = 0;

    const flushChunk = async (): Promise<void> => {
      if (chunkLines.length === 0) return;
      const tempPath = path.join(os.tmpdir(), `bulkv2-split-${process.pid}-${Date.now()}-${chunkIndex}.csv`);
      chunkIndex++;
      this.tempFiles.push(tempPath);
      await fs.promises.writeFile(tempPath, `${header ?? ''}\n${chunkLines.join('\n')}\n`, { encoding: 'utf8' });
      chunkLines = [];
      chunkBytes = 0;
    };

    try {
      for await (const line of rl) {
        // First line is the header — captured once and re-emitted on every chunk.
        if (header === undefined) {
          header = line;
          continue;
        }
        // Skip blank lines (e.g. a trailing newline) so chunks contain only records.
        if (line.trim() === '') continue;

        chunkLines.push(line);
        chunkBytes += Buffer.byteLength(line, 'utf8') + 1; // +1 for the newline

        if (chunkBytes >= this.maxChunkBytes) {
          // eslint-disable-next-line no-await-in-loop
          await flushChunk();
        }
      }
      await flushChunk();
    } catch (err) {
      // Remove any partial chunks so a failed split leaves nothing behind.
      this.cleanupTempFiles();
      throw new SfError(
        `Failed to split CSV file: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'FileSplitError'
      );
    } finally {
      rl.close();
    }

    return [...this.tempFiles];
  }

  /**
   * Remove all temp chunk files created by {@link checkFileSizeAndAct}.
   * Best-effort: individual removal failures are ignored. Safe to call more than once.
   */
  public cleanupTempFiles(): void {
    for (const file of this.tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Best-effort cleanup — ignore removal errors.
      }
    }
    this.tempFiles = [];
  }

  public async operate(input: BulkV2Input): Promise<JobInfo> {
    if (input.operation === 'query') {
      this.query = true;
      let job: JobInfo = await this.createJob(input);
      job = await this.status(job.id, 'QUERY_STATUS');
      if (job.state === 'JobComplete' && input.csvfile) {
        await this.results(job.id, 'QUERY_RESULT', input.csvfile);
      } else {
        logger.info(messages.getMessage('info.jobStatusInfo', [job.id, job.state]));
      }
      return job;
    } else {
      let job: JobInfo = await this.createJob(input);
      job = await this.uploadJob(job, input.csvfile);
      job = await this.patchJob(job);
      job = await this.status(job.id, '');
      return job;
    }
  }

  public async moreResults(
    endpoint: string,
    locator: string,
    file: string
  ): Promise<AxiosResponse<NodeJS.ReadableStream>> {
    try {
      const config: AxiosRequestConfig = this.generateConfig('text/csv');
      config.responseType = 'stream';
      const response = await axios.get<NodeJS.ReadableStream>(endpoint + '?locator=' + locator, {
        ...config,
        responseType: 'stream',
      });
      await BulkV2.fastFileWrite(file, response.data);
      return response;
    } catch (err) {
      throw new SfError(
        `Failed to fetch more results: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'FetchResultsError'
      );
    }
  }

  public async results(jobid: string, type: string, file: string): Promise<boolean> {
    this.query = type.includes('QUERY');
    const job: JobInfo = await this.status(jobid, this.query ? 'QUERY_STATUS' : '');
    if (!(job.state === 'JobComplete' || job.state === 'Failed')) {
      logger.info(messages.getMessage('info.jobStatusInfo', [job.id, job.state]));
      return false;
    }

    const endpoint: string = this.generateEndpoint(type, jobid);
    const config: AxiosRequestConfig = this.generateConfig('application/json');
    config.responseType = 'stream';

    return new Promise<boolean>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      axios.get<NodeJS.ReadableStream>(endpoint, config).then(
        (response: AxiosResponse<NodeJS.ReadableStream>) => {
          this.processResultsRecursive(file, response, endpoint)
            .then((success) => resolve(success))
            .catch((err) => reject(err));
        },
        (err) => {
          reject(
            new SfError(
              `Failed to fetch results: ${err instanceof Error ? err.message : 'Unknown error'}`,
              'FetchError'
            )
          );
        }
      );
    });
  }

  public async status(jobid: string, type: string): Promise<JobInfo> {
    this.query = type.includes('QUERY');
    const endpoint: string = this.generateEndpoint(this.query ? 'QUERY_STATUS' : 'STATUS', jobid);
    const config: AxiosRequestConfig = this.generateConfig('application/json');
    const response: AxiosResponse<JobInfo> = await axios.get<JobInfo>(endpoint, config);
    if (response?.status !== 200) {
      response.data.errorMessage = (response?.statusText ?? '') + (response.data.errorMessage ?? '');
    }
    return response.data;
  }

  private async processResultsRecursive(
    file: string,
    response: AxiosResponse<NodeJS.ReadableStream>,
    endpoint: string
  ): Promise<boolean> {
    try {
      await BulkV2.fastFileWrite(file, response.data);
      // Salesforce Bulk API 2.0 returns the literal string 'null' in the
      // Sforce-Locator header once the final page has been reached.
      const normalizeLocator = (value: unknown): string => {
        const str = (value as string) || '';
        return str === 'null' ? '' : str;
      };
      let locator: string = normalizeLocator(response.headers['sforce-locator']);
      const filename = file.substring(0, file.length - 4);
      let i = 0;

      while (locator !== '') {
        i++;
        const nextFile = filename + i + '.csv';
        // eslint-disable-next-line no-await-in-loop
        const res = await this.moreResults(endpoint, locator, nextFile);
        locator = normalizeLocator(res.headers['sforce-locator']);
      }
      return true;
    } catch (err) {
      throw new SfError(
        `Error processing results: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'ResultsError'
      );
    }
  }

  private async patchJob(job: JobInfo): Promise<JobInfo> {
    const data: string = JSON.stringify({ state: 'UploadComplete' });
    const config: AxiosRequestConfig = this.generateConfig('application/json');
    const endpoint: string = this.generateEndpoint('STATUS', job.id);
    try {
      const response: AxiosResponse<JobInfo> = await axios.patch<JobInfo>(endpoint, data, config);
      const updatedJob: JobInfo = response.data;
      if (response.status !== 200) {
        updatedJob.errorMessage = response.statusText;
      }
      return updatedJob;
    } catch (err) {
      throw BulkV2.toSfError(err, 'Marking job UploadComplete');
    }
  }

  private async createJob(input: BulkV2Input): Promise<JobInfo> {
    const data: string = BulkV2.generateRequestBody(input);
    const config: AxiosRequestConfig = this.generateConfig('application/json');
    const endpoint: string = this.generateEndpoint(this.query ? 'QUERY' : 'CREATE');
    try {
      const response: AxiosResponse<JobInfo> = await axios.post(endpoint, data, config);
      return response.data;
    } catch (err) {
      throw BulkV2.toSfError(err, 'Creating bulk job');
    }
  }

  private async uploadJob(job: JobInfo, file: string | undefined): Promise<JobInfo> {
    if (file === undefined) {
      throw new SfError('No file available', 'NoFileError');
    }
    const filePath = path.resolve(Common.cwd, file);
    // Stream the CSV rather than buffering it, so upload memory stays flat
    // regardless of chunk size. Salesforce's ingest endpoint requires an
    // explicit Content-Length, so set it from the file size upfront.
    const { size } = fs.statSync(filePath);
    const data = fs.createReadStream(filePath);
    const config: AxiosRequestConfig = this.generateConfig('text/csv');
    config.headers = { ...config.headers, 'Content-Length': String(size) };
    const endpoint: string = this.generateEndpoint('UPLOAD', job.id);
    try {
      const response: AxiosResponse = await axios.put(endpoint, data, config);
      const updatedJob: JobInfo = { ...job };
      if (response.status !== 201) {
        updatedJob.errorMessage = response.statusText;
      }
      return updatedJob;
    } catch (err) {
      throw BulkV2.toSfError(err, 'Uploading job data');
    }
  }

  private generateConfig(contentType: string): AxiosRequestConfig {
    if (!this.conn.accessToken) {
      throw new SfError('No access token available', 'NoAccessToken');
    }

    const config: AxiosRequestConfig = {
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${this.conn.accessToken}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    };
    return config;
  }

  private generateEndpoint(operation: string, jobid: string = ''): string {
    const instanceUrl = this.conn.instanceUrl;
    const apiVersion = this.conn.getApiVersion();

    if (!instanceUrl) {
      throw new SfError('No instance URL available', 'NoInstanceUrl');
    }

    const baseParams = [instanceUrl, apiVersion, jobid];
    let endpoint: string;

    switch (operation) {
      case 'QUERY':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.QUERY as any, ...baseParams).trim();
        break;
      case 'QUERY_STATUS':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.QUERY_STATUS as any, ...baseParams).trim();
        break;
      case 'QUERY_RESULT':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.QUERY_RESULT as any, ...baseParams).trim();
        break;
      case 'CREATE':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.CREATE as any, ...baseParams).trim();
        break;
      case 'UPLOAD':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.UPLOAD as any, ...baseParams).trim();
        break;
      case 'STATUS':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.STATUS as any, ...baseParams).trim();
        break;
      case 'SUCCESS':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.SUCCESS as any, ...baseParams).trim();
        break;
      case 'FAILED':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.FAILED as any, ...baseParams).trim();
        break;
      case 'UNPROCESSED':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint = util.format(ENDPOINT.UNPROCESSED as any, ...baseParams).trim();
        break;
      default:
        throw new SfError(`Unknown operation: ${operation}`, 'UnknownOperation');
    }

    return endpoint;
  }

  // eslint-disable-next-line class-methods-use-this
  private getFilesizeInMegaBytes(filename: string): number {
    const stats = fs.statSync(filename);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes / (1024 * 1024);
  }
}
