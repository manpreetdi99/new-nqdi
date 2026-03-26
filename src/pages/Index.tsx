import { useState } from "react";
import { motion } from "framer-motion";
import { Activity, BarChart3, Table2 } from "lucide-react";
import QueryEditor from "@/components/QueryEditor";
import ResultsTable from "@/components/ResultsTable";
import type { BenchmarkResult } from "@/components/ResultsTable";
import BenchmarkCharts from "@/components/BenchmarkCharts";
import StatsCards from "@/components/StatsCards";
import { runBenchmark } from "@/lib/benchmarkEngine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Index = () => {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalTime, setTotalTime] = useState(0);

  const handleRunQueries = async (queries: string[]) => {
    setIsRunning(true);
    setResults([]);
    try {
      const { results: newResults, totalTime: time } = await runBenchmark(queries);
      setResults(newResults);
      setTotalTime(time);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center glow-primary">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">
                SmartBench<span className="text-primary">Analytics</span>
              </h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Network Quality Benchmarking
              </p>
            </div>
          </div>
          {results.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
              {results.length} queries completed
            </motion.div>
          )}
        </div>
      </header>

      <main className="container max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Query Editor */}
        <section className="bg-card border border-border rounded-lg p-4">
          <QueryEditor onRunQueries={handleRunQueries} isRunning={isRunning} />
        </section>

        {/* Loading */}
        {isRunning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center py-16"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Εκτέλεση benchmarks...</p>
            </div>
          </motion.div>
        )}

        {/* Results */}
        {!isRunning && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <StatsCards results={results} totalTime={totalTime} />

            <Tabs defaultValue="charts" className="w-full">
              <TabsList className="bg-muted border border-border">
                <TabsTrigger value="charts" className="gap-1.5 text-xs">
                  <BarChart3 className="h-3.5 w-3.5" /> Charts
                </TabsTrigger>
                <TabsTrigger value="tables" className="gap-1.5 text-xs">
                  <Table2 className="h-3.5 w-3.5" /> Tables
                </TabsTrigger>
              </TabsList>
              <TabsContent value="charts" className="mt-4">
                <BenchmarkCharts results={results} />
              </TabsContent>
              <TabsContent value="tables" className="mt-4">
                <ResultsTable results={results} />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}

        {/* Empty State */}
        {!isRunning && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <BarChart3 className="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">
              Έτοιμο για Benchmarking
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Προσθέστε τα queries σας και πατήστε "Run Benchmark" για να δείτε
              αποτελέσματα σε πίνακες και γραφήματα.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
