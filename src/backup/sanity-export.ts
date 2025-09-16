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

  // Ensure output directory exists before any operations
  await fs.mkdir(outputPath, { recursive: true });

  // Use Sanity Export API directly
  // Note: The export API endpoint doesn't support excludeDrafts parameter
  // It always includes drafts when authenticated
  const exportUrl = `https://${projectId}.api.sanity.io/v2021-06-07/data/export/${dataset}`;

  logger.info('Starting dataset export via API...');

  try {
    // Export documents
    const response = await fetch(exportUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/x-ndjson',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Export API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from export API');
    }

    // Stream the export data to file
    const exportFile = join(outputPath, 'data.ndjson');

    // Use Bun's file writing capabilities directly
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(exportFile, Buffer.from(arrayBuffer));

    logger.info('Dataset export completed');

    // Verify the export was successful
    const stats = await fs.stat(exportFile);
    if (stats.size === 0) {
      throw new Error('Export file is empty');
    }

    logger.info('Export file created', {
      fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
    });

    // Handle assets export if requested
    if (includeAssets) {
      await exportAssets(projectId, dataset, outputPath, token, assetConcurrency);
    }

  } catch (error) {
    const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
    logger.error('Sanity export failed', new Error(errorMessage));
    throw new Error(`Sanity export failed: ${errorMessage}`);
  }
}

async function exportAssets(
  projectId: string,
  dataset: string,
  outputPath: string,
  token: string,
  assetConcurrency: number
): Promise<void> {
  logger.info('Starting asset export...');

  try {
    // Read the exported data to find asset references
    const exportFile = join(outputPath, 'data.ndjson');
    const data = await fs.readFile(exportFile, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim());

    const assetUrls = new Set<string>();

    for (const line of lines) {
      try {
        const doc = JSON.parse(line);
        // Find asset references in the document
        findAssetUrls(doc, assetUrls, projectId, dataset);
      } catch {
        // Skip invalid JSON lines
      }
    }

    if (assetUrls.size === 0) {
      logger.info('No assets found to export');
      return;
    }

    logger.info(`Found ${assetUrls.size} assets to download`);

    // Create images directory
    const imagesDir = join(outputPath, 'images');
    await fs.mkdir(imagesDir, { recursive: true });

    // Download assets with concurrency control
    const urls = Array.from(assetUrls);
    const results = [];

    for (let i = 0; i < urls.length; i += assetConcurrency) {
      const batch = urls.slice(i, i + assetConcurrency);
      const batchResults = await Promise.allSettled(
        batch.map(url => downloadAsset(url, imagesDir, token))
      );
      results.push(...batchResults);
    }

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info(`Asset export completed: ${successful} successful, ${failed} failed`);

    if (failed > 0) {
      logger.warn(`Failed to download ${failed} assets`);
    }
  } catch (error) {
    logger.warn('Asset export failed', error as Error);
    // Don't fail the entire export if assets fail
  }
}

function findAssetUrls(obj: any, urls: Set<string>, projectId: string, dataset: string): void {
  if (!obj || typeof obj !== 'object') return;

  // Check for Sanity image/file references
  if (obj._type === 'image' && obj.asset?._ref) {
    const ref = obj.asset._ref;
    if (ref.startsWith('image-')) {
      // Parse image reference: image-{id}-{dimensions}-{format}
      const match = ref.match(/^image-([a-f0-9]+)-([0-9]+x[0-9]+)-([a-z]+)$/);
      if (match) {
        const [, id, , format] = match;
        const url = `https://cdn.sanity.io/images/${projectId}/${dataset}/${id}.${format}`;
        urls.add(url);
      }
    }
  }

  if (obj._type === 'file' && obj.asset?._ref) {
    const ref = obj.asset._ref;
    if (ref.startsWith('file-')) {
      // Parse file reference: file-{id}-{extension}
      const match = ref.match(/^file-([a-f0-9]+)-([a-z0-9]+)$/);
      if (match) {
        const [, id, ext] = match;
        const url = `https://cdn.sanity.io/files/${projectId}/${dataset}/${id}.${ext}`;
        urls.add(url);
      }
    }
  }

  // Recursively search for assets
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findAssetUrls(item, urls, projectId, dataset);
    }
  } else {
    for (const value of Object.values(obj)) {
      findAssetUrls(value, urls, projectId, dataset);
    }
  }
}

async function downloadAsset(url: string, outputDir: string, token: string): Promise<void> {
  try {
    // Sanity CDN assets are publicly accessible, no auth needed
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    // Extract filename from URL
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1];
    const filepath = join(outputDir, filename);

    const buffer = await response.arrayBuffer();
    await fs.writeFile(filepath, Buffer.from(buffer));
  } catch (error) {
    throw new Error(`Failed to download asset ${url}: ${(error as Error).message}`);
  }
}


export async function validateSanityCredentials(
  projectId: string,
  token: string
): Promise<boolean> {
  try {
    // Use Sanity API to validate credentials by attempting to fetch project info
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