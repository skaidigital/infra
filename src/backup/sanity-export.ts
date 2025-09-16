import { spawn } from 'child_process';
import { promises as fs, existsSync } from 'fs';
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

    // Try multiple possible locations for the Sanity CLI
    const possiblePaths = [
      // In GitHub Actions, the working directory is where the infra repo is checked out
      join(process.cwd(), 'node_modules', '@sanity', 'cli', 'bin', 'sanity.js'),
      // Try relative to this file's location
      join(__dirname, '..', '..', 'node_modules', '@sanity', 'cli', 'bin', 'sanity.js'),
    ];

    // Try using require.resolve as a separate step
    try {
      possiblePaths.push(require.resolve('@sanity/cli/bin/sanity.js'));
    } catch {
      // Ignore if not found
    }

    let sanityCliPath: string | undefined;
    for (const path of possiblePaths) {
      // Check if file exists
      if (existsSync(path)) {
        sanityCliPath = path;
        logger.info(`Found Sanity CLI at: ${path}`);
        break;
      }
    }

    if (!sanityCliPath) {
      // Fallback to using npx which should work universally
      logger.info('Could not find Sanity CLI directly, falling back to npx');
      const sanityProcess = spawn('npx', ['@sanity/cli', ...args], {
        env: {
          ...process.env,
          SANITY_AUTH_TOKEN: token,
        },
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      setupProcessHandlers(sanityProcess, outputPath, token, resolve, reject, includeAssets);
      return;
    }

    const sanityProcess = spawn('bun', [sanityCliPath, ...args], {
      env: {
        ...process.env,
        SANITY_AUTH_TOKEN: token,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    setupProcessHandlers(sanityProcess, outputPath, token, resolve, reject, includeAssets);
  });
}

function setupProcessHandlers(
  sanityProcess: any,
  outputPath: string,
  token: string,
  resolve: (value: void | PromiseLike<void>) => void,
  reject: (reason?: any) => void,
  includeAssets: boolean = true
): void {
  let stdout = '';
  let stderr = '';

  // Handle spawn errors immediately
  sanityProcess.on('error', (error: any) => {
      logger.error('Failed to spawn Sanity CLI', error);
      const errorMessage = error?.message || error?.code || String(error) || 'Unknown error';
      reject(new Error(`Failed to start Sanity export: ${errorMessage}`));
    });

    sanityProcess.stdout?.on('data', (data: Buffer) => {
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

    sanityProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      // Only log non-sensitive errors
      if (!output.includes(token)) {
        logger.warn('Sanity CLI stderr', new Error(output));
      }
    });

    sanityProcess.on('close', async (code: number | null) => {
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

    sanityProcess.stdout?.on('data', (data: Buffer) => {
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