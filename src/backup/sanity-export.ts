import exportDataset from '@sanity/export';
import { createClient } from '@sanity/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.ts';

export interface ExportOptions {
  projectId: string;
  dataset: string;
  outputPath: string;
  token: string;
  includeDrafts?: boolean;
  includeAssets?: boolean;
  assetConcurrency?: number;
}

export async function exportSanityDataset(options: ExportOptions): Promise<void> {
  const {
    projectId,
    dataset,
    outputPath,
    token,
    includeDrafts = true,
    includeAssets = true,
    assetConcurrency = 6,
  } = options;

  logger.info('Starting Sanity export', { projectId, dataset, outputPath });

  // Ensure output directory exists
  await fs.mkdir(outputPath, { recursive: true });

  // Create Sanity client
  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion: '2021-06-07',
    useCdn: false,
  });

  // When raw is false, outputPath should be a tar.gz file
  // When raw is true, outputPath should be a directory
  const tarballPath = join(outputPath, 'export.tar.gz');

  const exportOptions = {
    client,
    dataset, // Export function needs dataset even though client has it
    outputPath: tarballPath, // Use file path for tarball
    assets: includeAssets,
    raw: false, // Export as tarball
    drafts: includeDrafts,
    assetConcurrency,
    onProgress: (event: any) => {
      // Log progress events
      if (event.step) {
        logger.info(`Export progress: ${event.step}`, {
          current: event.current,
          total: event.total,
          percentage: event.percentage,
        });
      }
    },
  };

  try {
    // Run the export
    logger.info('Calling exportDataset with options', {
      projectId,
      dataset,
      hasClient: !!exportOptions.client,
      assets: exportOptions.assets,
      drafts: exportOptions.drafts,
    });

    const result = await exportDataset(exportOptions);

    // Log results
    if (result) {
      logger.info('Sanity export completed', {
        documents: result.documents || 0,
        assets: result.assets || 0,
      });
    } else {
      logger.info('Sanity export completed');
    }

    // Verify the tarball was created
    try {
      const stats = await fs.stat(tarballPath);
      if (stats.size === 0) {
        throw new Error('Export file is empty');
      }
      logger.info('Export tarball created', {
        path: tarballPath,
        fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
      });
    } catch (error) {
      throw new Error(`Failed to create export tarball: ${(error as Error).message}`);
    }

  } catch (error) {
    const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
    logger.error('Sanity export failed', new Error(errorMessage));
    throw new Error(`Sanity export failed: ${errorMessage}`);
  }
}

export async function validateSanityCredentials(
  projectId: string,
  token: string
): Promise<boolean> {
  try {
    // Use Sanity API to validate credentials
    const response = await fetch(`https://api.sanity.io/v2021-06-07/projects/${projectId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.ok) {
      logger.info('Sanity credentials validated successfully');
      return true;
    } else {
      logger.error('Sanity credentials validation failed', new Error(`Status: ${response.status}`));
      return false;
    }
  } catch (error) {
    logger.error('Sanity credentials validation failed', error as Error);
    return false;
  }
}