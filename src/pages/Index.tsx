import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, BarChart3, Phone, Database, MapPin } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import QueryEditor from "@/components/QueryEditor";
import ResultsTable from "@/components/ResultsTable";
import type { BenchmarkResult } from "@/types/benchmark";
import BenchmarkCharts from "@/components/BenchmarkCharts";
import StatsCards from "@/components/StatsCards";
import CallDetail from "@/components/CallDetail";
import CallsMap from "@/components/CallsMap";
import type { CallRecord } from "@/lib/callData";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ApiClientError,
  fetchAllCalls,
  fetchCollectionNames,
  fetchDatabases,
  fetchLocations,
  runBenchmarkApi,
  type AllCallsRow,
} from "@/lib/api";

const formatApiError = (error: unknown, fallbackTitle: string) => {
  if (error instanceof ApiClientError) {
    return {
      title: `${fallbackTitle} [${error.code}]`,
      description: `${error.message} — ${error.hint}`,
    };
  }

  if (error instanceof Error) {
    return {
      title: fallbackTitle,
      description: error.message,
    };
  }

  return {
    title: fallbackTitle,
    description: "Unknown error",
  };
};

const normalizeStatus = (status: string | null | undefined): CallRecord["status"] => {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("drop")) return "dropped";
  if (normalized.includes("fail")) return "failed";
  return "completed";
};

const mapAllCallsRows = (rows: AllCallsRow[]): CallRecord[] => {
  return rows.map((row, index) => {
    const status = normalizeStatus(row.status);

    return {
      id: `session-${row.SessionId}-${index}`,
      callId: row.SessionId,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      duration_s: 0,
      operator: "N/A",
      region: row.Location || "Unknown",
      technology: "N/A",
      callType: "Session",
      status,
      setupTime_ms: 0,
      avgMos: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      latency: 0,
      jitter: 0,
      packetLoss: 0,
      events: [
        {
          timestamp: new Date().toISOString(),
          event: "Session Loaded",
          duration_ms: 0,
          status: "success",
          details: `Collection: ${row.CollectionName || "N/A"} | Latitude: ${row.latitude ?? "N/A"} | Longitude: ${row.longitude ?? "N/A"}`,
        },
      ],
    };
  });
};

