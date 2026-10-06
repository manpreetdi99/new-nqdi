import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { FitToPoints, fmtCount } from "./historicShared";

/**
 * Χάρτης σημείων των σελίδων DATA-MAP / DATA-MAP NR / NR SCANNER MAP. Τα σημεία μπαίνουν
 * imperatively σε ΕΝΑ canvas layer (όχι ένα React component ανά marker) — οι σελίδες στέλνουν
 * έως 8.000 σημεία και το react-leaflet ανά marker κολλάει το pan/zoom. Το tooltip κάθε σημείου
 * είναι string (bindTooltip), άρα δεν στήνεται DOM μέχρι το hover.
 */

export interface MapPoint {
  lat: number;
  lon: number;
  color: string;
  tooltip: string;
}

const PointsLayer = ({ points, radius }: { points: MapPoint[]; radius: number }) => {
  const map = useMap();
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.3 });
    const layer = L.layerGroup(
      points.map((p) =>
        // Λεπτό λευκό δαχτυλίδι: τα σημεία ξεχωρίζουν μεταξύ τους όταν επικαλύπτονται.
        L.circleMarker([p.lat, p.lon], { renderer, radius, color: "#ffffff", weight: 0.6, fillColor: p.color, fillOpacity: 0.9 }).bindTooltip(
          p.tooltip,
          { direction: "top", offset: [0, -4] },
        ),
      ),
    );
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, points, radius]);
  return null;
};

export const HistoricPointsMap = ({
  points,
  legend,
  height = 520,
  radius = 4,
  footnote,
}: {
  points: MapPoint[];
  /** Τα bins με τη σειρά τους (χρώμα + label + πλήθος σημείων στον χάρτη). */
  legend: { label: string; color: string; count?: number }[];
  height?: number;
  radius?: number;
  footnote?: string;
}) => {
  const coords = useMemo(() => points.map((p) => [p.lat, p.lon] as [number, number]), [points]);
  return (
    <div>
      <div className="overflow-hidden rounded-lg" style={{ height }}>
        <MapContainer center={[38.6, 23.8]} zoom={6} scrollWheelZoom preferCanvas style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToPoints points={coords} />
          <PointsLayer points={points} radius={radius} />
        </MapContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {legend.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/40" style={{ backgroundColor: item.color }} />
            <span className="text-foreground/90">{item.label}</span>
            {item.count != null && <span className="font-mono tabular-nums">{fmtCount(item.count)}</span>}
          </span>
        ))}
        {footnote && <span className="ml-auto">{footnote}</span>}
      </div>
    </div>
  );
};
