import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { exportSanityDataset, validateSanityCredentials } from './sanity-export.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the @sanity/export module
mock.module('@sanity/export', () => ({
  default: mock(async (options: any) => {
    const { outputPath, assets } = options;

    // Create mock data file
    await fs.writeFile(join(outputPath, 'data.ndjson'), '{"_id":"doc1"}\n{"_id":"doc2"}\n');

    // Create mock assets if requested
    if (assets) {
      const imagesDir = join(outputPath, 'images');
      await fs.mkdir(imagesDir, { recursive: true });
      await fs.writeFile(join(imagesDir, 'test.jpg'), 'fake-image-data');
    }

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

    // Verify the export file was created
    const exportFile = join(tempDir, 'data.ndjson');
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

    // Verify no assets directory
    const imagesDir = join(tempDir, 'images');
    const dirExists = await fs.access(imagesDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(false);
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

  test('exportSanityDataset rejects when no files exported', async () => {
    // Mock export that doesn't create files
    const mockExport = mock(async () => ({ documents: 0, assets: 0 }));
    mock.module('@sanity/export', () => ({ default: mockExport }));

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('No files exported');
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