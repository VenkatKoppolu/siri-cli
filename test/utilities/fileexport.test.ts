/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import { Connection, SfError } from '@salesforce/core';
import { stubInterface, fromStub, type StubbedType } from '@salesforce/ts-sinon';
import { FileExport, FileExportOptions } from '../../src/utilities/fileexport.js';

const b64 = (s: string): string => Buffer.from(s).toString('base64');

describe('FileExport Utility', () => {
  let sandbox: sinon.SinonSandbox;
  let connectionStub: StubbedType<Connection>;
  let fileExport: FileExport;
  let testDir: string;

  const attachmentOptions = (overrides: Partial<FileExportOptions> = {}): FileExportOptions => ({
    soqlQuery: 'SELECT Id, Name, Body FROM Attachment',
    outputDir: testDir,
    fileType: 'attachment',
    ...overrides,
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    connectionStub = stubInterface<Connection>(sandbox);
    fileExport = new FileExport(fromStub(connectionStub));
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siri-fileexport-test-'));
  });

  afterEach(() => {
    sandbox.restore();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('exportFiles', () => {
    it('should export attachment files successfully', async () => {
      const mockRecords = [
        { Id: '00P000000000001AAA', Name: 'file1.txt', Body: b64('test content 1') },
        { Id: '00P000000000002AAA', Name: 'file2.txt', Body: b64('test content 2') },
      ];
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(attachmentOptions());

      expect(result.filesExported).to.equal(2);
      expect(result.filesFailed).to.equal(0);
      expect(result.success).to.be.true;
      expect(fs.readFileSync(path.join(testDir, 'file1.txt'), 'utf8')).to.equal('test content 1');
      expect(fs.readFileSync(path.join(testDir, 'file2.txt'), 'utf8')).to.equal('test content 2');
    });

    it('should export ContentDocument files using the nested title', async () => {
      const mockRecords = [
        {
          Id: '068000000000001AAA',
          ContentDocument: { Title: 'document.pdf' },
          VersionData: b64('pdf content'),
        },
      ];
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(
        attachmentOptions({
          soqlQuery: 'SELECT Id, ContentDocument.Title, VersionData FROM ContentVersion',
          fileType: 'contentdocument',
        })
      );

      expect(result.filesExported).to.equal(1);
      expect(result.success).to.be.true;
      expect(fs.readFileSync(path.join(testDir, 'document.pdf'), 'utf8')).to.equal('pdf content');
    });

    it('should skip records without content and keep going', async () => {
      const mockRecords = [
        { Id: '00P000000000001AAA', Name: 'empty.txt', Body: '' },
        { Id: '00P000000000002AAA', Name: 'file2.txt', Body: b64('valid content') },
      ];
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(attachmentOptions());

      expect(result.filesExported).to.equal(1);
      expect(result.filesFailed).to.equal(0);
      expect(fs.existsSync(path.join(testDir, 'empty.txt'))).to.be.false;
    });

    it('should record per-file failures without aborting the export', async () => {
      const mockRecords = [
        { Id: '00P000000000001AAA', Name: 'small.txt', Body: b64('ok') },
        { Id: '00P000000000002AAA', Name: 'large.bin', Body: b64('x'.repeat(64)) },
      ];
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(attachmentOptions({ maxFileSizeBytes: 16 }));

      expect(result.success).to.be.false;
      expect(result.filesExported).to.equal(1);
      expect(result.filesFailed).to.equal(1);
      expect(result.errors[0]).to.include({ fileName: 'large.bin', recordId: '00P000000000002AAA' });
      expect(result.errors[0].error).to.include('exceeds max allowed size');
    });

    it('should de-duplicate colliding file names with the record ID', async () => {
      const mockRecords = [
        { Id: '00P000000000001AAA', Name: 'same.txt', Body: b64('first') },
        { Id: '00P000000000002AAA', Name: 'same.txt', Body: b64('second') },
      ];
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(attachmentOptions({ concurrency: 1 }));

      expect(result.filesExported).to.equal(2);
      expect(fs.readFileSync(path.join(testDir, 'same.txt'), 'utf8')).to.equal('first');
      expect(fs.readFileSync(path.join(testDir, 'same.txt_00P000000000002AAA'), 'utf8')).to.equal('second');
    });

    it('should never write outside the output directory', async () => {
      const mockRecords = [{ Id: '00P000000000001AAA', Name: '../../escape.txt', Body: b64('nope') }];
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(attachmentOptions());

      expect(result.filesExported).to.equal(1);
      expect(fs.existsSync(path.join(testDir, '..', '..', 'escape.txt'))).to.be.false;
      const written = fs.readdirSync(testDir);
      expect(written).to.have.length(1);
      expect(written[0]).to.not.include('..');
      expect(written[0]).to.not.include('/');
      expect(written[0].endsWith('escape.txt')).to.be.true;
    });

    it('should create output directory if it does not exist', async () => {
      const newDir = path.join(testDir, 'nested', 'newdir');
      (connectionStub.query as sinon.SinonStub).resolves({
        records: [{ Id: '00P000000000001AAA', Name: 'file1.txt', Body: b64('content') }],
      });

      const result = await fileExport.exportFiles(attachmentOptions({ outputDir: newDir }));

      expect(fs.existsSync(path.join(newDir, 'file1.txt'))).to.be.true;
      expect(result.filesExported).to.equal(1);
    });

    it('should handle large batches', async () => {
      const mockRecords = Array.from({ length: 150 }, (_, i) => ({
        Id: `00P00000000${String(i).padStart(4, '0')}AAA`,
        Name: `file${i}.txt`,
        Body: b64(`content ${i}`),
      }));
      (connectionStub.query as sinon.SinonStub).resolves({ records: mockRecords });

      const result = await fileExport.exportFiles(attachmentOptions({ concurrency: 25 }));

      expect(result.filesExported).to.equal(150);
      expect(result.filesFailed).to.equal(0);
    });
  });

  describe('sanitizeFileName', () => {
    it('should remove invalid characters from filename', () => {
      const testCases = [
        { input: 'file<name>.txt', expected: 'file_name_.txt' },
        { input: 'file|name?.txt', expected: 'file_name_.txt' },
        { input: '..evil.txt', expected: '_evil.txt' },
        { input: 'a/b\\c.txt', expected: 'a_b_c.txt' },
        { input: 'ctl\u0000char.txt', expected: 'ctl_char.txt' },
        { input: 'CON', expected: '_CON' },
        { input: 'nul.txt', expected: '_nul.txt' },
      ];

      testCases.forEach(({ input, expected }) => {
        const sanitized = (fileExport as any).sanitizeFileName(input);
        expect(sanitized).to.equal(expected);
      });
    });

    it('should truncate long filenames to 255 characters', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const sanitized = (fileExport as any).sanitizeFileName(longName);
      expect(sanitized.length).to.equal(255);
    });
  });

  describe('validateWritePermissions', () => {
    it('should verify write permissions on directory', () => {
      expect(() => fileExport.validateWritePermissions(testDir)).to.not.throw();
      expect(fs.readdirSync(testDir)).to.deep.equal([]);
    });

    it('should throw error if directory is not writable', function () {
      if (process.platform === 'win32' || process.getuid?.() === 0) {
        this.skip();
      }
      const readOnlyDir = path.join(testDir, 'readonly');
      fs.mkdirSync(readOnlyDir);
      fs.chmodSync(readOnlyDir, 0o444);

      try {
        expect(() => fileExport.validateWritePermissions(readOnlyDir)).to.throw(SfError);
      } finally {
        fs.chmodSync(readOnlyDir, 0o755);
      }
    });
  });

  describe('getFileTypeConfig', () => {
    it('should return correct config for attachment type', () => {
      const config = fileExport.getFileTypeConfig('attachment');
      expect(config.nameField).to.equal('Name');
      expect(config.contentField).to.equal('Body');
      expect(config.queryFields).to.include.members(['Id', 'Name', 'Body']);
    });

    it('should return correct config for contentdocument type', () => {
      const config = fileExport.getFileTypeConfig('contentdocument');
      expect(config.contentField).to.equal('VersionData');
      expect(config.nameField).to.equal('ContentDocument.Title');
      expect(config.queryFields).to.include('VersionData');
    });

    it('should throw for an unknown type', () => {
      expect(() => fileExport.getFileTypeConfig('unknown')).to.throw(SfError, 'Unsupported file type');
    });
  });

  describe('Query validation', () => {
    it('should reject invalid query for attachment type', async () => {
      (connectionStub.query as sinon.SinonStub).resolves({ records: [] });

      try {
        await fileExport.exportFiles(attachmentOptions({ soqlQuery: 'SELECT Id FROM Account' }));
        expect.fail('Should have thrown error');
      } catch (err) {
        expect((err as SfError).message).to.include('Query must select from Attachment');
      }
      expect((connectionStub.query as sinon.SinonStub).called).to.be.false;
    });
  });

  describe('File content handling', () => {
    it('should decode base64 encoded content', async () => {
      const originalContent = 'Hello, World!';
      (connectionStub.query as sinon.SinonStub).resolves({
        records: [{ Id: '00P000000000001AAA', Name: 'test.txt', Body: b64(originalContent) }],
      });

      const result = await fileExport.exportFiles(attachmentOptions());

      expect(result.filesExported).to.equal(1);
      expect(fs.readFileSync(path.join(testDir, 'test.txt'), 'utf-8')).to.equal(originalContent);
    });

    it('should write non-base64 content as UTF-8', async () => {
      const originalContent = 'こんにちは世界';
      (connectionStub.query as sinon.SinonStub).resolves({
        records: [{ Id: '00P000000000001AAA', Name: 'test.txt', Body: originalContent }],
      });

      const result = await fileExport.exportFiles(attachmentOptions());

      expect(result.filesExported).to.equal(1);
      expect(fs.readFileSync(path.join(testDir, 'test.txt'), 'utf-8')).to.equal(originalContent);
    });
  });
});
