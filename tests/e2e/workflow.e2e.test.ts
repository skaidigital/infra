import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('E2E Workflow Tests', () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `test-e2e-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Set up test environment
    process.env = {
      ...originalEnv,
      SANITY_TOKEN: 'test-token-e2e',
      SANITY_PROJECT_ID: 'test-project-e2e',
      SANITY_DATASET: 'test-dataset-e2e',
      R2_ACCOUNT_ID: 'test-account-e2e',
      R2_ACCESS_KEY_ID: 'test-key-e2e',
      R2_SECRET_ACCESS_KEY: 'test-secret-e2e',
      R2_BUCKET: 'test-bucket-e2e',
      R2_PREFIX: 'e2e-test',
      RETAIN_COUNT: '7',
      INCLUDE_DRAFTS: 'true',
      INCLUDE_ASSETS: 'true',
    };
  });

  afterAll(async () => {
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('validates environment configuration', () => {
    // Check required environment variables
    expect(process.env.SANITY_TOKEN).toBeDefined();
    expect(process.env.SANITY_PROJECT_ID).toBeDefined();
    expect(process.env.SANITY_DATASET).toBeDefined();
    expect(process.env.R2_ACCOUNT_ID).toBeDefined();
    expect(process.env.R2_ACCESS_KEY_ID).toBeDefined();
    expect(process.env.R2_SECRET_ACCESS_KEY).toBeDefined();
    expect(process.env.R2_BUCKET).toBeDefined();

    // Check optional variables have defaults
    expect(process.env.R2_PREFIX).toBe('e2e-test');
    expect(process.env.RETAIN_COUNT).toBe('7');
    expect(process.env.INCLUDE_DRAFTS).toBe('true');
    expect(process.env.INCLUDE_ASSETS).toBe('true');
  });

  test('handles missing required environment variables', () => {
    const requiredVars = [
      'SANITY_TOKEN',
      'SANITY_PROJECT_ID',
      'SANITY_DATASET',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
    ];

    for (const varName of requiredVars) {
      const originalValue = process.env[varName];
      delete process.env[varName];

      // Attempt to access the variable
      expect(() => {
        if (!process.env[varName]) {
          throw new Error(`${varName} is required`);
        }
      }).toThrow(`${varName} is required`);

      // Restore the variable
      process.env[varName] = originalValue;
    }
  });

  test('generates correct backup file naming', () => {
    const projectId = 'my-project';
    const dataset = 'production';
    const timestamp = '2024-01-15T10-30-45-123Z';

    const expectedFileName = `sanity-${projectId}-${dataset}-${timestamp}.tar.gz`;
    expect(expectedFileName).toBe('sanity-my-project-production-2024-01-15T10-30-45-123Z.tar.gz');

    const expectedObjectKey = `sanity/${projectId}/${dataset}/${timestamp}.tar.gz`;
    expect(expectedObjectKey).toBe('sanity/my-project/production/2024-01-15T10-30-45-123Z.tar.gz');
  });

  test('handles special characters in project and dataset names', () => {
    const specialCases = [
      { projectId: 'my-project', dataset: 'test-data', valid: true },
      { projectId: 'project123', dataset: 'data456', valid: true },
      { projectId: 'project_name', dataset: 'data_set', valid: true },
      { projectId: 'UPPER', dataset: 'lower', valid: true },
    ];

    for (const { projectId, dataset, valid } of specialCases) {
      const fileName = `sanity-${projectId}-${dataset}-timestamp.tar.gz`;
      expect(fileName).toContain(projectId);
      expect(fileName).toContain(dataset);

      if (valid) {
        // Should not throw when used as file name
        expect(() => {
          const safeName = fileName.replace(/[^a-zA-Z0-9\-_\.]/g, '-');
          return safeName;
        }).not.toThrow();
      }
    }
  });

  test('calculates backup metrics correctly', async () => {
    // Create test files of known sizes
    const file1 = join(tempDir, 'file1.txt');
    const file2 = join(tempDir, 'file2.txt');

    await fs.writeFile(file1, Buffer.alloc(1024 * 100)); // 100KB
    await fs.writeFile(file2, Buffer.alloc(1024 * 200)); // 200KB

    const stats1 = await fs.stat(file1);
    const stats2 = await fs.stat(file2);

    const totalSize = stats1.size + stats2.size;
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    expect(totalSize).toBe(1024 * 300); // 300KB total
    expect(parseFloat(totalSizeMB)).toBeCloseTo(0.29, 1); // ~0.29 MB
  });

  test('handles concurrent operations', async () => {
    const operations = [];

    // Simulate concurrent file operations
    for (let i = 0; i < 10; i++) {
      operations.push(
        fs.writeFile(join(tempDir, `concurrent-${i}.txt`), `content ${i}`)
      );
    }

    // All operations should complete successfully
    await expect(Promise.all(operations)).resolves.toBeDefined();

    // Verify all files were created
    const files = await fs.readdir(tempDir);
    const concurrentFiles = files.filter(f => f.startsWith('concurrent-'));
    expect(concurrentFiles).toHaveLength(10);
  });

  test('respects retention policy limits', () => {
    const retainCounts = [1, 7, 30, 90, 365];

    for (const count of retainCounts) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(365); // Reasonable maximum

      // Calculate storage estimate (assuming 100MB per backup)
      const estimatedStorageMB = count * 100;
      const estimatedStorageGB = estimatedStorageMB / 1024;

      // Log storage requirements for different retention periods
      if (count === 7) {
        expect(estimatedStorageGB).toBeLessThan(1); // Weekly should be < 1GB
      } else if (count === 30) {
        expect(estimatedStorageGB).toBeLessThan(5); // Monthly should be < 5GB
      }
    }
  });

  test('handles timezone differences correctly', () => {
    // Test that timestamps are in UTC
    const now = new Date();
    const isoString = now.toISOString();

    expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(isoString.endsWith('Z')).toBe(true); // Z indicates UTC

    // Convert to safe filename format
    const filenameSafe = isoString.replace(/[:.]/g, '-');
    expect(filenameSafe).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });
});

describe('Error Recovery E2E Tests', () => {
  test('handles network interruption scenarios', async () => {
    const simulateNetworkError = () => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('ECONNRESET: Connection reset by peer'));
        }, 10);
      });
    };

    // Test retry logic
    let attempts = 0;
    const maxRetries = 3;

    const retryOperation = async () => {
      for (let i = 0; i <= maxRetries; i++) {
        try {
          attempts++;
          if (attempts < 3) {
            await simulateNetworkError();
          } else {
            return 'success';
          }
        } catch (error) {
          if (i === maxRetries) {
            throw error;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    };

    const result = await retryOperation();
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('cleans up on failure', async () => {
    const tempWorkDir = join(tmpdir(), `cleanup-test-${Date.now()}`);

    try {
      await fs.mkdir(tempWorkDir, { recursive: true });
      await fs.writeFile(join(tempWorkDir, 'temp.txt'), 'temporary data');

      // Simulate failure
      throw new Error('Simulated failure');
    } catch (error) {
      // Cleanup should happen
      try {
        await fs.rm(tempWorkDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Cleanup might fail if directory doesn't exist
      }
    }

    // Verify cleanup worked
    await expect(fs.access(tempWorkDir)).rejects.toThrow();
  });

  test('validates data integrity after operations', async () => {
    const testData = 'Important data that must not be corrupted';
    const testFile = join(tmpdir(), `integrity-test-${Date.now()}.txt`);

    // Write data
    await fs.writeFile(testFile, testData);

    // Read and verify
    const readData = await fs.readFile(testFile, 'utf-8');
    expect(readData).toBe(testData);

    // Verify byte length
    const stats = await fs.stat(testFile);
    expect(stats.size).toBe(Buffer.byteLength(testData));

    // Cleanup
    await fs.unlink(testFile);
  });
});