const Index = () => {
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [collectionNames, setCollectionNames] = useState<string[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCallsCollection, setSelectedCallsCollection] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [callsLoading, setCallsLoading] = useState(false);
  const [allCallsRows, setAllCallsRows] = useState<AllCallsRow[]>([]);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);

  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [totalTime, setTotalTime] = useState(0);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [activeTab, setActiveTab] = useState("queries");

  useEffect(() => {
    const loadDatabases = async () => {
      try {
        const dbs = await fetchDatabases();
        setDatabases(dbs);
        if (dbs.length > 0) setSelectedDatabase(dbs[0]);
      } catch (err: any) {
        console.error("Failed to fetch databases:", err);
        const toastError = formatApiError(err, "Database Connection Error");
        toast({
          title: toastError.title,
          description: toastError.description,
          variant: "destructive",
        });
      }
    };

    loadDatabases();
  }, []);

  useEffect(() => {
    const loadCollections = async () => {
      if (!selectedDatabase) {
        setCollectionNames([]);
        return;
      }

      setCollectionsLoading(true);

      try {
        const names = await fetchCollectionNames(selectedDatabase);
        setCollectionNames(names);
      } catch (err: any) {
        console.error("Failed to fetch collections:", err);
        setCollectionNames([]);
        const toastError = formatApiError(err, "Collections Fetch Failed");
        toast({
          title: toastError.title,
          description: toastError.description,
          variant: "destructive",
        });
      } finally {
        setCollectionsLoading(false);
      }
    };

    loadCollections();
  }, [selectedDatabase]);

  useEffect(() => {
    setSelectedCallsCollection("");
    setSelectedLocation("");
    setLocations([]);
    setAllCallsRows([]);
    setCallRecords([]);
    setSelectedCall(null);
  }, [selectedDatabase]);

  useEffect(() => {
    setSelectedCallsCollection((prev) =>
      prev && collectionNames.includes(prev) ? prev : "",
    );
  }, [collectionNames]);

  useEffect(() => {
    const loadLocations = async () => {
      if (!selectedDatabase || !selectedCallsCollection) {
        setLocations([]);
        setSelectedLocation("");
        return;
      }

      setLocationsLoading(true);

      try {
        const names = await fetchLocations(selectedDatabase, selectedCallsCollection);
        setLocations(names);
        setSelectedLocation((prev) => (prev && names.includes(prev) ? prev : ""));
      } catch (err: any) {
        console.error("Failed to fetch locations:", err);
        setLocations([]);
        setSelectedLocation("");
        const toastError = formatApiError(err, "Locations Fetch Failed");
        toast({
          title: toastError.title,
          description: toastError.description,
          variant: "destructive",
        });
      } finally {
        setLocationsLoading(false);
      }
    };

    loadLocations();
  }, [selectedDatabase, selectedCallsCollection]);

  useEffect(() => {
    const loadAllCalls = async () => {
      if (!selectedDatabase || !selectedCallsCollection || !selectedLocation) {
        setAllCallsRows([]);
        setCallRecords([]);
        setSelectedCall(null);
        return;
      }

      setCallsLoading(true);

      try {
        const rows = await fetchAllCalls(selectedDatabase, selectedCallsCollection, selectedLocation);
        setAllCallsRows(rows);
        const mapped = mapAllCallsRows(rows);
        setCallRecords(mapped);
        setSelectedCall(null);
      } catch (err: any) {
        console.error("Failed to fetch calls:", err);
        setAllCallsRows([]);
        setCallRecords([]);
        setSelectedCall(null);
        const toastError = formatApiError(err, "All Calls Fetch Failed");
        toast({
          title: toastError.title,
          description: toastError.description,
          variant: "destructive",
        });
      } finally {
        setCallsLoading(false);
      }
    };

    loadAllCalls();
  }, [selectedDatabase, selectedCallsCollection, selectedLocation]);

  const handleRunQueries = async (queries: string[]) => {
    if (!selectedDatabase) return;

    setIsRunning(true);
    setResults([]);

    try {
      const { results: newResults, totalTime: time } = await runBenchmarkApi(selectedDatabase, queries);
      setResults(newResults);
      setTotalTime(time);
      toast({ title: "Benchmark Complete", description: `${newResults.length} queries executed in ${time}ms` });
    } catch (err: any) {
      console.error("Benchmark error:", err);
      const toastError = formatApiError(err, "Benchmark Failed");
      toast({
        title: toastError.title,
        description: toastError.description,
        variant: "destructive",
      });
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
              <Activity className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">
                FASMETRICS <span className="text-red-500">Analytics</span>
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
                <p className="mt-2 text-xs text-muted-foreground">
                  If the list is empty, check the toast error code. <span className="font-medium">NET-001</span> means the preview cannot reach your local Python server on <span className="font-medium">localhost:8000</span>.
                </p>
              </div>

              <QueryEditor
                onRunQueries={handleRunQueries}
                isRunning={isRunning}
                collectionNames={collectionNames}
                collectionsLoading={collectionsLoading}
              />
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Collection</label>
                  <select
                    value={selectedCallsCollection}
                    onChange={(e) => setSelectedCallsCollection(e.target.value)}
                    className="mt-1 w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">Select collection</option>
                    {collectionNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium">Location</label>
                  <select
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    disabled={!selectedCallsCollection || locationsLoading}
                    className="mt-1 w-full bg-muted border border-border rounded-md px-3 py-2 text-sm disabled:opacity-60"
                  >
                    <option value="">{locationsLoading ? "Loading locations..." : "Select location"}</option>
                    {locations.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">All Calls</h2>
                  <p className="text-xs text-muted-foreground">
                    {callsLoading
                      ? "Loading..."
                      : `${allCallsRows.length} rows`}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground uppercase tracking-wider">
                      <th className="px-4 py-2 font-semibold">SessionId</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                      <th className="px-4 py-2 font-semibold">CollectionName</th>
                      <th className="px-4 py-2 font-semibold">Location</th>
                      <th className="px-4 py-2 font-semibold">Latitude</th>
                      <th className="px-4 py-2 font-semibold">Longitude</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!callsLoading && allCallsRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                          Select collection and location to load calls.
                        </td>
                      </tr>
                    )}
                    {allCallsRows.map((row, idx) => (
                      <tr key={`${row.SessionId}-${idx}`} className="border-b border-border/60 hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono text-foreground">{row.SessionId}</td>
                        <td className="px-4 py-2 text-foreground">{row.status ?? "N/A"}</td>
                        <td className="px-4 py-2 text-foreground">{row.CollectionName ?? "N/A"}</td>
                        <td className="px-4 py-2 text-foreground">{row.Location ?? "N/A"}</td>
                        <td className="px-4 py-2 font-mono text-foreground">{row.latitude ?? "N/A"}</td>
                        <td className="px-4 py-2 font-mono text-foreground">{row.longitude ?? "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="map">
            <CallsMap
              calls={callRecords}
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