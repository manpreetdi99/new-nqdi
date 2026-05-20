import { useMemo, useEffect, useState } from "react";
import { MapPin, Phone, PhoneOff, PhoneForwarded, X, Wifi } from "lucide-react";
import type { CallRecord } from "@/lib/callData";
import type { DataSessionItem } from "@/components/DataSessionsList";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface CallsMapProps {
  calls: CallRecord[];
  onSelectCall: (call: CallRecord) => void;
  dataSessions?: DataSessionItem[];
}

// Real GPS coordinates for Greek cities
const CITY_COORDS: Record<string, [number, number]> = {
  Athens: [37.9838, 23.7275],
  Thessaloniki: [40.6401, 22.9444],
  Patras: [38.2466, 21.7346],
  Heraklion: [35.3387, 25.1442],
  Larissa: [39.6390, 22.4191],
  Volos: [39.3620, 22.9429],
  Ioannina: [39.6644, 20.8521],
  Kavala: [40.9396, 24.4069],
};

function MapBounds({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const minLat = Math.min(...points.map(p => p.lat));
    const maxLat = Math.max(...points.map(p => p.lat));
    const minLng = Math.min(...points.map(p => p.lng));
    const maxLng = Math.max(...points.map(p => p.lng));
    if (minLat === maxLat && minLng === maxLng) {
      map.setView([minLat, minLng], 12);
    } else {
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [20, 20], maxZoom: 14 });
    }
  }, [points, map]);
  return null;
}

// ── Location stat card (also acts as a filter toggle) ────────────────────────
interface LocationCardProps {
  location: string;
  total: number;
  completed: number;
  dropped: number;
  failed: number;
  systemRelease: number;
  active: boolean;
  dimmed: boolean;
  onClick: () => void;
}

function LocationCard({ location, total, completed, dropped, failed, systemRelease, active, dimmed, onClick }: LocationCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Κλικ για ${active ? "αποεπιλογή" : "φίλτρο"} — ${location}`}
      className={[
        "w-full text-left rounded-md border px-3 py-2 transition-all duration-150 cursor-pointer",
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : dimmed
          ? "border-border bg-muted/10 opacity-40"
          : "border-border bg-muted/30 hover:bg-muted/50",
      ].join(" ")}
    >
      {/* Location name */}
      <p className="text-xs font-semibold text-foreground truncate mb-1.5" title={location}>
        {location}
      </p>

      {/* Stats — one per line */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-bold text-foreground">{total}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-success flex items-center gap-1">
            <Phone className="h-2.5 w-2.5" /> Completed
          </span>
          <span className="font-mono text-success">{completed}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-warning flex items-center gap-1">
            <PhoneOff className="h-2.5 w-2.5" /> Dropped
          </span>
          <span className="font-mono text-warning">{dropped}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-destructive flex items-center gap-1">
            <PhoneForwarded className="h-2.5 w-2.5" /> Failed
          </span>
          <span className="font-mono text-destructive">{failed}</span>
        </div>
        {systemRelease > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-violet-400 flex items-center gap-1">
              <PhoneForwarded className="h-2.5 w-2.5" /> Sys.Release
            </span>
            <span className="font-mono text-violet-400">{systemRelease}</span>
          </div>
        )}
      </div>

      {/* Mini bar */}
      <div className="flex h-1 mt-2 rounded-full overflow-hidden bg-muted">
        <div className="bg-success transition-all" style={{ width: `${(completed / total) * 100}%` }} />
        <div className="bg-warning transition-all" style={{ width: `${(dropped / total) * 100}%` }} />
        <div className="bg-destructive transition-all" style={{ width: `${(failed / total) * 100}%` }} />
        <div className="bg-violet-500 transition-all" style={{ width: `${(systemRelease / total) * 100}%` }} />
      </div>
    </button>
  );
}

// ── Data session success-rate color ──────────────────────────────────────────
function dataSessionColor(passCount: number, total: number): { fill: string; stroke: string; tw: string } {
  if (total === 0) return { fill: "#6b7280", stroke: "#4b5563", tw: "text-muted-foreground" };
  const pct = (passCount / total) * 100;
  if (pct >= 90) return { fill: "#22c55e", stroke: "#16a34a", tw: "text-green-400" };
  if (pct >= 70) return { fill: "#eab308", stroke: "#ca8a04", tw: "text-yellow-400" };
  if (pct >= 50) return { fill: "#f97316", stroke: "#ea580c", tw: "text-orange-400" };
  return { fill: "#ef4444", stroke: "#dc2626", tw: "text-red-400" };
}

// ── Data session card ─────────────────────────────────────────────────────────
interface DataSessionCardProps {
  location: string;
  sessions: number;
  totalTests: number;
  passCount: number;
  failCount: number;
  active: boolean;
  dimmed: boolean;
  onClick: () => void;
}

function DataSessionCard({ location, sessions, totalTests, passCount, failCount, active, dimmed, onClick }: DataSessionCardProps) {
  const pct = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0;
  const { tw } = dataSessionColor(passCount, totalTests);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Κλικ για ${active ? "αποεπιλογή" : "φίλτρο"} — ${location}`}
      className={[
        "w-full text-left rounded-md border px-3 py-2 transition-all duration-150 cursor-pointer",
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : dimmed
          ? "border-border bg-muted/10 opacity-40"
          : "border-border bg-muted/30 hover:bg-muted/50",
      ].join(" ")}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-foreground truncate" title={location}>
          {location}
        </p>
        <span className={`text-[11px] font-mono font-bold ${tw}`}>{pct}%</span>
      </div>

      {/* Stats */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground flex items-center gap-1">
            <Wifi className="h-2.5 w-2.5" /> Sessions
          </span>
          <span className="font-mono font-bold text-foreground">{sessions}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Tests</span>
          <span className="font-mono text-foreground">{totalTests}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-green-400">Pass</span>
          <span className="font-mono text-green-400">{passCount}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-red-400">Fail</span>
          <span className="font-mono text-red-400">{failCount}</span>
        </div>
      </div>

      {/* Mini bar */}
      <div className="flex h-1 mt-2 rounded-full overflow-hidden bg-muted">
        <div
          className="transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 90 ? "#22c55e" : pct >= 70 ? "#eab308" : pct >= 50 ? "#f97316" : "#ef4444",
          }}
        />
      </div>
    </button>
  );
}

