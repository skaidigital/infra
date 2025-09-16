import { spawn } from 'child_process';
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

  // Build the export command arguments
  const args = [
    'dataset',
    'export',
    dataset,
    join(outputPath, 'data.ndjson'),
    '--project', projectId,
    '--token', token,
    '--overwrite',
  ];

  if (!includeDrafts) {
    args.push('--no-drafts');
  }

  if (!includeAssets) {
    args.push('--no-assets');
  } else {
    args.push('--asset-concurrency', assetConcurrency.toString());
  }

  return new Promise((resolve, reject) => {
    logger.info('Running Sanity CLI export command...');

    // Use bun to run @sanity/cli directly from node_modules
    // __dirname gives us the directory of this file, we need to go up to find node_modules
    const sanityCliPath = join(__dirname, '..', '..', 'node_modules', '@sanity', 'cli', 'bin', 'sanity.js');
    const sanityProcess = spawn('bun', [sanityCliPath, ...args], {
      env: {
        ...process.env,
        SANITY_AUTH_TOKEN: token,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Handle spawn errors immediately
    sanityProcess.on('error', (error: any) => {
      logger.error('Failed to spawn Sanity CLI', error);
      const errorMessage = error?.message || error?.code || String(error) || 'Unknown error';
      reject(new Error(`Failed to start Sanity export: ${errorMessage}`));
    });

    sanityProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      // Log progress without exposing sensitive data
      const lines = output.split('\n').filter((line: string) => line.trim());
      lines.forEach((line: string) => {
        if (line.includes('Exporting') || line.includes('Done') || line.includes('%')) {
          logger.info(line.replace(token, '[REDACTED]'));
        }
      });
    });

    sanityProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      // Only log non-sensitive errors
      if (!output.includes(token)) {
        logger.warn('Sanity CLI stderr', new Error(output));
      }
    });

    sanityProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          // Verify the export was successful
          const exportFile = join(outputPath, 'data.ndjson');
          const stats = await fs.stat(exportFile);

          if (stats.size === 0) {
            reject(new Error('Export file is empty'));
            return;
          }

          // Check for assets directory if assets were included
          if (includeAssets) {
            const assetsDir = join(outputPath, 'images');
            try {
              await fs.access(assetsDir);
              const assetFiles = await fs.readdir(assetsDir, { recursive: true });
              logger.info(`Exported ${assetFiles.length} asset files`);
            } catch {
              logger.info('No assets exported (directory does not exist)');
            }
          }

          logger.info('Sanity export completed successfully', {
            fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
          });

          resolve();
        } catch (error) {
          const errorMessage = (error as Error)?.message || String(error) || 'Unknown error';
          reject(new Error(`Export verification failed: ${errorMessage}`));
        }
      } else {
        const errorMessage = stderr || stdout || 'Unknown error';
        logger.error('Sanity export failed', new Error(errorMessage));
        reject(new Error(`Sanity export failed with code ${code}: ${errorMessage}`));
      }
    });
  });
}

export async function validateSanityCredentials(
  projectId: string,
  token: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      'projects',
      'list',
      '--token', token,
    ];

    const sanityProcess = spawn('npx', ['@sanity/cli', ...args], {
      env: {
        ...process.env,
        SANITY_AUTH_TOKEN: token,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';

    sanityProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    sanityProcess.on('close', (code) => {
      if (code === 0 && stdout.includes(projectId)) {
        logger.info('Sanity credentials validated successfully');
        resolve(true);
      } else {
        logger.error('Sanity credentials validation failed', new Error('Invalid credentials or project not found'));
        resolve(false);
      }
    });

    sanityProcess.on('error', () => {
      resolve(false);
    });
  });
}