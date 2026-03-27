import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, BarChart3, Phone, Database, MapPin } from "lucide-react";
import QueryEditor from "@/components/QueryEditor";
import ResultsTable from "@/components/ResultsTable";
import type { BenchmarkResult } from "@/types/benchmark";
import BenchmarkCharts from "@/components/BenchmarkCharts";
import StatsCards from "@/components/StatsCards";
import CallsList from "@/components/CallsList";
import CallDetail from "@/components/CallDetail";
import CallsFilter, { type CallFilters } from "@/components/CallsFilter";
import CallsSummary from "@/components/CallsSummary";
import CallsMap from "@/components/CallsMap";
import { generateCallRecords, type CallRecord } from "@/lib/callData";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchDatabases, runBenchmarkApi } from "@/lib/api";

const defaultFilters: CallFilters = {
  operator: "all",
  status: "all",
  technology: "all",
  region: "all",
  callType: "all",
};

const Index = () => {
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState("");

  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalTime, setTotalTime] = useState(0);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [activeTab, setActiveTab] = useState("queries");
  const [filters, setFilters] = useState<CallFilters>(defaultFilters);

  const callRecords = useMemo(() => generateCallRecords(35), []);

  useEffect(() => {
    const loadDatabases = async () => {
      try {
        const dbs = await fetchDatabases();
        setDatabases(dbs);
        if (dbs.length > 0) setSelectedDatabase(dbs[0]);
      } catch (err) {
        console.error(err);
      }
    };

    loadDatabases();
  }, []);

  const filteredCalls = useMemo(() => {
    return callRecords.filter((c) => {
      if (filters.operator !== "all" && c.operator !== filters.operator) return false;
      if (filters.status !== "all" && c.status !== filters.status) return false;
      if (filters.technology !== "all" && c.technology !== filters.technology) return false;
      if (filters.region !== "all" && c.region !== filters.region) return false;
      if (filters.callType !== "all" && c.callType !== filters.callType) return false;
      return true;
    });
  }, [callRecords, filters]);

  const handleRunQueries = async (queries: string[]) => {
    if (!selectedDatabase) return;

    setIsRunning(true);
    setResults([]);

    try {
      const { results: newResults, totalTime: time } = await runBenchmarkApi(selectedDatabase, queries);
      setResults(newResults);
      setTotalTime(time);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
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

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{callRecords.length} calls recorded</span>
            {results.length > 0 && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
                {results.length} queries completed
              </motion.span>
            )}
          </div>
        </div>
      </header>

      <main className="container max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-muted border border-border mb-6">
            <TabsTrigger value="queries" className="gap-1.5 text-xs">
              <Database className="h-3.5 w-3.5" /> Queries
            </TabsTrigger>
            <TabsTrigger value="calls" className="gap-1.5 text-xs">
              <Phone className="h-3.5 w-3.5" /> All Calls
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5 text-xs">
              <MapPin className="h-3.5 w-3.5" /> Map
            </TabsTrigger>
            <TabsTrigger value="detail" className="gap-1.5 text-xs" disabled={!selectedCall}>
              <BarChart3 className="h-3.5 w-3.5" /> Call Detail
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queries" className="space-y-6">
            <section className="bg-card border border-border rounded-lg p-4 space-y-4">
              <div>
                <label className="text-sm font-medium">Database</label>
                <select
                  value={selectedDatabase}
                  onChange={(e) => setSelectedDatabase(e.target.value)}
                  className="mt-2 w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Select database</option>
                  {databases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>
              </div>

              <QueryEditor onRunQueries={handleRunQueries} isRunning={isRunning} />
            </section>

            {isRunning && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground">Εκτέλεση benchmarks...</p>
                </div>
              </motion.div>
            )}

            {!isRunning && results.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <StatsCards results={results} totalTime={totalTime} />
                <BenchmarkCharts results={results} />
                <ResultsTable results={results} />
              </motion.div>
            )}

            {!isRunning && results.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <BarChart3 className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-1">Έτοιμο για Benchmarking</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Προσθέστε τα queries σας και πατήστε "Run Benchmark" για αποτελέσματα.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="calls" className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <CallsFilter calls={callRecords} filters={filters} onFiltersChange={setFilters} />
            </div>

            <CallsSummary calls={filteredCalls} />

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">All Calls</h2>
                  <p className="text-xs text-muted-foreground">
                    {filteredCalls.length} κλήσεις {filteredCalls.length !== callRecords.length && `(από ${callRecords.length} συνολικά)`}
                  </p>
                </div>
              </div>
              <CallsList
                calls={filteredCalls}
                onSelectCall={(call) => {
                  setSelectedCall(call);
                  setActiveTab("detail");
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="map">
            <CallsMap
              calls={filteredCalls}
              onSelectCall={(call) => {
                setSelectedCall(call);
                setActiveTab("detail");
              }}
            />
          </TabsContent>

          <TabsContent value="detail">
            {selectedCall ? (
              <CallDetail call={selectedCall} onBack={() => setActiveTab("calls")} />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Phone className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Επιλέξτε μια κλήση από το tab "All Calls" για να δείτε λεπτομέρειες.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;