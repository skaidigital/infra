import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { uploadToR2, deleteOldBackups, listBackups, downloadBackup } from './r2-upload.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock AWS SDK
const mockSend = mock((...args: any[]) => Promise.resolve({}));
const mockS3Client = mock((...args: any[]) => ({
  send: mockSend,
}));

// Mock Upload class for multipart upload testing
const mockUploadDone = mock(() => Promise.resolve());
const mockUploadOn = mock((event: string, handler: any) => {});
const mockUpload = mock((config: any) => ({
  done: mockUploadDone,
  on: mockUploadOn,
}));

mock.module('@aws-sdk/client-s3', () => ({
  S3Client: mockS3Client,
  PutObjectCommand: mock((params: any) => ({ ...params, _type: 'PutObjectCommand' })),
  HeadObjectCommand: mock((params: any) => ({ ...params, _type: 'HeadObjectCommand' })),
  ListObjectsV2Command: mock((params: any) => ({ ...params, _type: 'ListObjectsV2Command' })),
  DeleteObjectsCommand: mock((params: any) => ({ ...params, _type: 'DeleteObjectsCommand' })),
  GetObjectCommand: mock((params: any) => ({ ...params, _type: 'GetObjectCommand' })),
}));

mock.module('@aws-sdk/lib-storage', () => ({
  Upload: mockUpload,
}));

