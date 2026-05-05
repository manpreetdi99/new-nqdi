import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Filter, Loader2, RefreshCw, X } from "lucide-react";

// We load Leaflet lazily via CDN to avoid SSR issues.
// The map is rendered into a raw div, so no react-leaflet types needed.
declare global {
  interface Window {
    L: any;
  }
}

interface AntennaRow {
  lat: number;
  lon: number;
  siteId: number | null;
  cellId: number | null;
  cellName: string | null;
  azimuth: number | null;
  freq: number | null;
  vendor: string | null;
  enbName: string | null;
  tech: string | null;
  status: string | null;
  pci: number | null;
  downtilt: number | null;
  height: number | null;
}

// Frequency options found in the dataset
const FREQ_OPTIONS = [700, 800, 900, 1800, 2100, 2600];
const VENDOR_OPTIONS = ["Ericsson", "Huawei", "Nokia", "ZTE"];
const STATUS_OPTIONS = ["ACTIVATED", "DEACTIVATED"];

// Color per frequency band
const freqColor = (freq: number | null): string => {
  if (freq === 700)  return "#ff6b35";
  if (freq === 800)  return "#f7c59f";
  if (freq === 900)  return "#e0a0ff";
  if (freq === 1800) return "#4ecdc4";
  if (freq === 2100) return "#45b7d1";
  if (freq === 2600) return "#96e6a1";
  return "#aaaaaa";
};

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const CLUSTER_CSS = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css";
const CLUSTER_DEFAULT_CSS = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css";
const CLUSTER_JS  = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadLink(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href;
  document.head.appendChild(l);
}

