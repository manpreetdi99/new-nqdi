import { useMemo } from "react";
import { motion } from "framer-motion";
import { MapPin, Phone, PhoneOff, PhoneForwarded } from "lucide-react";
import type { CallRecord } from "@/lib/callData";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
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

const statusColors = {
  completed: "fill-success stroke-success",
  dropped: "fill-warning stroke-warning",
  failed: "fill-destructive stroke-destructive",
};

const statusIcons = {
  completed: Phone,
  dropped: PhoneOff,
  failed: PhoneForwarded,
};

const CallsMap = ({ calls, onSelectCall }: CallsMapProps) => {
  const regionStats = useMemo(() => {
    const stats: Record<string, { total: number; completed: number; dropped: number; failed: number; calls: CallRecord[] }> = {};
    calls.forEach((c) => {
      if (!stats[c.region]) stats[c.region] = { total: 0, completed: 0, dropped: 0, failed: 0, calls: [] };
      stats[c.region].total++;
      stats[c.region][c.status]++;
      stats[c.region].calls.push(c);
    });
    return stats;
  }, [calls]);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        Χάρτης Κλήσεων — Ελλάδα
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Κατανομή κλήσεων ανά περιοχή · κλικ σε bubble για λεπτομέρειες
      </p>

      <div className="flex gap-6">
        {/* Real Map with React-Leaflet */}
        <div className="flex-1 relative h-[520px] min-h-[520px] rounded-lg overflow-hidden border border-border">
          <MapContainer 
            center={[39.07, 23.73]} 
            zoom={6} 
            scrollWheelZoom={true} 
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {Object.entries(CITY_COORDS).map(([city, coords]) => {
              const stat = regionStats[city];
              if (!stat) return null;
              
              const radius = Math.max(10, Math.min(25, stat.total * 2));
              const failRate = (stat.dropped + stat.failed) / stat.total;
              const hasHighFailRate = failRate > 0.3;

              return (
                <CircleMarker
                  key={city}
                  center={coords}
                  radius={radius}
                  pathOptions={{
                    fillColor: hasHighFailRate ? "#f59e0b" : "#3b82f6",
                    fillOpacity: 0.6,
                    color: hasHighFailRate ? "#ea580c" : "#2563eb",
                    weight: 2,
                  }}
                  eventHandlers={{
                    click: () => stat.calls[0] && onSelectCall(stat.calls[0]),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                    <div className="text-center font-sans space-y-1">
                      <div className="font-bold text-sm">{city}</div>
                      <div className="text-xs text-muted-foreground">{stat.total} calls</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {/* Side panel: region breakdown */}
        <div className="w-64 space-y-2 shrink-0">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Ανά Περιοχή
          </h3>
          {Object.entries(regionStats)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([region, stat], i) => (
              <motion.div
                key={region}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="bg-muted/30 border border-border rounded-md px-3 py-2"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{region}</span>
                  <span className="text-xs font-mono text-muted-foreground">{stat.total} calls</span>
                </div>
                <div className="flex gap-3 text-[10px]">
                  <span className="text-success flex items-center gap-0.5">
                    <Phone className="h-2.5 w-2.5" /> {stat.completed}
                  </span>
                  <span className="text-warning flex items-center gap-0.5">
                    <PhoneOff className="h-2.5 w-2.5" /> {stat.dropped}
                  </span>
                  <span className="text-destructive flex items-center gap-0.5">
                    <PhoneForwarded className="h-2.5 w-2.5" /> {stat.failed}
                  </span>
                </div>
                {/* Mini bar */}
                <div className="flex h-1 mt-1.5 rounded-full overflow-hidden bg-muted">
                  <div className="bg-success" style={{ width: `${(stat.completed / stat.total) * 100}%` }} />
                  <div className="bg-warning" style={{ width: `${(stat.dropped / stat.total) * 100}%` }} />
                  <div className="bg-destructive" style={{ width: `${(stat.failed / stat.total) * 100}%` }} />
                </div>
              </motion.div>
            ))}

          {/* Legend */}
          <div className="flex items-center gap-3 pt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> Completed</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> Dropped</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> Failed</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallsMap;
