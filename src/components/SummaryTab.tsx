import { Phone, Wifi } from "lucide-react";

interface VoiceLocationRow {
  location: string;
  complete: number;
  drop: number;
  fail: number;
  sysRelease: number;
  total: number;
}

interface DataLocationRow {
  location: string;
  sessions: number;
  pass: number;
  fail: number;
}

interface SummaryTabProps {
  locationSummary: VoiceLocationRow[];
  locationSummaryTotals: Omit<VoiceLocationRow, "location">;
  dataLocationSummary: DataLocationRow[];
  dataLocationSummaryTotals: Omit<DataLocationRow, "location">;
}

const formatRate = (numerator: number, denominator: number): string => {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

const SummaryTab = ({
  locationSummary,
  locationSummaryTotals,
  dataLocationSummary,
  dataLocationSummaryTotals,
}: SummaryTabProps) => {
  return (
    <div className="space-y-6">
      {/* ── Voice Calls by Location ── */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Voice Calls ανά Τοποθεσία</h2>
        </div>
        {locationSummary.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Δεν υπάρχουν δεδομένα. Επιλέξτε database / collections από το tab "All Calls".
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2 font-semibold">Location</th>
                  <th className="px-4 py-2 font-semibold text-right text-green-400">Complete</th>
                  <th className="px-4 py-2 font-semibold text-right text-violet-400">Sys Release</th>
                  <th className="px-4 py-2 font-semibold text-right text-orange-400">Drop</th>
                  <th className="px-4 py-2 font-semibold text-right text-red-400">Fail</th>
                  <th className="px-4 py-2 font-semibold text-right">Total</th>
                  <th className="px-4 py-2 font-semibold text-right">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {locationSummary.map((row) => (
                  <tr key={row.location} className="border-b border-border/60">
                    <td className="px-4 py-2 font-medium text-foreground">{row.location}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-400">{row.complete || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-violet-400">{row.sysRelease || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-orange-400">{row.drop || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-400">{row.fail || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{row.total}</td>
                    <td className="px-4 py-2 text-right font-mono text-foreground">
                      {formatRate(row.complete, row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20 font-semibold">
                  <td className="px-4 py-2 text-foreground">Total</td>
                  <td className="px-4 py-2 text-right font-mono text-green-400">{locationSummaryTotals.complete || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-violet-400">{locationSummaryTotals.sysRelease || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-orange-400">{locationSummaryTotals.drop || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-400">{locationSummaryTotals.fail || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{locationSummaryTotals.total}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">
                    {formatRate(locationSummaryTotals.complete, locationSummaryTotals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Data Sessions by Location ── */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Data Sessions ανά Τοποθεσία</h2>
        </div>
        {dataLocationSummary.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Δεν υπάρχουν δεδομένα. Επιλέξτε database / collections από το tab "All Calls".
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2 font-semibold">Location</th>
                  <th className="px-4 py-2 font-semibold text-right">Sessions</th>
                  <th className="px-4 py-2 font-semibold text-right text-green-400">Pass</th>
                  <th className="px-4 py-2 font-semibold text-right text-red-400">Fail</th>
                  <th className="px-4 py-2 font-semibold text-right">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {dataLocationSummary.map((row) => (
                  <tr key={row.location} className="border-b border-border/60">
                    <td className="px-4 py-2 font-medium text-foreground">{row.location}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{row.sessions}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-400">{row.pass || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-400">{row.fail || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-foreground">
                      {formatRate(row.pass, row.pass + row.fail)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20 font-semibold">
                  <td className="px-4 py-2 text-foreground">Total</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{dataLocationSummaryTotals.sessions}</td>
                  <td className="px-4 py-2 text-right font-mono text-green-400">{dataLocationSummaryTotals.pass || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-400">{dataLocationSummaryTotals.fail || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">
                    {formatRate(dataLocationSummaryTotals.pass, dataLocationSummaryTotals.pass + dataLocationSummaryTotals.fail)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SummaryTab;