describe('R2 Upload Operations', () => {
  let tempDir: string;
  let testFile: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-r2-upload-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    testFile = join(tempDir, 'test.tar.gz');
    await fs.writeFile(testFile, 'test content');

    process.env = {
      ...originalEnv,
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_BUCKET: 'test-bucket',
      R2_REGION: 'auto',
    };

    // Reset mocks
    mockSend.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
    mockUploadDone.mockClear();
    mockUploadOn.mockClear();
    mockUpload.mockClear();
  });

  test('uploadToR2 uploads file successfully', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'HeadObjectCommand') {
        return Promise.resolve({
          ContentLength: 12, // Length of 'test content'
          ETag: '"test-etag"',
        });
      }
      return Promise.resolve({});
    });

    await uploadToR2(testFile, 'test/path/file.tar.gz');

    expect(mockSend).toHaveBeenCalledTimes(2); // PutObject + HeadObject
  });

  test('uploadToR2 throws error on size mismatch', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'HeadObjectCommand') {
        return Promise.resolve({
          ContentLength: 999, // Wrong size
          ETag: '"test-etag"',
        });
      }
      return Promise.resolve({});
    });

    await expect(uploadToR2(testFile, 'test/path/file.tar.gz'))
      .rejects.toThrow('Upload verification failed: size mismatch');
  });

  test('uploadToR2 throws error when bucket not configured', async () => {
    delete process.env.R2_BUCKET;

    await expect(uploadToR2(testFile, 'test/path/file.tar.gz'))
      .rejects.toThrow('R2_BUCKET not configured');
  });

  test('uploadToR2 throws error when credentials not configured', async () => {
    delete process.env.R2_ACCOUNT_ID;

    await expect(uploadToR2(testFile, 'test/path/file.tar.gz'))
      .rejects.toThrow('R2 credentials not configured');
  });

  test('uploadToR2 uses multipart upload for large files', async () => {
    // Create a large file (over 100MB threshold)
    const largeFile = join(tempDir, 'large.tar.gz');
    const size = 150 * 1024 * 1024; // 150MB
    const buffer = Buffer.alloc(size, 'a');
    await fs.writeFile(largeFile, buffer);

    // Mock successful upload and verification
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'HeadObjectCommand') {
        return Promise.resolve({
          ContentLength: size,
          ETag: '"large-file-etag"',
        });
      }
      return Promise.resolve({});
    });

    await uploadToR2(largeFile, 'test/large-file.tar.gz');

    // Verify multipart upload was used
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const uploadCall = mockUpload.mock.calls[0][0];
    expect(uploadCall.params.Bucket).toBe('test-bucket');
    expect(uploadCall.params.Key).toBe('test/large-file.tar.gz');
    expect(uploadCall.queueSize).toBe(4);
    expect(uploadCall.partSize).toBe(10 * 1024 * 1024); // 10MB parts
    expect(uploadCall.leavePartsOnError).toBe(false);

    // Verify progress tracking was set up
    expect(mockUploadOn).toHaveBeenCalledWith('httpUploadProgress', expect.any(Function));
  });

  test('uploadToR2 uses simple upload for small files', async () => {
    // Create a small file (under 100MB threshold)
    const smallFile = join(tempDir, 'small.tar.gz');
    const size = 50 * 1024 * 1024; // 50MB
    const buffer = Buffer.alloc(size, 'b');
    await fs.writeFile(smallFile, buffer);

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'HeadObjectCommand') {
        return Promise.resolve({
          ContentLength: size,
          ETag: '"small-file-etag"',
        });
      }
      return Promise.resolve({});
    });

    await uploadToR2(smallFile, 'test/small-file.tar.gz');

    // Verify multipart upload was NOT used
    expect(mockUpload).toHaveBeenCalledTimes(0);

    // Verify simple upload was used (PutObjectCommand + HeadObjectCommand)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('uploadToR2 includes enhanced error details on failure', async () => {
    // Create a file
    const errorFile = join(tempDir, 'error.tar.gz');
    const size = 200 * 1024 * 1024; // 200MB
    const buffer = Buffer.alloc(1024); // Small buffer for test
    await fs.writeFile(errorFile, buffer);

    // Mock upload failure
    mockUploadDone.mockImplementation(() =>
      Promise.reject(new Error('Network timeout'))
    );

    // Override file stats to return our desired size
    const originalStat = fs.stat;
    // @ts-ignore - mocking fs.stat temporarily
    fs.stat = async (path: string) => {
      if (path === errorFile) {
        return { size };
      }
      return originalStat(path);
    };

    try {
      await uploadToR2(errorFile, 'test/error-file.tar.gz');
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      // Verify enhanced error message includes context
      expect(error.message).toContain('R2 upload failed for error.tar.gz');
      expect(error.message).toContain('200.00 MB');
      expect(error.message).toContain('Network timeout');
      expect(error.message).toContain('Bucket: test-bucket');
      expect(error.message).toContain('Key: test/error-file.tar.gz');
    } finally {
      // @ts-ignore - restore original fs.stat
      fs.stat = originalStat;
    }
  });

  test('multipart upload progress callback works correctly', async () => {
    const largeFile = join(tempDir, 'progress-test.tar.gz');
    const size = 150 * 1024 * 1024; // 150MB
    const buffer = Buffer.alloc(1024); // Small buffer for test
    await fs.writeFile(largeFile, buffer);

    // Override file stats
    const originalStat = fs.stat;
    // @ts-ignore
    fs.stat = async (path: string) => {
      if (path === largeFile) {
        return { size };
      }
      return originalStat(path);
    };

    // Reset upload mock to succeed
    mockUploadDone.mockImplementation(() => Promise.resolve());

    let progressCallback: any;
    mockUploadOn.mockImplementation((event: string, handler: any) => {
      if (event === 'httpUploadProgress') {
        progressCallback = handler;
      }
    });

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'HeadObjectCommand') {
        return Promise.resolve({
          ContentLength: size,
          ETag: '"test-etag"',
        });
      }
      return Promise.resolve({});
    });

    await uploadToR2(largeFile, 'test/progress.tar.gz');

    // Simulate progress events
    if (progressCallback) {
      progressCallback({ loaded: 50 * 1024 * 1024, total: size });
      progressCallback({ loaded: 100 * 1024 * 1024, total: size });
      progressCallback({ loaded: size, total: size });
    }

    // Verify Upload was configured correctly
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUploadOn).toHaveBeenCalledWith('httpUploadProgress', expect.any(Function));

    // @ts-ignore
    fs.stat = originalStat;
  });
});

