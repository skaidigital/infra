import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { exportSanityDataset, validateSanityCredentials } from './sanity-export.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the @sanity/client module
mock.module('@sanity/client', () => ({
  createClient: mock(() => ({
    projectId: 'test-project',
    dataset: 'test-dataset',
  })),
}));

// Mock the @sanity/export module
mock.module('@sanity/export', () => ({
  default: mock(async (options: any) => {
    const { outputPath, assets } = options;

    // Create mock tarball file (outputPath is now a file path, not directory)
    await fs.writeFile(outputPath, 'mock-tarball-content');

    return {
      documents: 2,
      assets: assets ? 1 : 0,
    };
  }),
}));

describe('Sanity Export', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-sanity-export-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('exportSanityDataset exports dataset with all options', async () => {
    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: true,
      includeAssets: true,
      assetConcurrency: 10,
    });

    // Verify the export tarball was created
    const exportFile = join(tempDir, 'export.tar.gz');
    const exists = await fs.access(exportFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('exportSanityDataset exports without assets when includeAssets is false', async () => {
    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeAssets: false,
    });

    // Verify the export tarball was created (without assets)
    const exportFile = join(tempDir, 'export.tar.gz');
    const exists = await fs.access(exportFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('exportSanityDataset creates output directory if it does not exist', async () => {
    const newDir = join(tempDir, 'new-dir');

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: newDir,
      token: 'test-token',
      includeAssets: false,
    });

    const dirExists = await fs.access(newDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(true);
  });

  test('exportSanityDataset rejects when export fails', async () => {
    // Mock export that creates empty file
    const mockExport = mock(async (options: any) => {
      await fs.writeFile(options.outputPath, '');
      return { documents: 0, assets: 0 };
    });
    mock.module('@sanity/export', () => ({ default: mockExport }));
    mock.module('@sanity/client', () => ({
      createClient: mock(() => ({
        projectId: 'test-project',
        dataset: 'test-dataset',
      })),
    }));

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('Export file is empty');
  });
});

describe('Sanity Credentials Validation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockFetch = (handler: Function) => {
    const fn = handler as any;
    fn.preconnect = () => {};
    return fn as typeof globalThis.fetch;
  };

  test('validateSanityCredentials returns true for valid credentials', async () => {
    globalThis.fetch = mockFetch(mock(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      expect(urlStr).toBe('https://api.sanity.io/v2021-06-07/projects/test-project-id');
      expect(init?.headers).toMatchObject({
        'Authorization': 'Bearer test-token',
      });

      return new Response('{"projectId":"test-project-id"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const isValid = await validateSanityCredentials('test-project-id', 'test-token');
    expect(isValid).toBe(true);
  });

  test('validateSanityCredentials returns false for invalid credentials', async () => {
    globalThis.fetch = mockFetch(mock(async () => {
      return new Response('{"error":"Unauthorized"}', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }));

    const isValid = await validateSanityCredentials('test-project-id', 'invalid-token');
    expect(isValid).toBe(false);
  });

  test('validateSanityCredentials returns false on network error', async () => {
    globalThis.fetch = mockFetch(mock(async () => {
      throw new Error('Network error');
    }));

    const isValid = await validateSanityCredentials('test-project-id', 'test-token');
    expect(isValid).toBe(false);
  });

  test('validateSanityCredentials returns false for non-existent project', async () => {
    globalThis.fetch = mockFetch(mock(async () => {
      return new Response('{"error":"Project not found"}', {
        status: 404,
        statusText: 'Not Found',
      });
    }));

    const isValid = await validateSanityCredentials('non-existent-project', 'test-token');
    expect(isValid).toBe(false);
  });
});