import { useEffect, useState } from "react";
import BenchmarkCharts from "@/components/BenchmarkCharts";
import ResultCharts from "@/components/ResultCharts";
import { runBenchmark } from "@/lib/benchmarkEngine";
import type { BenchmarkResult } from "@/types/benchmark";

export default function DemoCharts() {
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { results: r } = await runBenchmark([
          "region latency",
          "operator throughput",
          "hourly speed",
        ]);
        if (mounted) setResults(r);
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-4">Demo Charts (Chapter 11 styles)</h1>

      <div className="space-y-6">
        <BenchmarkCharts results={results} />

        {results[0] && (
          <div>
            <h2 className="text-lg font-semibold mb-2">ResultCharts preview</h2>
            <ResultCharts columns={results[0].columns} data={results[0].data} />
          </div>
        )}
      </div>
    </div>
  );
}