export default function AntennasMap() {
  const mapDivRef  = useRef<HTMLDivElement>(null);
  const mapRef     = useRef<any>(null);
  const layerRef   = useRef<any>(null);
  const allDataRef = useRef<AntennaRow[]>([]);

  const [loading, setLoading]       = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [total, setTotal]           = useState(0);
  const [shown, setShown]           = useState(0);

  // Filters
  const [selectedFreqs, setSelectedFreqs]     = useState<number[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus]   = useState<string>(""); // "" = all
  const [showFilters, setShowFilters]         = useState(false);

  // ---- Load Leaflet + MarkerCluster from CDN ----
  useEffect(() => {
    loadLink(LEAFLET_CSS);
    loadLink(CLUSTER_CSS);
    loadLink(CLUSTER_DEFAULT_CSS);

    loadScript(LEAFLET_JS)
      .then(() => loadScript(CLUSTER_JS))
      .then(() => setLeafletReady(true))
      .catch(() => setError("Αδυναμία φόρτωσης Leaflet από CDN."));
  }, []);

  // ---- Initialize map once Leaflet is ready ----
  useEffect(() => {
    if (!leafletReady || !mapDivRef.current || mapRef.current) return;
    const L = window.L;

    const map = L.map(mapDivRef.current, {
      center: [38.5, 23.5],
      zoom: 7,
      preferCanvas: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
  }, [leafletReady]);

  // ---- Fetch antennas ----
  const fetchAntennas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      selectedFreqs.forEach(f => params.append("freq", String(f)));
      selectedVendors.forEach(v => params.append("vendor", v));
      if (selectedStatus) params.set("status", selectedStatus);

      const url = `http://localhost:8000/api/antennas${params.toString() ? "?" + params.toString() : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      allDataRef.current = json.antennas as AntennaRow[];
      setTotal(json.total);
    } catch (e: any) {
      setError(e.message || "Αποτυχία φόρτωσης");
    } finally {
      setLoading(false);
    }
  }, [selectedFreqs, selectedVendors, selectedStatus]);

  // ---- Render markers on map ----
  const renderMarkers = useCallback(() => {
    if (!mapRef.current || !window.L) return;
    const L = window.L;

    // Remove old layer
    if (layerRef.current) {
      mapRef.current.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    const data = allDataRef.current;
    if (!data.length) { setShown(0); return; }

    // Group by site+azimuth → one marker per (site, direction).
    // Co-directional frequencies share the same axis and get concentric rings.
    const noAzimuth: AntennaRow[] = [];
    const groupMap = new Map<string, AntennaRow[]>();
    data.forEach((a) => {
      if (a.azimuth == null) { noAzimuth.push(a); return; }
      const siteKey = a.siteId != null
        ? `s${a.siteId}`
        : `ll${a.lat.toFixed(4)}_${a.lon.toFixed(4)}`;
      const key = `${siteKey}_az${a.azimuth}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(a);
    });

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 50,
      maxClusterRadius: 40,
      iconCreateFunction: (c: any) => {
        const cnt = c.getChildCount();
        const size = cnt < 10 ? 28 : cnt < 100 ? 34 : cnt < 1000 ? 40 : 46;
        return L.divIcon({
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:rgba(30,144,255,0.85);border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${cnt}</div>`,
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    // Build a 60° sector SVG (±30° from azimuth axis) with one concentric ring per frequency.
    // sin30=0.5, cos30=0.866. North = −y in SVG coords.
    // Ring 0: solid sector from center to outerR.
    // Ring k>0: annular sector — M−ox,−oy A outerR 0,1 ox,−oy L ix,−iy A innerR 0,0 −ix,−iy Z
    const BASE_R = 7;
    const RING_W = 5;
    const GAP    = 1;

    const buildIcon = (antennas: AntennaRow[], az: number) => {
      const n    = antennas.length;
      const maxR = BASE_R + (n - 1) * (RING_W + GAP) + RING_W;
      const sz   = (maxR + 4) * 2;
      const c    = sz / 2;
      let paths  = '';

      antennas.forEach((a, rank) => {
        const color  = freqColor(a.freq);
        const outerR = BASE_R + rank * (RING_W + GAP) + RING_W;
        const innerR = rank === 0 ? 0 : BASE_R + rank * (RING_W + GAP);
        const ox = (outerR * 0.5).toFixed(1);
        const oy = (outerR * 0.866).toFixed(1);

        if (innerR === 0) {
          paths += `<path d="M0,0 L-${ox},-${oy} A${outerR},${outerR} 0 0,1 ${ox},-${oy} Z" fill="${color}" stroke="white" stroke-width="0.6" fill-opacity="0.88"/>`;
        } else {
          const ix = (innerR * 0.5).toFixed(1);
          const iy = (innerR * 0.866).toFixed(1);
          paths += `<path d="M-${ox},-${oy} A${outerR},${outerR} 0 0,1 ${ox},-${oy} L${ix},-${iy} A${innerR},${innerR} 0 0,0 -${ix},-${iy} Z" fill="${color}" stroke="white" stroke-width="0.6" fill-opacity="0.88"/>`;
        }
      });
      paths += `<circle cx="0" cy="0" r="2" fill="white" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`;

      return {
        sz, c,
        html: `<svg width="${sz}" height="${sz}" viewBox="${-c} ${-c} ${sz} ${sz}" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(${az})">${paths}</g></svg>`,
      };
    };

    // One marker per (site, azimuth) group
    groupMap.forEach((antennas) => {
      const a0 = antennas[0];
      const az = a0.azimuth!;
      const { sz, c, html } = buildIcon(antennas, az);

      const freqRows = antennas.map(a => {
        const col = freqColor(a.freq);
        return `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;border-top:1px solid #eee">
          <div style="width:9px;height:9px;border-radius:50%;background:${col};flex-shrink:0"></div>
          <b style="color:${col}">${a.freq ?? "—"} MHz</b>
          <span style="color:#888">${a.cellName ?? "N/A"}</span>
          <span style="color:#666">PCI:${a.pci ?? "—"}</span>
        </div>`;
      }).join('');

      const marker = L.marker([a0.lat, a0.lon], {
        icon: L.divIcon({ html, className: "", iconSize: [sz, sz], iconAnchor: [c, c] }),
      });
      marker.bindPopup(`
        <div style="font-family:monospace;font-size:12px;line-height:1.6;min-width:220px">
          <b style="font-size:13px">Site ${a0.siteId ?? "?"} &middot; ${az}°</b>
          <span style="color:#888;font-size:10px"> (${antennas.length} freq)</span><br/>
          <span style="color:#888">eNB:</span> ${a0.enbName ?? "—"} &nbsp;|&nbsp;
          <span style="color:#888">Vendor:</span> ${a0.vendor ?? "—"}<br/>
          <span style="color:#888">Height:</span> ${a0.height ?? "—"} m &nbsp;|&nbsp;
          <span style="color:#888">Tilt:</span> ${a0.downtilt ?? "—"}°<br/>
          <div style="margin-top:4px">${freqRows}</div>
          <span style="color:#666;font-size:10px">${a0.lat.toFixed(6)}, ${a0.lon.toFixed(6)}</span>
        </div>
      `, { maxWidth: 300 });
      cluster.addLayer(marker);
    });

    // Antennas without azimuth → simple dot
    noAzimuth.forEach((a) => {
      const color = freqColor(a.freq);
      const marker = L.marker([a.lat, a.lon], {
        icon: L.divIcon({
          html: `<div style="width:8px;height:8px;border-radius:50%;background:${color};border:1.5px solid rgba(255,255,255,0.8);box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>`,
          className: "", iconSize: [8, 8], iconAnchor: [4, 4],
        }),
      });
      marker.bindPopup(`
        <div style="font-family:monospace;font-size:12px;line-height:1.6;min-width:200px">
          <b style="font-size:13px">${a.cellName ?? "N/A"}</b><br/>
          <span style="color:#888">Site:</span> ${a.siteId ?? "—"} &nbsp;|&nbsp;
          <span style="color:#888">Cell:</span> ${a.cellId ?? "—"}<br/>
          <span style="color:#888">Freq:</span> <b style="color:${color}">${a.freq ?? "—"} MHz</b>&nbsp;|&nbsp;
          <span style="color:#888">PCI:</span> ${a.pci ?? "—"}<br/>
          <span style="color:#888">Vendor:</span> ${a.vendor ?? "—"}&nbsp;|&nbsp;
          <span style="color:#888">Status:</span> ${a.status ?? "—"}<br/>
          <span style="color:#666;font-size:10px">${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}</span>
        </div>
      `, { maxWidth: 280 });
      cluster.addLayer(marker);
    });

    mapRef.current.addLayer(cluster);
    layerRef.current = cluster;
    setShown(data.length);
  }, []);

  // Fetch on mount + when filters change
  useEffect(() => {
    fetchAntennas();
  }, [fetchAntennas]);

  // Re-render markers after data loads
  useEffect(() => {
    if (!loading && leafletReady) renderMarkers();
  }, [loading, leafletReady, renderMarkers]);

  const toggleFreq = (f: number) =>
    setSelectedFreqs(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  const toggleVendor = (v: string) =>
    setSelectedVendors(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const clearFilters = () => {
    setSelectedFreqs([]);
    setSelectedVendors([]);
    setSelectedStatus("");
  };

  const hasFilters = selectedFreqs.length > 0 || selectedVendors.length > 0 || selectedStatus !== "";

  return (
    <div className="relative w-full h-[calc(100vh-160px)] min-h-[500px] rounded-lg overflow-hidden border border-border bg-card">

      {/* ---- Top toolbar ---- */}
      <div className="absolute top-2 left-2 z-[500] flex items-center gap-2">
        {/* Title badge */}
        <div className="flex items-center gap-1.5 bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-1.5 shadow-lg">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Cosmote 4G Antennas</span>
          {!loading && total > 0 && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {shown.toLocaleString()} / {total.toLocaleString()}
            </span>
          )}
          {loading && <Loader2 className="h-3 w-3 animate-spin text-primary ml-1" />}
        </div>

        {/* Filter button */}
        <button
          type="button"
          onClick={() => setShowFilters(p => !p)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shadow-lg text-xs font-medium transition-colors ${
            hasFilters
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card/90 backdrop-blur border-border text-foreground hover:bg-muted"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {hasFilters && (
            <span className="ml-0.5 h-4 w-4 rounded-full bg-primary-foreground text-primary text-[9px] flex items-center justify-center font-bold">
              {selectedFreqs.length + selectedVendors.length + (selectedStatus ? 1 : 0)}
            </span>
          )}
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={fetchAntennas}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card/90 backdrop-blur shadow-lg text-xs text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ---- Filter panel ---- */}
      {showFilters && (
        <div className="absolute top-12 left-2 z-[500] w-64 bg-card/95 backdrop-blur border border-border rounded-lg shadow-2xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Φίλτρα</span>
            <div className="flex gap-1.5">
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted hover:bg-muted/70 text-foreground">
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setShowFilters(false)} className="p-0.5 rounded hover:bg-muted/70">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Frequency */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Συχνότητα (MHz)</p>
            <div className="flex flex-wrap gap-1.5">
              {FREQ_OPTIONS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFreq(f)}
                  className="text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors"
                  style={selectedFreqs.includes(f) ? {
                    background: freqColor(f),
                    borderColor: freqColor(f),
                    color: "#fff",
                  } : {
                    background: "transparent",
                    borderColor: freqColor(f),
                    color: freqColor(f),
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Vendor */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Vendor</p>
            <div className="flex flex-wrap gap-1.5">
              {VENDOR_OPTIONS.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVendor(v)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors ${
                    selectedVendors.includes(v)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Status</p>
            <div className="flex gap-1.5">
              {["", ...STATUS_OPTIONS].map(s => (
                <button
                  key={s || "all"}
                  type="button"
                  onClick={() => setSelectedStatus(s)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors ${
                    selectedStatus === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {s || "All"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- Legend ---- */}
      <div className="absolute bottom-6 right-2 z-[500] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 shadow-lg">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Freq (MHz)</p>
        {FREQ_OPTIONS.map(f => (
          <div key={f} className="flex items-center gap-2 mb-0.5">
            <div className="w-2.5 h-2.5 rounded-full border border-white/60" style={{ background: freqColor(f) }} />
            <span className="text-[11px] text-foreground font-mono">{f}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-0.5">
          <div className="w-2.5 h-2.5 rounded-full border border-white/60 bg-[#aaa]" />
          <span className="text-[11px] text-muted-foreground font-mono">other</span>
        </div>
      </div>

      {/* ---- Error ---- */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-[600] bg-background/80">
          <div className="bg-card border border-destructive rounded-lg p-6 text-center max-w-sm">
            <p className="text-sm font-semibold text-destructive mb-1">Σφάλμα φόρτωσης</p>
            <p className="text-xs text-muted-foreground mb-3">{error}</p>
            <button
              type="button"
              onClick={fetchAntennas}
              className="text-xs px-3 py-1.5 rounded border border-border bg-muted hover:bg-muted/70"
            >
              Επανάληψη
            </button>
          </div>
        </div>
      )}

      {/* ---- Loading overlay (first load) ---- */}
      {loading && total === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[600] bg-background/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-foreground font-medium">Φόρτωση αντενών...</p>
            <p className="text-xs text-muted-foreground">Πρώτη φόρτωση ~5s (60k εγγραφές)</p>
          </div>
        </div>
      )}

      {/* ---- Map container ---- */}
      <div ref={mapDivRef} className="w-full h-full" />
    </div>
  );
}
