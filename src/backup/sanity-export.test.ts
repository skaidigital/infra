import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { exportSanityDataset, validateSanityCredentials } from './sanity-export.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Sanity Export', () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-sanity-export-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    globalThis.fetch = originalFetch;
  });

  const mockFetch = (handler: Function) => {
    const fn = handler as any;
    fn.preconnect = () => {};
    return fn as typeof globalThis.fetch;
  };

  test('exportSanityDataset exports dataset via API with all options', async () => {
    const mockData = '{"_id":"doc1","_type":"page"}\n{"_id":"doc2","_type":"post"}\n';

    globalThis.fetch = mockFetch(mock(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();

      expect(urlStr).toContain('https://test-project.api.sanity.io/v2021-06-07/data/export/test-dataset');
      expect(init?.headers).toMatchObject({
        'Authorization': 'Bearer test-token',
        'Accept': 'application/x-ndjson',
      });

      return new Response(mockData, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }));

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: true,
      includeAssets: false,
      assetConcurrency: 10,
    });

    // Verify the export file was created
    const exportFile = join(tempDir, 'data.ndjson');
    const content = await fs.readFile(exportFile, 'utf-8');
    expect(content).toBe(mockData);
  });

  test('exportSanityDataset exports and downloads assets', async () => {
    const mockData = '{"_id":"doc1","_type":"page","image":{"_type":"image","asset":{"_ref":"image-abc123-100x100-jpg"}}}\n';
    const mockImageData = Buffer.from('fake-image-data');

    globalThis.fetch = mockFetch(mock(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/data/export/')) {
        return new Response(mockData, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      } else if (urlStr.includes('cdn.sanity.io/images/')) {
        return new Response(mockImageData, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    }));

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: true,
      includeAssets: true,
    });

    // Verify the export file was created
    const exportFile = join(tempDir, 'data.ndjson');
    const content = await fs.readFile(exportFile, 'utf-8');
    expect(content).toBe(mockData);

    // Verify the asset was downloaded
    const assetFile = join(tempDir, 'images', 'abc123.jpg');
    const assetContent = await fs.readFile(assetFile);
    expect(assetContent).toEqual(mockImageData);
  });

  test('exportSanityDataset handles file assets', async () => {
    const mockData = '{"_id":"doc1","_type":"page","file":{"_type":"file","asset":{"_ref":"file-def456-pdf"}}}\n';
    const mockFileData = Buffer.from('fake-pdf-data');

    globalThis.fetch = mockFetch(mock(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/data/export/')) {
        return new Response(mockData, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      } else if (urlStr.includes('cdn.sanity.io/files/')) {
        return new Response(mockFileData, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        });
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    }));

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: true,
      includeAssets: true,
    });

    // Verify the file asset was downloaded
    const assetFile = join(tempDir, 'images', 'def456.pdf');
    const assetContent = await fs.readFile(assetFile);
    expect(assetContent).toEqual(mockFileData);
  });

  test('exportSanityDataset rejects when API returns error', async () => {
    globalThis.fetch = mockFetch(mock(async () => {
      return new Response('{"error":"Unauthorized"}', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }));

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('Export API request failed: 401 Unauthorized');
  });

  test('exportSanityDataset rejects when export file is empty', async () => {
    globalThis.fetch = mockFetch(mock(async () => {
      return new Response('', {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }));

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('Export file is empty');
  });

  test('exportSanityDataset handles no assets gracefully', async () => {
    const mockData = '{"_id":"doc1","_type":"page","title":"Test"}\n';

    globalThis.fetch = mockFetch(mock(async (url: string | URL) => {
      const urlStr = url.toString();

      if (urlStr.includes('/data/export/')) {
        return new Response(mockData, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    }));

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeAssets: true,
    });

    // Should not create images directory if no assets
    const imagesDir = join(tempDir, 'images');
    const dirExists = await fs.access(imagesDir).then(() => true).catch(() => false);
    expect(dirExists).toBe(false);
  });

  test('exportSanityDataset creates output directory if it does not exist', async () => {
    const newDir = join(tempDir, 'new-dir');
    const mockData = '{"_id":"doc1"}\n';

    globalThis.fetch = mockFetch(mock(async () => {
      return new Response(mockData, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }));

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

  test('exportSanityDataset handles asset download failures gracefully', async () => {
    const mockData = '{"_id":"doc1","image":{"_type":"image","asset":{"_ref":"image-abc123-100x100-jpg"}}}\n';

    globalThis.fetch = mockFetch(mock(async (url: string | URL) => {
      const urlStr = url.toString();

      if (urlStr.includes('/data/export/')) {
        return new Response(mockData, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      } else if (urlStr.includes('cdn.sanity.io/images/')) {
        // Simulate asset download failure
        return new Response('Not Found', { status: 404 });
      }

      throw new Error(`Unexpected URL: ${urlStr}`);
    }));

    // Should not throw even if asset download fails
    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeAssets: true,
    });

    // Export file should still exist
    const exportFile = join(tempDir, 'data.ndjson');
    const exists = await fs.access(exportFile).then(() => true).catch(() => false);
    expect(exists).toBe(true);
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