describe('R2 Retention Management', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_BUCKET: 'test-bucket',
    };

    mockSend.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('deleteOldBackups keeps recent backups', async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    mockSend.mockImplementation(() =>
      Promise.resolve({
        Contents: [
          { Key: 'backup-1.tar.gz', LastModified: now },
          { Key: 'backup-2.tar.gz', LastModified: new Date(now.getTime() - 86400000) },
          { Key: 'backup-3.tar.gz', LastModified: new Date(now.getTime() - 172800000) },
          { Key: 'backup-4.tar.gz', LastModified: oldDate },
        ],
      })
    );

    await deleteOldBackups('test-prefix/', 3);

    // Should delete only the oldest backup
    expect(mockSend).toHaveBeenCalledTimes(2); // List + Delete
  });

  test('deleteOldBackups handles no backups', async () => {
    mockSend.mockImplementation(() =>
      Promise.resolve({
        Contents: [],
      })
    );

    await deleteOldBackups('test-prefix/', 7);

    expect(mockSend).toHaveBeenCalledTimes(1); // Only List, no Delete
  });

  test('deleteOldBackups ignores non-tar.gz files', async () => {
    mockSend.mockImplementation(() =>
      Promise.resolve({
        Contents: [
          { Key: 'backup-1.tar.gz', LastModified: new Date() },
          { Key: 'backup-1.tar.gz.sha256', LastModified: new Date() },
          { Key: 'backup-2.tar.gz', LastModified: new Date() },
        ],
      })
    );

    await deleteOldBackups('test-prefix/', 5);

    expect(mockSend).toHaveBeenCalledTimes(1); // Only List, no Delete (2 backups < 5 retention)
  });

  test('deleteOldBackups deletes corresponding sha256 files', async () => {
    const now = new Date();

    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2Command') {
        return Promise.resolve({
          Contents: [
            { Key: 'backup-1.tar.gz', LastModified: now },
            { Key: 'backup-2.tar.gz', LastModified: new Date(now.getTime() - 86400000) },
            { Key: 'backup-3.tar.gz', LastModified: new Date(now.getTime() - 172800000) },
            { Key: 'backup-4.tar.gz', LastModified: new Date(now.getTime() - 259200000) },
          ],
        });
      }
      if (command._type === 'DeleteObjectsCommand') {
        // Verify both .tar.gz and .sha256 files are included
        expect(command.Delete.Objects).toContainEqual({ Key: 'backup-4.tar.gz' });
        expect(command.Delete.Objects).toContainEqual({ Key: 'backup-4.tar.gz.sha256' });
        return Promise.resolve({
          Deleted: command.Delete.Objects,
        });
      }
      return Promise.resolve({});
    });

    await deleteOldBackups('test-prefix/', 3);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('deleteOldBackups throws error on deletion failure', async () => {
    mockSend.mockImplementation((command: any) => {
      if (command._type === 'ListObjectsV2Command') {
        return Promise.resolve({
          Contents: [
            { Key: 'backup-1.tar.gz', LastModified: new Date() },
            { Key: 'backup-2.tar.gz', LastModified: new Date() },
          ],
        });
      }
      if (command._type === 'DeleteObjectsCommand') {
        return Promise.resolve({
          Errors: [{ Key: 'backup-2.tar.gz', Message: 'Access Denied' }],
        });
      }
      return Promise.resolve({});
    });

    await expect(deleteOldBackups('test-prefix/', 1))
      .rejects.toThrow('Failed to delete some backups');
  });
});

describe('R2 List and Download Operations', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-key',
      R2_SECRET_ACCESS_KEY: 'test-secret',
      R2_BUCKET: 'test-bucket',
    };

    mockSend.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('listBackups returns sorted backup list', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);

    mockSend.mockImplementation(() =>
      Promise.resolve({
        Contents: [
          { Key: 'backup-old.tar.gz', Size: 1000, LastModified: yesterday },
          { Key: 'backup-new.tar.gz', Size: 2000, LastModified: now },
          { Key: 'backup-old.tar.gz.sha256', Size: 64, LastModified: yesterday },
        ],
      })
    );

    const backups = await listBackups('test-prefix/');

    expect(backups).toHaveLength(2); // Only .tar.gz files
    expect(backups[0].key).toBe('backup-new.tar.gz'); // Sorted by date, newest first
    expect(backups[0].size).toBe(2000);
    expect(backups[1].key).toBe('backup-old.tar.gz');
  });

  test('listBackups returns empty array when no backups', async () => {
    mockSend.mockImplementation(() =>
      Promise.resolve({
        Contents: undefined,
      })
    );

    const backups = await listBackups('test-prefix/');
    expect(backups).toEqual([]);
  });

  test('downloadBackup saves file correctly', async () => {
    const tempDir = join(tmpdir(), `test-download-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    const outputPath = join(tempDir, 'downloaded.tar.gz');

    try {
      const testData = Buffer.from('downloaded content');

      mockSend.mockImplementation(() => {
        // Create an async iterator for the body
        const body = {
          async *[Symbol.asyncIterator]() {
            yield testData;
          }
        };

        return Promise.resolve({ Body: body });
      });

      await downloadBackup('test-key.tar.gz', outputPath);

      const content = await fs.readFile(outputPath);
      expect(content.toString()).toBe('downloaded content');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('downloadBackup throws error when no data received', async () => {
    mockSend.mockImplementation(() =>
      Promise.resolve({ Body: undefined })
    );

    await expect(downloadBackup('test-key.tar.gz', '/tmp/test.tar.gz'))
      .rejects.toThrow('No data received from R2');
  });
});