// ── main component ────────────────────────────────────────────────────────────
const CallsMap = ({ calls, onSelectCall, dataSessions = [] }: CallsMapProps) => {

  // Selected locations: [] = All (no filter)
  const [selLocations, setSelLocations] = useState<string[]>([]);

  // Reset filter when the calls dataset changes
  useEffect(() => { setSelLocations([]); }, [calls]);

  // ── Per-location stats (always from ALL calls — not filtered — so the cards always show totals)
  const locationStats = useMemo(() => {
    const stats: Record<string, { total: number; completed: number; dropped: number; failed: number; systemRelease: number }> = {};
    calls.forEach(c => {
      const loc = c.region || "Unknown";
      if (!stats[loc]) stats[loc] = { total: 0, completed: 0, dropped: 0, failed: 0, systemRelease: 0 };
      stats[loc].total++;
      if (c.status === "system release") stats[loc].systemRelease++;
      else stats[loc][c.status]++;
    });
    return stats;
  }, [calls]);

  const sortedLocations = useMemo(
    () => Object.keys(locationStats).sort((a, b) => locationStats[b].total - locationStats[a].total),
    [locationStats],
  );

  // Toggle a location in/out of the filter
  const toggleLocation = (loc: string) => {
    setSelLocations(prev => {
      if (prev.includes(loc)) {
        const next = prev.filter(v => v !== loc);
        return next; // [] → "All"
      }
      return [...prev, loc];
    });
  };

  // ── Filtered calls for the map
  const filteredCalls = useMemo(() => {
    if (selLocations.length === 0) return calls;
    return calls.filter(c => selLocations.includes(c.region));
  }, [calls, selLocations]);

  // ── Data session map points (filtered by location if active)
  const dataPoints = useMemo(() => {
    const points: Array<{ lat: number; lng: number; item: DataSessionItem }> = [];
    const filtered = selLocations.length === 0
      ? dataSessions
      : dataSessions.filter(s => selLocations.includes(s.first?.Location ?? ""));
    filtered.forEach(item => {
      const row = item.first;
      if (!row) return;
      let lat = row.latitude;
      let lng = row.longitude;
      if (lat == null || lng == null) {
        const loc = row.Location ?? "";
        if (CITY_COORDS[loc]) { lat = CITY_COORDS[loc][0]; lng = CITY_COORDS[loc][1]; }
        else {
          const matched = Object.keys(CITY_COORDS).find(city => loc.toLowerCase().includes(city.toLowerCase()));
          if (matched) { lat = CITY_COORDS[matched][0]; lng = CITY_COORDS[matched][1]; }
          else return;
        }
        lat += (Math.random() - 0.5) * 0.02;
        lng += (Math.random() - 0.5) * 0.02;
      } else {
        lat += (Math.random() - 0.5) * 0.0005;
        lng += (Math.random() - 0.5) * 0.0005;
      }
      points.push({ lat, lng, item });
    });
    return points;
  }, [dataSessions, selLocations]);

  // ── Map points
  const mapPoints = useMemo(() => {
    const points: Array<{ lat: number; lng: number; call: CallRecord }> = [];
    filteredCalls.forEach(c => {
      let lat = c.latitude;
      let lng = c.longitude;
      if (lat == null || lng == null) {
        if (c.region && CITY_COORDS[c.region]) {
          lat = CITY_COORDS[c.region][0];
          lng = CITY_COORDS[c.region][1];
        } else {
          const matched = Object.keys(CITY_COORDS).find(city =>
            c.region && c.region.toLowerCase().includes(city.toLowerCase()),
          );
          if (matched) { lat = CITY_COORDS[matched][0]; lng = CITY_COORDS[matched][1]; }
          else return;
        }
        lat += (Math.random() - 0.5) * 0.02;
        lng += (Math.random() - 0.5) * 0.02;
      } else {
        lat += (Math.random() - 0.5) * 0.0005;
        lng += (Math.random() - 0.5) * 0.0005;
      }
      points.push({ lat, lng, call: c });
    });
    return points;
  }, [filteredCalls]);

  // ── Data session stats grouped by location
  const dataLocationStats = useMemo(() => {
    const stats: Record<string, { sessions: number; totalTests: number; passCount: number; failCount: number }> = {};
    dataSessions.forEach(item => {
      const loc = item.first?.Location ?? "Unknown";
      if (!stats[loc]) stats[loc] = { sessions: 0, totalTests: 0, passCount: 0, failCount: 0 };
      stats[loc].sessions++;
      stats[loc].totalTests += item.tests.length;
      stats[loc].passCount  += item.passCount;
      stats[loc].failCount  += item.failCount;
    });
    return stats;
  }, [dataSessions]);

  const sortedDataLocations = useMemo(
    () => Object.keys(dataLocationStats).sort((a, b) => dataLocationStats[b].sessions - dataLocationStats[a].sessions),
    [dataLocationStats],
  );

  const hasFilter = selLocations.length > 0;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          Χάρτης Κλήσεων — Ελλάδα
        </h2>
        {hasFilter && (
          <button
            type="button"
            onClick={() => setSelLocations([])}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border bg-muted hover:bg-muted/70"
          >
            <X className="h-3 w-3" /> Clear filter
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Κλικ σε location για φίλτρο · κλικ σε marker για λεπτομέρειες
        {hasFilter && (
          <span className="ml-2 text-primary font-medium">
            — {filteredCalls.length} / {calls.length} calls
          </span>
        )}
      </p>

      <div className="flex gap-4">

        {/* ── Sidebar: Voice calls + Data sessions ───────────────────── */}
        <div className="w-[464px] shrink-0 overflow-y-auto max-h-[540px] pr-0.5 space-y-3">

          {/* Voice call location cards */}
          {sortedLocations.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5 flex items-center gap-1.5">
                <Phone className="h-3 w-3" /> Voice Calls
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sortedLocations.map(loc => {
                  const s = locationStats[loc];
                  return (
                    <LocationCard
                      key={loc}
                      location={loc}
                      total={s.total}
                      completed={s.completed}
                      dropped={s.dropped}
                      failed={s.failed}
                      systemRelease={s.systemRelease}
                      active={selLocations.includes(loc)}
                      dimmed={hasFilter && !selLocations.includes(loc)}
                      onClick={() => toggleLocation(loc)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Data session cards */}
          {sortedDataLocations.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5 flex items-center gap-1.5">
                <Wifi className="h-3 w-3" /> Data Sessions
                <span className="text-[9px] normal-case font-normal text-muted-foreground/50">≥90% <span className="text-green-400">●</span> 70–89% <span className="text-yellow-400">●</span> 50–69% <span className="text-orange-400">●</span> &lt;50% <span className="text-red-400">●</span></span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sortedDataLocations.map(loc => {
                  const s = dataLocationStats[loc];
                  return (
                    <DataSessionCard
                      key={`data-${loc}`}
                      location={loc}
                      sessions={s.sessions}
                      totalTests={s.totalTests}
                      passCount={s.passCount}
                      failCount={s.failCount}
                      active={selLocations.includes(loc)}
                      dimmed={hasFilter && !selLocations.includes(loc)}
                      onClick={() => toggleLocation(loc)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {sortedLocations.length === 0 && sortedDataLocations.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Δεν υπάρχουν δεδομένα.</p>
          )}
        </div>

        {/* ── Real Map ─────────────────────────────────────────────────── */}
        <div className="flex-1 relative h-[520px] min-h-[520px] rounded-lg overflow-hidden border border-border">
          <MapContainer
            center={[39.07, 23.73]}
            zoom={6}
            scrollWheelZoom={true}
            style={{ height: "100%", width: "100%" }}
          >
            <MapBounds points={mapPoints} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mapPoints.map((point) => {
              const status = point.call.status;
              let fillColor = "#048104ff";
              let color     = "#048104ff";
              let statusLabel = "Ολοκληρώθηκε";
              if (status === "dropped") {
                fillColor = "#f59e0b"; color = "#d97706"; statusLabel = "Διακόπηκε";
              } else if (status === "failed") {
                fillColor = "#ef4444"; color = "#dc2626"; statusLabel = "Απέτυχε";
              } else if (status === "system release") {
                fillColor = "#a855f7"; color = "#9333ea"; statusLabel = "System Release";
              }
              return (
                <CircleMarker
                  key={point.call.callId}
                  center={[point.lat, point.lng]}
                  radius={6}
                  pathOptions={{ fillColor, fillOpacity: 0.7, color, weight: 2 }}
                  eventHandlers={{ click: () => onSelectCall(point.call) }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                    <div className="font-sans space-y-0.5 text-center">
                      <div className="font-bold text-sm">#{point.call.callId}</div>
                      {point.call.region && (
                        <div className="text-xs text-muted-foreground">📍 {point.call.region}</div>
                      )}
                      <div className="text-xs">{statusLabel}</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}

            {/* ── Data session markers ── */}
            {dataPoints.map((point) => {
              const { fill, stroke } = dataSessionColor(point.item.passCount, point.item.tests.length);
              const pct = point.item.tests.length > 0
                ? Math.round((point.item.passCount / point.item.tests.length) * 100)
                : 0;
              return (
                <CircleMarker
                  key={`data-${point.item.sessionId}`}
                  center={[point.lat, point.lng]}
                  radius={7}
                  pathOptions={{ fillColor: fill, fillOpacity: 0.85, color: stroke, weight: 2, dashArray: "4 2" }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
                    <div className="font-sans space-y-0.5 text-center">
                      <div className="font-bold text-sm">Data #{point.item.sessionId}</div>
                      {point.item.first?.Location && (
                        <div className="text-xs text-muted-foreground">📍 {point.item.first.Location}</div>
                      )}
                      <div className="text-xs">
                        {point.item.passCount}/{point.item.tests.length} tests — {pct}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {pct >= 90 ? "✅ Excellent" : pct >= 70 ? "🟡 Good" : pct >= 50 ? "🟠 Marginal" : "🔴 Poor"}
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

      </div>
    </div>
  );
};

export default CallsMap;
