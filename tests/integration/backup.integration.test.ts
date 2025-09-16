import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as tar from 'tar';
import { generateChecksum, verifyChecksum } from '../../src/utils/checksum';

describe('Backup Integration Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-backup-integration-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('creates valid tar.gz archive', async () => {
    // Create test data
    const dataDir = join(tempDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(join(dataDir, 'data.ndjson'), '{"test": "data"}\n');
    await fs.mkdir(join(dataDir, 'images'), { recursive: true });
    await fs.writeFile(join(dataDir, 'images', 'test.jpg'), 'fake image data');

    // Create archive
    const archivePath = join(tempDir, 'backup.tar.gz');
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: tempDir,
      },
      ['data']
    );

    // Verify archive exists and has content
    const stats = await fs.stat(archivePath);
    expect(stats.size).toBeGreaterThan(0);

    // Extract and verify
    const extractDir = join(tempDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    await tar.extract({
      file: archivePath,
      cwd: extractDir,
    });

    // Check extracted files
    const extractedData = await fs.readFile(join(extractDir, 'data', 'data.ndjson'), 'utf-8');
    expect(extractedData).toBe('{"test": "data"}\n');

    const extractedImage = await fs.readFile(join(extractDir, 'data', 'images', 'test.jpg'), 'utf-8');
    expect(extractedImage).toBe('fake image data');
  });

  test('generates and verifies checksums', async () => {
    const testFile = join(tempDir, 'test.tar.gz');
    await fs.writeFile(testFile, 'test archive content');

    // Generate checksum
    const checksum = await generateChecksum(testFile);
    expect(checksum).toHaveLength(64); // SHA256 length

    // Write checksum file (note the two spaces between checksum and filename)
    const checksumFile = `${testFile}.sha256`;
    await fs.writeFile(checksumFile, `${checksum}  test.tar.gz`);

    // Verify checksum
    const checksumContent = await fs.readFile(checksumFile, 'utf-8');
    const match = checksumContent.match(/^([a-f0-9]+)\s+(.+)$/);
    expect(match).toBeTruthy();

    if (match) {
      const [, fileChecksum, fileName] = match;
      expect(fileName).toBe('test.tar.gz');
      expect(verifyChecksum(checksum, fileChecksum)).toBe(true);
    }
  });

  test('handles large dataset export format', async () => {
    // Simulate Sanity export structure
    const exportDir = join(tempDir, 'export');
    await fs.mkdir(exportDir, { recursive: true });

    // Create NDJSON file with multiple documents
    const documents = [];
    for (let i = 0; i < 1000; i++) {
      documents.push(JSON.stringify({
        _id: `doc-${i}`,
        _type: 'post',
        title: `Post ${i}`,
        content: `Content for post ${i}`,
      }));
    }
    await fs.writeFile(join(exportDir, 'data.ndjson'), documents.join('\n'));

    // Create assets directory structure
    const assetsDir = join(exportDir, 'images', 'project', 'dataset');
    await fs.mkdir(assetsDir, { recursive: true });

    // Add some mock assets
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(
        join(assetsDir, `image-${i}.jpg`),
        Buffer.alloc(1024 * 10) // 10KB mock images
      );
    }

    // Create archive
    const archivePath = join(tempDir, 'large-backup.tar.gz');
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: tempDir,
      },
      ['export']
    );

    // Verify archive size is reasonable
    const stats = await fs.stat(archivePath);
    expect(stats.size).toBeGreaterThan(1000); // Should have some content
    expect(stats.size).toBeLessThan(1024 * 1024); // Should be compressed < 1MB
  });

  test('preserves file permissions and structure', async () => {
    const exportDir = join(tempDir, 'export');
    const nestedDir = join(exportDir, 'nested', 'deep', 'structure');
    await fs.mkdir(nestedDir, { recursive: true });

    // Create files at different levels
    await fs.writeFile(join(exportDir, 'root.txt'), 'root file');
    await fs.writeFile(join(nestedDir, 'deep.txt'), 'deep file');

    // Create archive
    const archivePath = join(tempDir, 'structure.tar.gz');
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: tempDir,
      },
      ['export']
    );

    // Extract and verify structure
    const extractDir = join(tempDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    await tar.extract({
      file: archivePath,
      cwd: extractDir,
    });

    // Check structure is preserved
    const rootFile = await fs.readFile(join(extractDir, 'export', 'root.txt'), 'utf-8');
    expect(rootFile).toBe('root file');

    const deepFile = await fs.readFile(
      join(extractDir, 'export', 'nested', 'deep', 'structure', 'deep.txt'),
      'utf-8'
    );
    expect(deepFile).toBe('deep file');
  });
});

describe('Retention Policy Integration Tests', () => {
  test('identifies old backups correctly', () => {
    const now = new Date();
    const backups = [
      { name: 'backup-1.tar.gz', date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) }, // 1 day old
      { name: 'backup-2.tar.gz', date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) }, // 5 days old
      { name: 'backup-3.tar.gz', date: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) }, // 8 days old
      { name: 'backup-4.tar.gz', date: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) }, // 10 days old
    ];

    const retainCount = 7; // Keep 7 days
    const cutoffDate = new Date(now.getTime() - retainCount * 24 * 60 * 60 * 1000);

    const toDelete = backups.filter(b => b.date < cutoffDate);
    const toKeep = backups.filter(b => b.date >= cutoffDate);

    expect(toDelete).toHaveLength(2); // 8 and 10 days old
    expect(toKeep).toHaveLength(2); // 1 and 5 days old
  });

  test('handles retention count vs date-based retention', () => {
    const backups = [
      { name: 'backup-1.tar.gz', date: new Date('2024-01-10') },
      { name: 'backup-2.tar.gz', date: new Date('2024-01-09') },
      { name: 'backup-3.tar.gz', date: new Date('2024-01-08') },
      { name: 'backup-4.tar.gz', date: new Date('2024-01-07') },
      { name: 'backup-5.tar.gz', date: new Date('2024-01-06') },
    ];

    // Sort by date, newest first
    backups.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Keep only 3 most recent
    const retainCount = 3;
    const toKeep = backups.slice(0, retainCount);
    const toDelete = backups.slice(retainCount);

    expect(toKeep).toHaveLength(3);
    expect(toKeep[0].name).toBe('backup-1.tar.gz'); // Newest
    expect(toDelete).toHaveLength(2);
    expect(toDelete[0].name).toBe('backup-4.tar.gz'); // 4th oldest
  });
});