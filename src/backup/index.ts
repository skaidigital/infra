import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as tar from 'tar';
import { exportSanityDataset } from './sanity-export.ts';
import { uploadToR2, deleteOldBackups } from './r2-upload.ts';
import { sendNotification } from './notifications.ts';
import { generateChecksum } from '../utils/checksum.ts';
import { withRetry } from '../utils/retry.ts';
import { logger } from '../utils/logger.ts';

interface BackupConfig {
  projectId: string;
  dataset: string;
  includeDrafts: boolean;
  includeAssets: boolean;
  assetConcurrency: number;
  retainCount: number;
  r2Prefix: string;
}

interface BackupResult {
  objectKey: string;
  objectSize: number;
  backupTimestamp: string;
  checksum: string;
  duration: number;
}

export async function runBackup(): Promise<BackupResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const config: BackupConfig = {
    projectId: process.env.SANITY_PROJECT_ID!,
    dataset: process.env.SANITY_DATASET!,
    includeDrafts: process.env.INCLUDE_DRAFTS === 'true',
    includeAssets: process.env.INCLUDE_ASSETS === 'true',
    assetConcurrency: parseInt(process.env.ASSET_CONCURRENCY || '6', 10),
    retainCount: parseInt(process.env.RETAIN_COUNT || '7', 10),
    r2Prefix: process.env.R2_PREFIX || 'sanity',
  };

  logger.info('Starting backup', {
    projectId: config.projectId,
    dataset: config.dataset,
    timestamp
  });

  const tempDir = join(tmpdir(), `sanity-backup-${timestamp}`);
  const exportDir = join(tempDir, 'export');
  const archivePath = join(tempDir, `${config.projectId}-${config.dataset}-${timestamp}.tar.gz`);

  try {
    // Create temporary directory
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(exportDir, { recursive: true });

    // Step 1: Export Sanity dataset
    logger.info('Exporting Sanity dataset...');
    await withRetry(
      () => exportSanityDataset({
        projectId: config.projectId,
        dataset: config.dataset,
        outputPath: exportDir,
        token: process.env.SANITY_TOKEN!,
        includeDrafts: config.includeDrafts,
        includeAssets: config.includeAssets,
        assetConcurrency: config.assetConcurrency,
      }),
      3,
      1000
    );

    // Step 2: Create tar.gz archive
    logger.info('Creating archive...');
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: tempDir,
        filter: (path: string) => !path.includes('.DS_Store'),
      },
      ['export']
    );

    // Step 3: Generate checksum
    logger.info('Generating checksum...');
    const checksum = await generateChecksum(archivePath);
    const checksumPath = `${archivePath}.sha256`;
    await fs.writeFile(checksumPath, `${checksum}  ${archivePath.split('/').pop()}\n`);

    // Step 4: Get file size
    const stats = await fs.stat(archivePath);
    const fileSizeBytes = stats.size;
    const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);

    // Step 5: Upload to R2
    logger.info('Uploading to R2...', { size: `${fileSizeMB} MB` });
    // Direct structure: projectId/dataset/filename (no top-level prefix)
    const objectKey = `${config.projectId}/${config.dataset}/${config.projectId}-${config.dataset}-${timestamp}.tar.gz`;

    await withRetry(
      () => uploadToR2(archivePath, objectKey),
      3,
      2000
    );

    // Upload checksum file
    await withRetry(
      () => uploadToR2(checksumPath, `${objectKey}.sha256`),
      3,
      2000
    );

    // Step 6: Clean up old backups
    logger.info('Cleaning up old backups...');
    await withRetry(
      () => deleteOldBackups(
        `${config.projectId}/${config.dataset}/`,
        config.retainCount
      ),
      3,
      1000
    );

    // Calculate duration
    const duration = Math.round((Date.now() - startTime) / 1000);

    // Step 7: Send success notification
    const result: BackupResult = {
      objectKey,
      objectSize: fileSizeBytes,
      backupTimestamp: timestamp,
      checksum,
      duration,
    };

    await sendNotification({
      status: 'success',
      projectId: config.projectId,
      dataset: config.dataset,
      backupSize: fileSizeMB,
      objectKey,
      duration,
    });

    // Output for GitHub Actions
    console.log(`objectKey: ${objectKey}`);
    console.log(`objectSize: ${fileSizeBytes}`);
    console.log(`backupTimestamp: ${timestamp}`);

    logger.info('Backup completed successfully', result);

    return result;

  } catch (error) {
    logger.error('Backup failed', error as Error);

    // Send failure notification
    await sendNotification({
      status: 'failure',
      projectId: config.projectId,
      dataset: config.dataset,
      error: (error as Error).message,
    });

    throw error;

  } finally {
    // Clean up temporary files
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      logger.info('Cleaned up temporary files');
    } catch (cleanupError) {
      logger.warn('Failed to clean up temporary files', cleanupError as Error);
    }
  }
}

// Run backup if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Backup failed:', error);
      process.exit(1);
    });
}