import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { logger } from './logger.ts';

export async function generateChecksum(filePath: string, algorithm: string = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);

    stream.on('error', (error) => {
      logger.error(`Failed to read file for checksum: ${filePath}`, error);
      reject(new Error(`Failed to generate checksum: ${error.message}`));
    });

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      const checksum = hash.digest('hex');
      logger.info(`Generated ${algorithm} checksum for ${filePath}`, { checksum });
      resolve(checksum);
    });
  });
}

export async function generateChecksumStream(
  stream: NodeJS.ReadableStream,
  algorithm: string = 'sha256'
): Promise<string> {
  const hash = createHash(algorithm);

  await pipeline(
    stream,
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    }
  );

  return hash.digest('hex');
}

export function verifyChecksum(
  actualChecksum: string,
  expectedChecksum: string
): boolean {
  const isValid = actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();

  if (!isValid) {
    logger.error('Checksum verification failed', new Error(
      `Expected: ${expectedChecksum}, Actual: ${actualChecksum}`
    ));
  }

  return isValid;
}

export function parseChecksumFile(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Standard checksum file format: "checksum  filename" (two spaces)
    // Also support "checksum filename" (one space)
    const match = trimmedLine.match(/^([a-f0-9]+)\s+(.+)$/i);
    if (match) {
      const [, checksum, filename] = match;
      checksums.set(filename.trim(), checksum.toLowerCase());
    }
  }

  return checksums;
}