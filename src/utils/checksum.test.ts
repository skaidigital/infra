import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { generateChecksum, verifyChecksum, parseChecksumFile, generateChecksumStream } from './checksum.ts';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';

describe('Checksum Generation', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-checksum-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    testFile = join(tempDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello, World!');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('generateChecksum creates SHA256 hash by default', async () => {
    const checksum = await generateChecksum(testFile);

    // SHA256 hash of "Hello, World!"
    expect(checksum).toBe('dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f');
    expect(checksum).toHaveLength(64); // SHA256 produces 64 hex characters
  });

  test('generateChecksum supports MD5 algorithm', async () => {
    const checksum = await generateChecksum(testFile, 'md5');

    // MD5 hash of "Hello, World!"
    expect(checksum).toBe('65a8e27d8879283831b664bd8b7f0ad4');
    expect(checksum).toHaveLength(32); // MD5 produces 32 hex characters
  });

  test('generateChecksum handles large files', async () => {
    const largeFile = join(tempDir, 'large.txt');
    const largeContent = 'A'.repeat(10 * 1024 * 1024); // 10MB
    await fs.writeFile(largeFile, largeContent);

    const checksum = await generateChecksum(largeFile);
    expect(checksum).toHaveLength(64);
  });

  test('generateChecksum rejects on non-existent file', async () => {
    const nonExistentFile = join(tempDir, 'non-existent.txt');

    await expect(generateChecksum(nonExistentFile))
      .rejects.toThrow('Failed to generate checksum');
  });

  test('generateChecksum handles empty files', async () => {
    const emptyFile = join(tempDir, 'empty.txt');
    await fs.writeFile(emptyFile, '');

    const checksum = await generateChecksum(emptyFile);

    // SHA256 hash of empty string
    expect(checksum).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('Checksum Stream', () => {
  test('generateChecksumStream processes stream correctly', async () => {
    const stream = Readable.from(['Hello, ', 'World!']);
    const checksum = await generateChecksumStream(stream);

    // SHA256 hash of "Hello, World!"
    expect(checksum).toBe('dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f');
  });

  test('generateChecksumStream supports different algorithms', async () => {
    const stream = Readable.from(['Test']);
    const checksum = await generateChecksumStream(stream, 'md5');

    // MD5 hash of "Test"
    expect(checksum).toBe('0cbc6611f5540bd0809a388dc95a615b');
  });
});

describe('Checksum Verification', () => {
  test('verifyChecksum returns true for matching checksums', () => {
    const actual = 'abc123def456';
    const expected = 'abc123def456';

    expect(verifyChecksum(actual, expected)).toBe(true);
  });

  test('verifyChecksum returns false for non-matching checksums', () => {
    const actual = 'abc123def456';
    const expected = 'def456abc789';

    expect(verifyChecksum(actual, expected)).toBe(false);
  });

  test('verifyChecksum is case-insensitive', () => {
    const actual = 'ABC123DEF456';
    const expected = 'abc123def456';

    expect(verifyChecksum(actual, expected)).toBe(true);
  });

  test('verifyChecksum handles mixed case', () => {
    const actual = 'AbC123DeF456';
    const expected = 'abc123def456';

    expect(verifyChecksum(actual, expected)).toBe(true);
  });
});

describe('Checksum File Parsing', () => {
  test('parseChecksumFile parses standard format with double space', () => {
    const content = 'abc123def456  file1.txt\n' +
                    'def456abc789  file2.tar.gz\n' +
                    '111222333444  path/to/file3.dat';

    const checksums = parseChecksumFile(content);

    expect(checksums.size).toBe(3);
    expect(checksums.get('file1.txt')).toBe('abc123def456');
    expect(checksums.get('file2.tar.gz')).toBe('def456abc789');
    expect(checksums.get('path/to/file3.dat')).toBe('111222333444');
  });

  test('parseChecksumFile parses format with single space', () => {
    const content = 'abc123def456 file1.txt\n' +
                    'def456abc789 file2.tar.gz';

    const checksums = parseChecksumFile(content);

    expect(checksums.size).toBe(2);
    expect(checksums.get('file1.txt')).toBe('abc123def456');
    expect(checksums.get('file2.tar.gz')).toBe('def456abc789');
  });

  test('parseChecksumFile handles empty lines', () => {
    const content = 'abc123def456  file1.txt\n' +
                    '\n' +
                    'def456abc789  file2.tar.gz\n' +
                    '\n';

    const checksums = parseChecksumFile(content);

    expect(checksums.size).toBe(2);
    expect(checksums.get('file1.txt')).toBe('abc123def456');
    expect(checksums.get('file2.tar.gz')).toBe('def456abc789');
  });

  test('parseChecksumFile normalizes checksums to lowercase', () => {
    const content = 'ABC123DEF456  file1.txt\n' +
                    'DEF456ABC789  file2.tar.gz';

    const checksums = parseChecksumFile(content);

    expect(checksums.get('file1.txt')).toBe('abc123def456');
    expect(checksums.get('file2.tar.gz')).toBe('def456abc789');
  });

  test('parseChecksumFile handles filenames with spaces', () => {
    const content = 'abc123def456  my file with spaces.txt\n' +
                    'def456abc789  another file.tar.gz';

    const checksums = parseChecksumFile(content);

    expect(checksums.get('my file with spaces.txt')).toBe('abc123def456');
    expect(checksums.get('another file.tar.gz')).toBe('def456abc789');
  });

  test('parseChecksumFile returns empty map for empty content', () => {
    const checksums = parseChecksumFile('');
    expect(checksums.size).toBe(0);
  });

  test('parseChecksumFile ignores invalid lines', () => {
    const content = 'abc123def456  valid.txt\n' +
                    'not a valid line\n' +
                    'def456abc789  another.txt\n' +
                    '# comment line\n' +
                    '  ';

    const checksums = parseChecksumFile(content);

    expect(checksums.size).toBe(2);
    expect(checksums.get('valid.txt')).toBe('abc123def456');
    expect(checksums.get('another.txt')).toBe('def456abc789');
  });
});