import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import DemoCharts from "./pages/DemoCharts.tsx";
import NotFound from "./pages/NotFound.tsx";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import LoginScreen from "@/components/auth/LoginScreen";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Τα datasets είναι ιστορικά drive-test αποτελέσματα — δεν αλλάζουν από κάτω μας.
      // Με staleTime, το να ξαναδιαλέξεις ένα collection που είδες ήδη είναι instant
      // αντί για 10 fresh round trips (βλ. Summary tab).
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Χωρίς έγκυρο session δεν φορτώνει καμία σελίδα της εφαρμογής — μόνο login / αίτημα πρόσβασης.
const AuthGate = () => {
  const { status } = useAuth();

  if (status === "checking") {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (status === "signed-out") return <LoginScreen />;

  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/demo-charts" element={<DemoCharts />} />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <AuthGate />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
