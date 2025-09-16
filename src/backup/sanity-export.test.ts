import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { exportSanityDataset, validateSanityCredentials } from './sanity-export.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

describe('Sanity Export', () => {
  let tempDir: string;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-sanity-export-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    // Restore individual spy if it exists
    if (spawnSpy) {
      spawnSpy.mockRestore();
      spawnSpy = undefined as any;
    }
    // Clear all other mocks between tests
    mock.restore();
  });

  test('exportSanityDataset builds correct command arguments with all options', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      expect(command).toBe('bun');
      expect(args[0]).toContain('sanity.js');
      expect(args).toContain('dataset');
      expect(args).toContain('export');
      expect(args).toContain('test-dataset');
      expect(args).toContain('--project');
      expect(args).toContain('test-project');
      expect(args).toContain('--token');
      expect(args).toContain('test-token');
      expect(args).toContain('--overwrite');
      expect(args).toContain('--asset-concurrency');
      expect(args).toContain('10');

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      // Simulate successful export
      setTimeout(async () => {
        // Create mock export file
        await fs.writeFile(join(tempDir, 'data.ndjson'), 'mock data');
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: true,
      includeAssets: true,
      assetConcurrency: 10,
    });
  });

  test('exportSanityDataset excludes drafts when includeDrafts is false', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      expect(args).toContain('--no-drafts');

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(async () => {
        await fs.writeFile(join(tempDir, 'data.ndjson'), 'mock data');
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: false,
      includeAssets: true,
    });
  });

  test('exportSanityDataset excludes assets when includeAssets is false', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      expect(args).toContain('--no-assets');
      expect(args).not.toContain('--asset-concurrency');

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(async () => {
        await fs.writeFile(join(tempDir, 'data.ndjson'), 'mock data');
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
      includeDrafts: true,
      includeAssets: false,
    });
  });

  test('exportSanityDataset rejects when export fails', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => {
        mockProcess.stderr.emit('data', Buffer.from('Export failed'));
        mockProcess.emit('close', 1);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('Sanity export failed with code 1');
  });

  test('exportSanityDataset rejects when export file is empty', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(async () => {
        // Create empty export file
        await fs.writeFile(join(tempDir, 'data.ndjson'), '');
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('Export file is empty');
  });

  test('exportSanityDataset handles spawn errors', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => {
        mockProcess.emit('error', new Error('Spawn failed'));
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await expect(exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: tempDir,
      token: 'test-token',
    })).rejects.toThrow('Failed to start Sanity export: Spawn failed');
  });

  test('exportSanityDataset creates output directory if it does not exist', async () => {
    const nonExistentDir = join(tempDir, 'new-dir');

    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(async () => {
        await fs.writeFile(join(nonExistentDir, 'data.ndjson'), 'mock data');
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    await exportSanityDataset({
      projectId: 'test-project',
      dataset: 'test-dataset',
      outputPath: nonExistentDir,
      token: 'test-token',
    });

    const dirStats = await fs.stat(nonExistentDir);
    expect(dirStats.isDirectory()).toBe(true);
  });
});

describe('Sanity Credentials Validation', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    // Restore individual spy if it exists
    if (spawnSpy) {
      spawnSpy.mockRestore();
      spawnSpy = undefined as any;
    }
    // Clear all other mocks between tests
    mock.restore();
  });

  test('validateSanityCredentials returns true for valid credentials', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('test-project-id\nother-project'));
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    const isValid = await validateSanityCredentials('test-project-id', 'test-token');
    expect(isValid).toBe(true);
  });

  test('validateSanityCredentials returns false for invalid credentials', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    const isValid = await validateSanityCredentials('test-project-id', 'invalid-token');
    expect(isValid).toBe(false);
  });

  test('validateSanityCredentials returns false when project not found', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('other-project\nanother-project'));
        mockProcess.emit('close', 0);
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    const isValid = await validateSanityCredentials('test-project-id', 'test-token');
    expect(isValid).toBe(false);
  });

  test('validateSanityCredentials handles spawn errors', async () => {
    const mockSpawn = mock((command: string, args: string[], options: any) => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      setTimeout(() => {
        mockProcess.emit('error', new Error('Spawn failed'));
      }, 10);

      return mockProcess;
    });

    spawnSpy = spyOn(child_process, 'spawn').mockImplementation(mockSpawn as any);

    const isValid = await validateSanityCredentials('test-project-id', 'test-token');
    expect(isValid).toBe(false);
  });
});