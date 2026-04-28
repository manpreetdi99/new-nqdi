import { useMemo, useEffect, useState } from "react";
import { MapPin, Phone, PhoneOff, PhoneForwarded, X } from "lucide-react";
import type { CallRecord } from "@/lib/callData";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface CallsMapProps {
  calls: CallRecord[];
  onSelectCall: (call: CallRecord) => void;
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

// ── main component ────────────────────────────────────────────────────────────
const CallsMap = ({ calls, onSelectCall }: CallsMapProps) => {

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

        {/* ── Location cards sidebar ──────────────────────────────────── */}
        <div className="w-[464px] shrink-0 grid grid-cols-2 gap-2 overflow-y-auto max-h-[540px] pr-0.5 content-start">
          {sortedLocations.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Δεν υπάρχουν δεδομένα.</p>
          )}
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
          </MapContainer>
        </div>

      </div>
    </div>
  );
};

export default CallsMap;
