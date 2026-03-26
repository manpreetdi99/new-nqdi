import { useMemo } from "react";
import { motion } from "framer-motion";
import { MapPin, Phone, PhoneOff, PhoneForwarded } from "lucide-react";
import type { CallRecord } from "@/lib/callData";

interface CallsMapProps {
  calls: CallRecord[];
  onSelectCall: (call: CallRecord) => void;
}

// Approximate coordinates for Greek cities (normalized to SVG viewBox)
const CITY_COORDS: Record<string, { x: number; y: number }> = {
  Athens: { x: 310, y: 370 },
  Thessaloniki: { x: 290, y: 180 },
  Patras: { x: 230, y: 360 },
  Heraklion: { x: 330, y: 520 },
  Larissa: { x: 280, y: 250 },
  Volos: { x: 300, y: 270 },
  Ioannina: { x: 210, y: 210 },
  Kavala: { x: 330, y: 170 },
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
        {/* SVG Map */}
        <div className="flex-1 relative">
          <svg viewBox="100 80 350 500" className="w-full h-auto max-h-[520px]">
            {/* Simplified Greece outline */}
            <path
              d="M200,100 L240,95 L280,100 L320,95 L350,110 L370,140 L360,160 L340,155 L330,170 L350,180 L340,200 L320,190 L300,200 L310,220 L300,240 L310,260 L300,280 L310,300 L300,320 L280,310 L270,330 L280,350 L300,360 L320,370 L330,390 L310,400 L280,390 L260,400 L240,380 L220,370 L210,350 L220,330 L200,310 L190,280 L200,260 L190,240 L200,220 L190,200 L210,190 L200,170 L210,150 L200,130 Z"
              className="fill-muted/30 stroke-border"
              strokeWidth="1.5"
            />
            {/* Crete */}
            <path
              d="M270,490 L300,485 L340,490 L370,500 L380,510 L360,520 L320,525 L280,520 L260,510 L265,500 Z"
              className="fill-muted/30 stroke-border"
              strokeWidth="1.5"
            />
            {/* Peloponnese hint */}
            <path
              d="M220,370 L240,380 L260,400 L250,420 L230,430 L210,420 L200,400 L210,380 Z"
              className="fill-muted/30 stroke-border"
              strokeWidth="1.5"
            />

            {/* City bubbles */}
            {Object.entries(CITY_COORDS).map(([city, coords]) => {
              const stat = regionStats[city];
              if (!stat) return null;
              const radius = Math.max(12, Math.min(30, stat.total * 4));
              const failRate = (stat.dropped + stat.failed) / stat.total;

              return (
                <g key={city}>
                  {/* Glow */}
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={radius + 4}
                    className={failRate > 0.3 ? "fill-warning/10" : "fill-primary/10"}
                  />
                  {/* Main bubble */}
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={radius}
                    className={`${failRate > 0.3 ? "fill-warning/20 stroke-warning/60" : "fill-primary/20 stroke-primary/60"} cursor-pointer hover:fill-primary/40 transition-colors`}
                    strokeWidth="1.5"
                    onClick={() => stat.calls[0] && onSelectCall(stat.calls[0])}
                  />
                  {/* Count text */}
                  <text
                    x={coords.x}
                    y={coords.y + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground text-[11px] font-bold font-mono pointer-events-none"
                  >
                    {stat.total}
                  </text>
                  {/* City label */}
                  <text
                    x={coords.x}
                    y={coords.y + radius + 12}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px] pointer-events-none"
                  >
                    {city}
                  </text>
                </g>
              );
            })}
          </svg>
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
