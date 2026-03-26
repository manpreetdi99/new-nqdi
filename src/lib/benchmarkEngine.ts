import type { BenchmarkResult } from "@/components/ResultsTable";

// Simulated data generator for benchmarking demo
const OPERATORS = ["Cosmote", "Vodafone", "Wind", "Nova"];
const REGIONS = ["Athens", "Thessaloniki", "Patras", "Heraklion", "Larissa", "Volos"];
const TEST_TYPES = ["Download", "Upload", "Latency", "Jitter", "DNS"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

function rand(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function generateQueryResult(query: string, index: number): BenchmarkResult {
  const q = query.toLowerCase();

  // Pattern 1: Region latency
  if (q.includes("region") && q.includes("latency")) {
    return {
      id: `result-${index}-${Date.now()}`,
      queryLabel: "Avg Latency by Region",
      executionTime: Math.round(rand(30, 250)),
      rowsReturned: REGIONS.length,
      columns: ["region", "avg_latency", "samples"],
      data: REGIONS.map((r) => ({
        region: r,
        avg_latency: rand(15, 120),
        samples: Math.round(rand(500, 5000)),
      })),
    };
  }

  // Pattern 2: Operator throughput
  if (q.includes("operator") || q.includes("throughput")) {
    const data: Record<string, string | number>[] = [];
    OPERATORS.forEach((op) => {
      TEST_TYPES.forEach((tt) => {
        data.push({
          operator: op,
          test_type: tt,
          p95_throughput: rand(5, 150),
        });
      });
    });
    return {
      id: `result-${index}-${Date.now()}`,
      queryLabel: "P95 Throughput by Operator & Test",
      executionTime: Math.round(rand(50, 400)),
      rowsReturned: data.length,
      columns: ["operator", "test_type", "p95_throughput"],
      data,
    };
  }

  // Pattern 3: Hourly speed
  if (q.includes("hour") || q.includes("speed") || q.includes("download")) {
    return {
      id: `result-${index}-${Date.now()}`,
      queryLabel: "Hourly Avg Download & Upload Speed",
      executionTime: Math.round(rand(80, 350)),
      rowsReturned: HOURS.length,
      columns: ["hour", "avg_dl", "avg_ul"],
      data: HOURS.map((h) => ({
        hour: h,
        avg_dl: rand(20, 180),
        avg_ul: rand(5, 50),
      })),
    };
  }

  // Default: generic benchmark
  return {
    id: `result-${index}-${Date.now()}`,
    queryLabel: `Benchmark Query ${index + 1}`,
    executionTime: Math.round(rand(20, 600)),
    rowsReturned: REGIONS.length,
    columns: ["category", "metric_a", "metric_b", "metric_c"],
    data: REGIONS.map((r) => ({
      category: r,
      metric_a: rand(10, 100),
      metric_b: rand(5, 80),
      metric_c: rand(1, 50),
    })),
  };
}

export async function runBenchmark(queries: string[]): Promise<{
  results: BenchmarkResult[];
  totalTime: number;
}> {
  const start = performance.now();

  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200));

  const results = queries.map((q, i) => generateQueryResult(q, i));
  const totalTime = Math.round(performance.now() - start);

  return { results, totalTime };
}
