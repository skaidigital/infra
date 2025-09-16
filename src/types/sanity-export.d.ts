declare module '@sanity/export' {
  export interface ExportOptions {
    projectId: string;
    dataset: string;
    outputPath: string;
    token?: string;
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