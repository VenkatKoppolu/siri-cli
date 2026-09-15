/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sinon from 'sinon';
import axios from 'axios';
import { expect } from 'chai';
import { Connection, SfError } from '@salesforce/core';
import { BulkV2 } from '../../src/utilities/bulkv2.js';
import { BulkV2Input } from '../../src/types/bulkv2.js';

// BulkV2 only reads accessToken/instanceUrl/getApiVersion off the connection,
// so a minimal fake avoids depending on @salesforce/ts-sinon.
function fakeConnection(accessToken: string | undefined = 'test-token'): Connection {
  return {
    accessToken,
    instanceUrl: 'https://test.salesforce.com',
    getApiVersion: () => '59.0',
  } as unknown as Connection;
}

describe('BulkV2 Utility', () => {
  let bulkv2: BulkV2;

  beforeEach(() => {
    bulkv2 = new BulkV2(fakeConnection());
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('generateRequestBody', () => {
    it('should generate correct body for insert operation', () => {
      const input: BulkV2Input = {
        sobjecttype: 'Account',
        operation: 'insert',
        lineending: 'LF',
        delimiter: 'COMMA',
      };

      const body = BulkV2.generateRequestBody(input);
      const parsed = JSON.parse(body);

      expect(parsed).to.deep.equal({
        object: 'Account',
        operation: 'insert',
        lineEnding: 'LF',
        columnDelimiter: 'COMMA',
      });
    });

    it('should generate correct body for upsert operation', () => {
      const input: BulkV2Input = {
        sobjecttype: 'Account',
        operation: 'upsert',
        externalid: 'External_Id__c',
        lineending: 'LF',
        delimiter: 'COMMA',
      };

      const body = BulkV2.generateRequestBody(input);
      const parsed = JSON.parse(body);

      expect(parsed).to.deep.equal({
        object: 'Account',
        externalIdFieldName: 'External_Id__c',
        operation: 'upsert',
        lineEnding: 'LF',
        columnDelimiter: 'COMMA',
      });
    });

    it('should generate correct body for query operation', () => {
      const input: BulkV2Input = {
        sobjecttype: 'Account',
        operation: 'query',
        query: 'SELECT Id FROM Account',
        lineending: 'LF',
        delimiter: 'COMMA',
      };

      const body = BulkV2.generateRequestBody(input);
      const parsed = JSON.parse(body);

      expect(parsed).to.deep.equal({
        operation: 'query',
        query: 'SELECT Id FROM Account',
        contentType: 'CSV',
        columnDelimiter: 'COMMA',
        lineEnding: 'LF',
      });
    });

    it('should use defaults when values are not provided', () => {
      const input: BulkV2Input = {
        sobjecttype: 'Account',
        operation: 'update',
      };

      const body = BulkV2.generateRequestBody(input);
      const parsed = JSON.parse(body);

      expect(parsed.lineEnding).to.equal('LF');
      expect(parsed.columnDelimiter).to.equal('COMMA');
    });
  });

  describe('checkFileSizeAndAct', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulkv2-test-'));
    });

    afterEach(() => {
      bulkv2.cleanupTempFiles();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns the original file unchanged when under the split threshold', async () => {
      const file = path.join(tmpDir, 'small.csv');
      fs.writeFileSync(file, 'Id\n001\n002\n');

      const result = await bulkv2.checkFileSizeAndAct(file);

      expect(result).to.deep.equal([file]);
    });

    it('splits a large file into multiple chunks, preserving the header on each', async () => {
      const file = path.join(tmpDir, 'big.csv');
      const rows = Array.from({ length: 10 }, (_, i) => `00${i}`);
      fs.writeFileSync(file, `Id\n${rows.join('\n')}\n`);

      // Force the split branch without a real 100MB file, then shrink the chunk
      // cap so a handful of small rows still roll into several chunks.
      sinon.stub(bulkv2 as any, 'getFilesizeInMegaBytes').returns(150);
      (bulkv2 as any).maxChunkBytes = 16;

      const result = await bulkv2.checkFileSizeAndAct(file);

      expect(result.length).to.be.greaterThan(1);

      // Every chunk lives in the OS temp dir and starts with the original header.
      for (const chunk of result) {
        expect(chunk.startsWith(os.tmpdir())).to.equal(true);
        const lines = fs.readFileSync(chunk, 'utf8').split('\n').filter(Boolean);
        expect(lines[0]).to.equal('Id');
      }

      // All data rows appear exactly once across the chunks — nothing lost or duplicated.
      const dataRows = result
        .flatMap((chunk) => fs.readFileSync(chunk, 'utf8').split('\n').filter(Boolean).slice(1))
        .sort();
      expect(dataRows).to.deep.equal(rows.slice().sort());
    });

    it('cleanupTempFiles removes every generated chunk', async () => {
      const file = path.join(tmpDir, 'big.csv');
      fs.writeFileSync(file, `Id\n${Array.from({ length: 10 }, (_, i) => `00${i}`).join('\n')}\n`);
      sinon.stub(bulkv2 as any, 'getFilesizeInMegaBytes').returns(150);
      (bulkv2 as any).maxChunkBytes = 16;

      const result = await bulkv2.checkFileSizeAndAct(file);
      expect(result.every((f) => fs.existsSync(f))).to.equal(true);

      bulkv2.cleanupTempFiles();
      expect(result.some((f) => fs.existsSync(f))).to.equal(false);
    });
  });

  describe('generateConfig', () => {
    it('should throw error when access token is missing', () => {
      // No accessToken on the connection → generateConfig must reject.
      const connNoToken = {
        instanceUrl: 'https://test.salesforce.com',
        getApiVersion: () => '59.0',
      } as unknown as Connection;
      const testBulkV2 = new BulkV2(connNoToken);

      expect(() => {
        (testBulkV2 as any).generateConfig('application/json');
      }).to.throw(SfError);
    });

    it('should include correct authorization header', () => {
      const config = (bulkv2 as any).generateConfig('application/json');

      expect(config.headers['Authorization']).to.equal('Bearer test-token');
      expect(config.headers['Content-Type']).to.equal('application/json');
    });
  });

  describe('processResultsRecursive locator pagination', () => {
    beforeEach(() => {
      // Writing the stream to disk is irrelevant to locator handling.
      sinon.stub(BulkV2, 'fastFileWrite').resolves();
    });

    const makeResponse = (locator: string) => ({ data: {} as any, headers: { 'sforce-locator': locator } });

    it("stops immediately when the first page's locator is the literal string 'null'", async () => {
      // Salesforce returns 'null' (not '') on the final/only page. The old code
      // treated 'null' as a real locator and fired a ?locator=null request → HTTP 400.
      const moreResults = sinon.stub(bulkv2 as any, 'moreResults').resolves(makeResponse('null'));

      const result = await (bulkv2 as any).processResultsRecursive('out.csv', makeResponse('null'), 'http://test.com');

      expect(result).to.equal(true);
      expect(moreResults.called).to.equal(false);
    });

    it('stops immediately when the locator header is an empty string', async () => {
      const moreResults = sinon.stub(bulkv2 as any, 'moreResults').resolves(makeResponse(''));

      const result = await (bulkv2 as any).processResultsRecursive('out.csv', makeResponse(''), 'http://test.com');

      expect(result).to.equal(true);
      expect(moreResults.called).to.equal(false);
    });

    it("paginates until a page returns the 'null' locator", async () => {
      const moreResults = sinon.stub(bulkv2 as any, 'moreResults');
      moreResults.onFirstCall().resolves(makeResponse('page2'));
      moreResults.onSecondCall().resolves(makeResponse('null'));

      const result = await (bulkv2 as any).processResultsRecursive('out.csv', makeResponse('page1'), 'http://test.com');

      expect(result).to.equal(true);
      expect(moreResults.callCount).to.equal(2);
      // Never requests the terminal 'null' locator itself.
      expect(moreResults.getCall(0).args[1]).to.equal('page1');
      expect(moreResults.getCall(1).args[1]).to.equal('page2');
    });
  });

  describe('error handling', () => {
    it('should throw error in moreResults when request fails', async () => {
      sinon.stub(axios, 'get').rejects(new Error('Network error'));

      try {
        await (bulkv2 as any).moreResults('http://test.com', 'locator', 'output.csv');
        expect.fail('Should have thrown error');
      } catch (err) {
        expect((err as any).name).to.equal('FetchResultsError');
      }
    });

    it('surfaces the Salesforce response body when createJob fails', async () => {
      const axiosErr: any = new Error('Request failed with status code 400');
      axiosErr.isAxiosError = true;
      axiosErr.response = { status: 400, data: [{ errorCode: 'INVALIDENTITY', message: 'invalid operation' }] };
      sinon.stub(axios, 'post').rejects(axiosErr);

      try {
        await (bulkv2 as any).createJob({ sobjecttype: 'Account', operation: 'delete' });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect((err as any).name).to.equal('BulkApiError');
        expect((err as any).message).to.include('HTTP 400');
        expect((err as any).message).to.include('INVALIDENTITY');
        // Original axios error preserved as cause for the stack trace.
        expect((err as any).cause).to.equal(axiosErr);
      }
    });

    it('wraps upload failures with the Salesforce error detail', async () => {
      const file = path.join(os.tmpdir(), `bulkv2-upload-${process.pid}-${process.hrtime.bigint()}.csv`);
      fs.writeFileSync(file, 'Id\n001\n');
      const axiosErr: any = new Error('Request failed with status code 500');
      axiosErr.isAxiosError = true;
      axiosErr.response = { status: 500, data: 'Server Error' };
      sinon.stub(axios, 'put').rejects(axiosErr);

      try {
        await (bulkv2 as any).uploadJob({ id: 'job1' }, file);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect((err as any).name).to.equal('BulkApiError');
        expect((err as any).message).to.include('HTTP 500');
        expect((err as any).message).to.include('Server Error');
      } finally {
        fs.rmSync(file, { force: true });
      }
    });
  });
});
