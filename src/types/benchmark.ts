export type CellValue = string | number | boolean | null;

export interface BenchmarkResult {
  id: string;
  queryLabel: string;
  executionTime: number;
  rowsReturned: number;
  columns: string[];
  data: Record<string, CellValue>[];
}