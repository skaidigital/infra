import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { basename } from 'path';
import { logger } from '../utils/logger.ts';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 credentials not configured');
    }

    // R2 buckets are in EU region
    const endpoint = `https://${accountId}.eu.r2.cloudflarestorage.com`;

    s3Client = new S3Client({
      region: 'auto', // Always use 'auto' for R2
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  return s3Client;
}

export async function uploadToR2(filePath: string, objectKey: string): Promise<void> {
  // Validate credentials before attempting any operations
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials not configured');
  }

  if (!bucket) {
    throw new Error('R2_BUCKET not configured');
  }

  const client = getS3Client();

  try {
    const fileStats = await fs.stat(filePath);
    const fileStream = createReadStream(filePath);
    const fileName = basename(filePath);

    logger.info(`Uploading ${fileName} to R2`, {
      bucket,
      key: objectKey,
      size: `${(fileStats.size / 1024 / 1024).toFixed(2)} MB`,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fileStream,
      ContentType: getContentType(fileName),
      ContentLength: fileStats.size,
      Metadata: {
        'original-filename': fileName,
        'upload-timestamp': new Date().toISOString(),
      },
    });

    await client.send(command);

    // Verify upload
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    });

    const headResponse = await client.send(headCommand);

    if (headResponse.ContentLength !== fileStats.size) {
      throw new Error(
        `Upload verification failed: size mismatch (expected ${fileStats.size}, got ${headResponse.ContentLength})`
      );
    }

    logger.info(`Successfully uploaded ${fileName} to R2`, {
      key: objectKey,
      size: headResponse.ContentLength,
      etag: headResponse.ETag,
    });
  } catch (error) {
    logger.error('Failed to upload to R2', error as Error);
    throw new Error(`R2 upload failed: ${(error as Error).message}`);
  }
}

export async function deleteOldBackups(prefix: string, retainCount: number): Promise<void> {
  const client = getS3Client();
  const bucket = process.env.R2_BUCKET;

  if (!bucket) {
    throw new Error('R2_BUCKET not configured');
  }

  try {
    logger.info(`Checking for old backups to delete`, { prefix, retainCount });

    // List all objects with the prefix
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
    });

    const listResponse = await client.send(listCommand);

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      logger.info('No backups found to manage');
      return;
    }

    // Filter for .tar.gz files only (ignore .sha256 files)
    const backups = listResponse.Contents
      .filter(obj => obj.Key && obj.Key.endsWith('.tar.gz'))
      .sort((a, b) => {
        // Sort by LastModified date, newest first
        const dateA = a.LastModified?.getTime() || 0;
        const dateB = b.LastModified?.getTime() || 0;
        return dateB - dateA;
      });

    logger.info(`Found ${backups.length} backups`);

    if (backups.length <= retainCount) {
      logger.info(`All backups within retention limit (${backups.length}/${retainCount})`);
      return;
    }

    // Identify backups to delete (older than retention count)
    const backupsToDelete = backups.slice(retainCount);

    // Include both .tar.gz and .sha256 files for deletion
    const keysToDelete: string[] = [];
    backupsToDelete.forEach(backup => {
      if (backup.Key) {
        keysToDelete.push(backup.Key);
        keysToDelete.push(`${backup.Key}.sha256`);
      }
    });

    logger.info(`Deleting ${backupsToDelete.length} old backups (${keysToDelete.length} total files)`);

    // Delete objects in batches (S3 allows max 1000 per request)
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keysToDelete.map(Key => ({ Key })),
        Quiet: false,
      },
    });

    const deleteResponse = await client.send(deleteCommand);

    if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
      logger.error('Some deletions failed', new Error(JSON.stringify(deleteResponse.Errors)));
      throw new Error(`Failed to delete some backups: ${deleteResponse.Errors.length} errors`);
    }

    logger.info(`Successfully deleted ${deleteResponse.Deleted?.length || 0} old backup files`);
  } catch (error) {
    logger.error('Failed to manage backup retention', error as Error);
    throw new Error(`Retention management failed: ${(error as Error).message}`);
  }
}

export async function listBackups(prefix: string): Promise<Array<{
  key: string;
  size: number;
  lastModified: Date;
}>> {
  const client = getS3Client();
  const bucket = process.env.R2_BUCKET;

  if (!bucket) {
    throw new Error('R2_BUCKET not configured');
  }

  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
    });

    const response = await client.send(listCommand);

    if (!response.Contents) {
      return [];
    }

    return response.Contents
      .filter(obj => obj.Key && obj.Key.endsWith('.tar.gz'))
      .map(obj => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
      }))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  } catch (error) {
    logger.error('Failed to list backups', error as Error);
    throw new Error(`Failed to list backups: ${(error as Error).message}`);
  }
}

export async function downloadBackup(objectKey: string, outputPath: string): Promise<void> {
  const client = getS3Client();
  const bucket = process.env.R2_BUCKET;

  if (!bucket) {
    throw new Error('R2_BUCKET not configured');
  }

  try {
    logger.info(`Downloading backup from R2`, { key: objectKey, outputPath });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('No data received from R2');
    }

    // Convert stream to buffer and write to file
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    await fs.writeFile(outputPath, buffer);

    logger.info(`Successfully downloaded backup`, {
      key: objectKey,
      size: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
    });
  } catch (error) {
    logger.error('Failed to download from R2', error as Error);
    throw new Error(`R2 download failed: ${(error as Error).message}`);
  }
}

function getContentType(fileName: string): string {
  if (fileName.endsWith('.tar.gz')) {
    return 'application/gzip';
  }
  if (fileName.endsWith('.sha256')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}