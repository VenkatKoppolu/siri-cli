/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, class-methods-use-this, @typescript-eslint/member-ordering, no-await-in-loop */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Connection, SfError, Logger } from '@salesforce/core';

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
// Path separators, shell/Windows-forbidden punctuation and ASCII control characters.
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[<>:"|?*\\/\u0000-\u001f]/g;
// Windows reserved device names (CON, NUL, COM1, ...) cannot be created as files.
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

// ─── Types ───────────────────────────────────────────────────────────────────

export type FileExportOptions = {
  soqlQuery: string;
  outputDir: string;
  fileType: 'attachment' | 'contentdocument' | 'document';
  /** Max parallel downloads per chunk. Defaults to 10. */
  concurrency?: number;
  /** Max allowed file size in bytes. Defaults to 100 MB. */
  maxFileSizeBytes?: number;
};

export type FileExportResult = {
  success: boolean;
  filesExported: number;
  filesFailed: number;
  totalSize: number;
  exportDuration: number;
  errors: FileExportError[];
};

export type FileExportError = {
  fileName: string;
  recordId: string;
  error: string;
  timestamp: Date;
};

/**
 * A record returned by a SOQL query. Salesforce returns field names exactly as
 * written in the query (Id, Name, Body, VersionData, ContentDocument.Title ...),
 * so the type is intentionally open.
 */
export type FileRecord = {
  Id?: string;
  [key: string]: unknown;
};

// ─── Class ───────────────────────────────────────────────────────────────────

export class FileExport {
  private connection: Connection;
  private logger: Logger;

  public constructor(connection: Connection) {
    this.connection = connection;
    this.logger = Logger.childFromRoot(this.constructor.name);
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  /**
   * Export files from Salesforce based on file type and SOQL query.
   * Validates the output directory, fetches all paginated records,
   * then downloads files in concurrent chunks.
   *
   * Always returns a result with partial progress — never throws mid-export.
   */
  public async exportFiles(options: FileExportOptions): Promise<FileExportResult> {
    const startTime = Date.now();
    const errors: FileExportError[] = [];
    let filesExported = 0;
    let totalSize = 0;

    // Validate write permissions upfront before any API calls
    this.ensureDirectoryExists(options.outputDir);
    this.validateWritePermissions(options.outputDir);

    // fetchFileRecords paginates through all result pages via autoFetch
    const fileRecords = await this.fetchFileRecords(options);
    this.logger.info(`Found ${fileRecords.length} files to export`);

    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const { nameField } = this.getFileTypeConfig(options.fileType);
    // Track seen filenames to prevent silent overwrites
    const seenNames = new Set<string>();

    // Single loop with Promise.allSettled chunks — no Bulk API flag
    for (let i = 0; i < fileRecords.length; i += concurrency) {
      const chunk = fileRecords.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map((record) => this.downloadFile(record, options, seenNames)));

      for (let j = 0; j < results.length; j++) {
        const outcome = results[j];
        const record = chunk[j];

        if (outcome.status === 'fulfilled' && outcome.value) {
          filesExported++;
          totalSize += outcome.value.size;
        } else if (outcome.status === 'rejected') {
          const recordId = FileExport.idOf(record);
          errors.push({
            fileName: String(this.resolveFieldPath(record, nameField) ?? recordId),
            recordId,
            error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            timestamp: new Date(),
          });
        }
      }
    }

    // Always return partial results — never throw mid-export and lose progress
    return {
      success: errors.length === 0,
      filesExported,
      filesFailed: errors.length,
      totalSize,
      exportDuration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Validate that the given directory is writable.
   */
  public validateWritePermissions(dirPath: string): void {
    try {
      // Unique, owner-only probe file; 'wx' refuses to clobber anything that already exists.
      const testFile = path.join(dirPath, `.write-test-${process.pid}-${randomBytes(8).toString('hex')}`);
      fs.writeFileSync(testFile, 'test', { flag: 'wx', mode: 0o600 });
      fs.unlinkSync(testFile);
    } catch (err) {
      throw new SfError(
        `No write permissions in directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
        'PermissionError'
      );
    }
  }

  /**
   * Return field config for a given file type.
   * Throws on unknown types instead of returning an empty fallback.
   */
  public getFileTypeConfig(fileType: string): {
    queryFields: string[];
    contentField: string;
    nameField: string;
  } {
    const configs: Record<string, { queryFields: string[]; contentField: string; nameField: string }> = {
      attachment: {
        queryFields: ['Id', 'Name', 'Body'],
        contentField: 'Body',
        nameField: 'Name',
      },
      contentdocument: {
        // nameField uses the correct nested path for ContentVersion
        queryFields: ['Id', 'ContentDocument.Title', 'VersionData'],
        contentField: 'VersionData',
        nameField: 'ContentDocument.Title',
      },
      document: {
        queryFields: ['Id', 'Name', 'Body'],
        contentField: 'Body',
        nameField: 'Name',
      },
    };

    const config = configs[fileType];
    if (!config) {
      throw new SfError(`Unsupported file type: ${fileType}`, 'UnsupportedFileType');
    }
    return config;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Salesforce returns the record ID as `Id`; tolerate `id` for hand-built records. */
  private static idOf(record: FileRecord): string {
    const id = record.Id ?? record['id'];
    return id == null ? 'unknown' : String(id);
  }

  /**
   * Fetch all matching file records.
   * Uses autoFetch: true to paginate through all result pages automatically.
   */
  private async fetchFileRecords(options: FileExportOptions): Promise<FileRecord[]> {
    const { soqlQuery, fileType } = options;
    const upperQuery = soqlQuery.toUpperCase();

    if (fileType === 'attachment' && !upperQuery.includes('FROM ATTACHMENT')) {
      throw new SfError('Query must select from Attachment object', 'InvalidQuery');
    } else if (fileType === 'contentdocument' && !upperQuery.includes('FROM CONTENTVERSION')) {
      throw new SfError('Query must select from ContentVersion object', 'InvalidQuery');
    } else if (fileType === 'document' && !upperQuery.includes('FROM DOCUMENT')) {
      throw new SfError('Query must select from Document object', 'InvalidQuery');
    }

    try {
      const queryResult = await this.connection.query<FileRecord>(soqlQuery, {
        autoFetch: true,
        maxFetch: 100_000,
      });

      if (!queryResult.records || queryResult.records.length === 0) {
        this.logger.warn('No records found matching the query');
        return [];
      }

      return queryResult.records;
    } catch (err) {
      throw new SfError(
        `Failed to execute SOQL query: ${err instanceof Error ? err.message : String(err)}`,
        'QueryError'
      );
    }
  }

  /**
   * Download a single file record and write it to disk.
   *
   * Declared async so that every failure (including synchronous throws such as the
   * size guard) becomes a rejected promise that Promise.allSettled can record,
   * instead of escaping the batch loop and aborting the whole export.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async downloadFile(
    record: FileRecord,
    options: FileExportOptions,
    seenNames: Set<string>
  ): Promise<{ size: number } | null> {
    const config = this.getFileTypeConfig(options.fileType);
    const maxSize = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const recordId = FileExport.idOf(record);

    // Resolve name via config.nameField to handle nested paths like ContentDocument.Title
    const rawName = this.resolveFieldPath(record, config.nameField) ?? recordId;
    // Fall back to the record ID if sanitization leaves nothing usable (e.g. a name of "..").
    const baseName = this.sanitizeFileName(String(rawName)) || this.sanitizeFileName(recordId);

    // Deduplicate filenames by appending record ID as a suffix
    const fileName = seenNames.has(baseName) ? `${baseName}_${recordId}` : baseName;
    seenNames.add(fileName);

    const filePath = path.join(options.outputDir, fileName);

    // Resolve content via config.contentField
    const rawContent = this.resolveFieldPath(record, config.contentField);

    // Check nullish — avoids String coercion of literal "null"
    if (rawContent == null || rawContent === '') {
      this.logger.warn(`No file content for record ${recordId} (${fileName}), skipping`);
      return null;
    }

    const contentStr = String(rawContent);

    // Explicitly detect base64 — avoids silent corruption from a swallowed try/catch
    // new Uint8Array(Buffer) copies bytes and resolves to Uint8Array<ArrayBuffer>,
    // which satisfies fs.writeFileSync in TypeScript 5.6+
    const rawBuffer = this.isBase64(contentStr) ? Buffer.from(contentStr, 'base64') : Buffer.from(contentStr, 'utf-8');
    const buffer = new Uint8Array(rawBuffer);

    // Guard against OOM from unexpectedly large files
    if (buffer.length > maxSize) {
      throw new SfError(
        `File ${fileName} (${buffer.length} bytes) exceeds max allowed size of ${maxSize} bytes`,
        'FileSizeError'
      );
    }

    fs.writeFileSync(filePath, buffer);
    this.logger.debug(`Exported: ${filePath} (${buffer.length} bytes)`);

    return { size: buffer.length };
  }

  /**
   * Resolve a dot-notation field path (e.g. "ContentDocument.Title") from a record.
   */
  private resolveFieldPath(record: FileRecord, fieldPath: string): unknown {
    return fieldPath.split('.').reduce<unknown>((obj, key) => {
      if (obj !== null && typeof obj === 'object') {
        return (obj as Record<string, unknown>)[key];
      }
      return undefined;
    }, record);
  }

  /**
   * Return true if a string is valid base64.
   * Replaces the silent-corruption try/catch pattern.
   */
  private isBase64(str: string): boolean {
    return str.length > 0 && str.length % 4 === 0 && BASE64_REGEX.test(str);
  }

  /**
   * Sanitize a filename to block directory traversal and invalid characters.
   * Strips / and \ in addition to the standard forbidden set.
   */
  private sanitizeFileName(fileName: string): string {
    const sanitized = fileName
      .replace(INVALID_FILENAME_CHARS, '_')
      .replace(/\.\./g, '_')
      .replace(/^\.+/, '_')
      .trim()
      .substring(0, 255);
    return WINDOWS_RESERVED_NAMES.test(sanitized) ? `_${sanitized}` : sanitized;
  }

  /**
   * Create the output directory if it does not exist.
   * Uses mkdirSync with recursive:true unconditionally — idempotent, no TOCTOU race.
   */
  private ensureDirectoryExists(dirPath: string): void {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (err) {
      throw new SfError(
        `Failed to create output directory: ${err instanceof Error ? err.message : String(err)}`,
        'DirectoryError'
      );
    }

    if (!fs.statSync(dirPath).isDirectory()) {
      throw new SfError(`${dirPath} exists but is not a directory`, 'DirectoryError');
    }
  }
}
