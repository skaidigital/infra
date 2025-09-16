declare module '@sanity/export' {
  import type { SanityClient } from '@sanity/client';

  export interface ExportOptions {
    client: SanityClient;
    dataset: string;
    outputPath: string;
    assets?: boolean;
    raw?: boolean;
    drafts?: boolean;
    assetConcurrency?: number;
    onProgress?: (event: {
      step?: string;
      current?: number;
      total?: number;
      percentage?: number;
    }) => void;
  }

  export interface ExportResult {
    documents?: number;
    assets?: number;
  }

  export default function exportDataset(options: ExportOptions): Promise<ExportResult | void>;
}