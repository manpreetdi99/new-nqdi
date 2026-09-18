import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Pane, useMap } from "react-leaflet";
import type { CircleMarkerProps } from "react-leaflet";
import { createElementObject, createPathComponent, extendContext, updateCircle } from "@react-leaflet/core";
import { CircleMarker as LeafletCircleMarker, Tooltip as LeafletTooltipClass } from "leaflet";
import type {
  CircleMarker as LeafletCircleMarkerType,
  PathOptions,
  Map as LeafletMap,
  LeafletEventHandlerFnMap,
  LeafletEvent as LeafletLeafletEvent,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Play,
  MapPin,
  Settings2,
  ChevronDown,
  AlertCircle,
  X,
  Layers,
  ArrowRightLeft,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { runBenchmarkApi, fetchCollectionNames, fetchLocations } from "@/lib/api";
import { useUrlStringState } from "@/hooks/use-url-state";
import type { CellValue } from "@/types/benchmark";
import {
  COLOR_SCHEMES,
  BUBBLE_TIERS,
  colorForValue,
  bucketKeyForValue,
  bubbleColor,
  bubbleTierLabel,
  computeBucketCounters,
  buildDynamicPciCategories,
  type ColorScheme,
  type CategoryScheme,
} from "@/lib/mapColorSchemes";
import { TEMPLATES, type MapMode } from "@/lib/queryMapTemplates";

// ── Greek city coordinates (for bubble/aggregate mode) ────────────────────────
const CITY_COORDS: Record<string, [number, number]> = {
  Athens: [37.9838, 23.7275],
  Thessaloniki: [40.6401, 22.9444],
  Patras: [38.2466, 21.7346],
  Heraklion: [35.3387, 25.1442],
  Larissa: [39.639, 22.4191],
  Volos: [39.362, 22.9429],
  Ioannina: [39.6644, 20.8521],
  Kavala: [40.9396, 24.4069],
  Chania: [35.5138, 24.018],
  Rhodes: [36.4341, 28.2176],
  Alexandroupoli: [40.8459, 25.8753],
  Serres: [41.0854, 23.5479],
  Drama: [41.1502, 24.1477],
  Katerini: [40.2705, 22.5023],
  Trikala: [39.556, 21.7683],
  Lamia: [38.8986, 22.4349],
  Chalcis: [38.462, 23.595],
  Agrinio: [38.6213, 21.4077],
  Corinth: [37.9401, 22.9286],
  Tripoli: [37.5102, 22.3785],
  Sparta: [37.0736, 22.4294],
  Kalamata: [37.039, 22.1149],
  Mytilene: [39.1074, 26.5543],
  Chios: [38.3702, 26.1371],
  Samos: [37.75, 26.977],
  Kos: [36.8921, 27.2877],
  Corfu: [39.6243, 19.9217],
  Zakynthos: [37.7902, 20.8954],
};

// ── Resolve city-name → coords (used in bubble mode) ─────────────────────────
function resolveCity(name: string): { lat: number; lng: number } | null {
  if (CITY_COORDS[name]) return { lat: CITY_COORDS[name][0], lng: CITY_COORDS[name][1] };
  const matched = Object.keys(CITY_COORDS).find((c) =>
    name.toLowerCase().includes(c.toLowerCase()),
  );
  return matched ? { lat: CITY_COORDS[matched][0], lng: CITY_COORDS[matched][1] } : null;
}

// ── Auto-fit bounds ───────────────────────────────────────────────────────────
// Δουλεύουμε με έτοιμα bounds αντί για πίνακα σημείων: με 3 layers × 20.000
// σημεία, το να φτιάχνεται πίνακας-ένωση σε κάθε render ήταν σκέτη σπατάλη.
interface DataBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function computeBounds(points: Array<{ lat: number; lng: number }>): DataBounds | null {
  if (points.length === 0) return null;
  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLng = points[0].lng, maxLng = points[0].lng;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function unionBounds(list: Array<DataBounds | null>): DataBounds | null {
  let out: DataBounds | null = null;
  for (const b of list) {
    if (!b) continue;
    out = out ? {
      minLat: Math.min(out.minLat, b.minLat),
      maxLat: Math.max(out.maxLat, b.maxLat),
      minLng: Math.min(out.minLng, b.minLng),
      maxLng: Math.max(out.maxLng, b.maxLng),
    } : b;
  }
  return out;
}

function MapBounds({ bounds }: { bounds: DataBounds | null }) {
  const map = useMap();

  const fitToBounds = useCallback(() => {
    if (!bounds) return;
    const { minLat, maxLat, minLng, maxLng } = bounds;
    if (minLat === maxLat && minLng === maxLng) {
      map.setView([minLat, minLng], 12);
    } else {
      // Μικρό padding: αρκετό να μην κόβονται οι κουκκίδες στην άκρη, χωρίς να
      // αφήνει τη διαδρομή μικρή στη μέση ενός στενού panel.
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [14, 14], maxZoom: 16 });
    }
  }, [bounds, map]);

  useEffect(() => {
    fitToBounds();
  }, [fitToBounds]);

  // The grid layout (1/2/3 χάρτες) resizes each map's container without Leaflet
  // knowing — it only recomputes pixel↔latlng mapping on init or on an explicit
  // invalidateSize(). Without this, the 1st map keeps the stale projection from
  // before the 2nd/3rd panel appeared and looks off-center. A ResizeObserver on
  // the container catches every such resize (panel add/remove, window resize,…)
  // and re-centers.
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      fitToBounds();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map, fitToBounds]);

  return null;
}

// ── 3-Operator Sync ───────────────────────────────────────────────────────────
// Token-based: split on _/-./ then match known abbreviations
const OPERATOR_GROUPS: Array<{ name: string; tokens: string[] }> = [
  { name: "Cosmote", tokens: ["cosmote"] },
  { name: "Vodafone", tokens: ["vodafone"] },
  { name: "Nova",     tokens: ["nova", "wind"] },
];

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[-_.\s]+/g, " ").split(" ").filter(Boolean);
}

function detectOperator(collection: string): string | null {
  const toks = tokenize(collection);
  for (const g of OPERATOR_GROUPS) {
    if (toks.some(t => g.tokens.includes(t))) return g.name;
  }
  return null;
}

function bestCollectionForOperator(
  ref: string,
  refOp: string,
  targetOp: string,
  candidates: string[],
): string | null {
  if (!candidates.length) return null;
  const refGroup   = OPERATOR_GROUPS.find(g => g.name === refOp);
  const targetGroup = OPERATOR_GROUPS.find(g => g.name === targetOp);
  const strip = (toks: string[], grp: typeof OPERATOR_GROUPS[0] | undefined) =>
    toks.filter(t => !grp?.tokens.includes(t));
  const refSet = new Set(strip(tokenize(ref), refGroup));
  let best = candidates[0], bestScore = -1;
  for (const c of candidates) {
    const score = strip(tokenize(c), targetGroup).filter(t => refSet.has(t)).length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// One entry per map layer — a panel syncs ALL of its layers to the other panels
interface LayerSync {
  tmplIdx: number;
  sql: string;
  mode: MapMode;
  valueCol: string;
  colorSchemeKey: string;
  labelCol: string;
  quantityCol: string;
}

interface SyncPayload {
  db: string;
  collection: string;
  location: string;
  layers: LayerSync[];
}

// Ανώτατο πλήθος σημείων που ζωγραφίζονται ταυτόχρονα ανά layer
const MAX_RENDER_POINTS = 20000;

// Δύο layers μπορεί κάλλιστα να δίνουν κουκκίδες στο ίδιο χρώμα (π.χ. και τα δύο
// πράσινο). Το χρώμα ανήκει στην ΤΙΜΗ, οπότε το layer το δηλώνει το ΣΧΗΜΑ και το
// μέγεθος. Τα παρακάτω είναι απλώς τα defaults ανά layer — σχήμα, μέγεθος και
// πάχος αλλάζουν δυναμικά από τις Ρυθμίσεις του κάθε layer, και το legend
// ακολουθεί πάντα ό,τι ζωγραφίζεται στον χάρτη.
type MarkerShape = "circle" | "triangle" | "square" | "diamond" | "cross" | "plus";

// Σχήματα που ζωγραφίζονται μόνο με γραμμές (χωρίς γέμισμα)
const STROKE_ONLY_SHAPES: MarkerShape[] = ["cross", "plus"];
const isStrokeOnly = (shape: MarkerShape) => STROKE_ONLY_SHAPES.includes(shape);

const SHAPE_OPTIONS: Array<{ value: MarkerShape; label: string }> = [
  { value: "circle",   label: "● κύκλος" },
  { value: "triangle", label: "▲ τρίγωνο" },
  { value: "square",   label: "■ τετράγωνο" },
  { value: "diamond",  label: "◆ ρόμβος" },
  { value: "cross",    label: "✕ Χ" },
  { value: "plus",     label: "✚ σταυρός" },
];

interface LayerMarkerStyle {
  shape: MarkerShape;
  radius: number;
  weight: number;
  opacity: number;
  outline: boolean;
}

const LAYER_MARKER_STYLES: LayerMarkerStyle[] = [
  // Το L1 είναι σχεδόν πάντα το πυκνό «χαλί»: ξεκινά ήδη στα 3px, όσο και το
  // preset του ρόλου, ώστε να μην «πηδάει» το μέγεθος μόλις έρθουν τα δεδομένα.
  { shape: "circle",   radius: 3, weight: 0.5, opacity: 0.85, outline: true },
  { shape: "diamond", radius: 7, weight: 2,   opacity: 0.9,  outline: false },
  { shape: "cross",    radius: 8, weight: 2.5, opacity: 1,    outline: false },
];

const markerStyleFor = (index: number) => LAYER_MARKER_STYLES[index] ?? LAYER_MARKER_STYLES[0];

// ── Ρόλος layer: «χαλί» vs «σημεία αναφοράς» ──────────────────────────────────
// Τα δύο στρώματα ενός χάρτη σχεδόν ποτέ δεν είναι ισοδύναμα: το ένα είναι
// 20.000 δείγματα διαδρομής (διαβάζεται σαν ροή/ίχνος, όχι σαν μεμονωμένα
// σημεία) και το άλλο 10–100 σημεία αναφοράς που πρέπει να «επιπλέουν» καθαρά
// από πάνω. Ο ρόλος προκύπτει από την πυκνότητα και οδηγεί ΜΕΓΕΘΟΣ, ΔΙΑΦΑΝΕΙΑ,
// ΠΕΡΙΓΡΑΜΜΑ και ΣΕΙΡΑ σχεδίασης — το ΣΧΗΜΑ μένει ανέγγιχτο, γιατί αυτό είναι
// το κανάλι που δηλώνει σε ποιο layer ανήκει μια κουκκίδα.
type LayerRole = "carpet" | "reference";

/** Κάτω από τόσα δείγματα, ένα layer είναι «σημεία αναφοράς» και όχι «χαλί». */
const REFERENCE_MAX_POINTS = 200;

const ROLE_PRESETS: Record<LayerRole, LayerMarkerStyle> = {
  // Μικροσκοπικές κουκκίδες με λεπτό περίγραμμα. Το πάχος μένει στο 0.5: σε
  // πυκνά δεδομένα τα χοντρά περιγράμματα αλληλοκαλύπτονται και βγάζουν
  // «μισοφέγγαρα» αντί για συνεχή γραμμή — στα 0.5px το φαινόμενο δεν φαίνεται.
  carpet:    { shape: "circle",  radius: 3, weight: 0.5, opacity: 0.85, outline: true },
  // Ρόμβοι με λευκό περίγραμμα: ξεχωρίζουν καθαρά πάνω από το χαλί.
  reference: { shape: "diamond", radius: 7, weight: 2.5, opacity: 1,    outline: true },
};

/** Ο ρόλος κρίνεται μόνο από το πλήθος: <100 δείγματα ⇒ ρόμβοι, αλλιώς κουκκίδες. */
function roleForCount(n: number): LayerRole | null {
  if (n <= 0) return null;
  return n < REFERENCE_MAX_POINTS ? "reference" : "carpet";
}

const OUTLINE_COLOR = "#ffffff";

// SVG path ενός σχήματος γύρω από το (x, y), σε pixel — κοινό για χάρτη & legend
function shapePathD(x: number, y: number, r: number, shape: MarkerShape): string {
  switch (shape) {
    case "cross":
      return `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`;
    case "plus":
      return `M${x},${y - r}L${x},${y + r}M${x - r},${y}L${x + r},${y}`;
    case "triangle": {
      const h = r * 1.15;
      return `M${x},${y - h}L${x + r},${y + h * 0.7}L${x - r},${y + h * 0.7}Z`;
    }
    case "square":
      return `M${x - r},${y - r}h${r * 2}v${r * 2}h${-r * 2}Z`;
    case "diamond": {
      const d = r * 1.2;
      return `M${x},${y - d}L${x + d},${y}L${x},${y + d}L${x - d},${y}Z`;
    }
    default:
      return `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
  }
}

// CircleMarker που ζωγραφίζει αυθαίρετο σχήμα: κρατά όλη τη συμπεριφορά του
// (σταθερό μέγεθος σε pixel σε κάθε zoom, ίδιο performance με χιλιάδες σημεία)
// και αλλάζει μόνο το path που δίνει στον SVG renderer του Leaflet.
// Το ίδιο σχήμα σε canvas context — ίδια γεωμετρία με το shapePathD
function traceShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: MarkerShape): void {
  switch (shape) {
    case "cross":
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      break;
    case "plus":
      ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
      break;
    case "triangle": {
      const h = r * 1.15;
      ctx.moveTo(x, y - h); ctx.lineTo(x + r, y + h * 0.7); ctx.lineTo(x - r, y + h * 0.7);
      ctx.closePath();
      break;
    }
    case "square":
      ctx.rect(x - r, y - r, r * 2, r * 2);
      break;
    case "diamond": {
      const d = r * 1.2;
      ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y);
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2, false);
  }
}

interface ShapeMarkerInternals {
  _radius: number;
  _point: { x: number; y: number };
  options: { shape: MarkerShape };
  _empty: () => boolean;
  _renderer: {
    _setPath?: (layer: unknown, d: string) => void;
    _drawing?: boolean;
    _ctx?: CanvasRenderingContext2D;
    _fillStroke?: (ctx: CanvasRenderingContext2D, layer: unknown) => void;
  };
}

const ShapeMarkerClass = LeafletCircleMarker.extend({
  options: { shape: "circle" as MarkerShape },
  _updatePath(this: ShapeMarkerInternals) {
    const renderer = this._renderer;
    const r = Math.max(Math.round(this._radius), 1);
    const shape = this.options.shape;
    // SVG renderer: δίνουμε path string, όπως κάνει ο ίδιος ο CircleMarker
    if (renderer._setPath) {
      renderer._setPath(this, this._empty() ? "M0 0" : shapePathD(this._point.x, this._point.y, r, shape));
      return;
    }
    // Canvas renderer: ζωγραφίζουμε στο ίδιο context που χρησιμοποιεί το
    // Leaflet για τους κύκλους — ένα canvas αντί για N κόμβους DOM.
    if (!renderer._drawing || !renderer._ctx || this._empty()) return;
    const ctx = renderer._ctx;
    ctx.beginPath();
    traceShape(ctx, this._point.x, this._point.y, r, shape);
    renderer._fillStroke?.(ctx, this);
  },
});

// `idx`: δείκτης του σημείου μέσα στο layer — τα κοινά event handlers τον
// διαβάζουν από τα options του marker, χωρίς closure ανά σημείο.
interface ShapeMarkerProps extends CircleMarkerProps { shape?: MarkerShape; idx?: number }

const ShapeMarker = createPathComponent<LeafletCircleMarkerType, ShapeMarkerProps>(
  function createShapeMarker({ center, children: _c, ...options }, ctx) {
    const marker = new (ShapeMarkerClass as unknown as new (
      c: typeof center, o: typeof options,
    ) => LeafletCircleMarkerType)(center, options);
    return createElementObject(marker, extendContext(ctx, { overlayContainer: marker }));
  },
  function updateShapeMarker(layer, props, prevProps) {
    updateCircle(layer, props, prevProps);
    // Το σχήμα ζει στα options του Leaflet layer: όταν τα layers μετατοπιστούν
    // (π.χ. αφαίρεση του L1) ο ίδιος marker αλλάζει slot — άρα και σχήμα.
    if (props.shape !== prevProps.shape) {
      (layer.options as { shape?: MarkerShape }).shape = props.shape;
      layer.redraw();
    }
  },
);

const lc = (s: string) => s.toLowerCase();

// ── SQL placeholders ─────────────────────────────────────────────────────────
const sqlEscape = (v: string) => v.replace(/'/g, "''");

// Με τιμή: απλή αντικατάσταση (split/join, ώστε ένα `$&` μέσα στην τιμή να μη
// διαβαστεί ως replacement pattern). Χωρίς τιμή: ουδετεροποιούμε τη ΣΥΓΚΡΙΣΗ
// (`x = '{location}'` → `1 = 1`) αντί να σβήσουμε ολόκληρη τη γραμμή — αν η
// γραμμή είχε και δεύτερη συνθήκη, το σβήσιμο την έχανε σιωπηλά. Ό,τι δεν έχει
// τη μορφή σύγκρισης πέφτει πίσω στην παλιά συμπεριφορά.
const PLACEHOLDER_COMPARISON = (placeholder: string) =>
  new RegExp(String.raw`[\w.\[\]]+\s*(?:=|LIKE)\s*'\{${placeholder}\}'`, "gi");

function applySqlFilter(sql: string, placeholder: string, value: string): string {
  const token = `{${placeholder}}`;
  if (!sql.includes(token)) return sql;
  if (value) return sql.split(token).join(sqlEscape(value));
  const neutralized = sql.replace(PLACEHOLDER_COMPARISON(placeholder), "1 = 1");
  if (!neutralized.includes(token)) return neutralized;
  return neutralized
    .split("\n")
    .filter((line) => !line.includes(token))
    .join("\n");
}

// ── Map layers ────────────────────────────────────────────────────────────────
// Ένα panel μπορεί να στοιβάξει πολλαπλά ανεξάρτητα queries στον ΙΔΙΟ χάρτη
// (π.χ. FREE RSRP «χαλί» από κάτω + call points από πάνω). Κάθε layer κρατά δικό
// του database / template / φίλτρα / αποτελέσματα. Το useQueryLayer καλείται
// σταθερό πλήθος φορές (rules of hooks) — τα layers πάνω από το layerCount
// μένουν ανενεργά με άδειο database.
const MAX_LAYERS = 3;
// ── Uniform split grid: same column count keeps every panel the same size ────
const MAX_PANELS = 4;
const LAYER_ACCENTS = ["#3b82f6", "#f59e0b", "#a855f7"];

// ── Shareable URL state ───────────────────────────────────────────────────────
// Ένα param (`?qmap=…`) περιγράφει panels → layers: database, template, φίλτρα
// και εμφάνιση, ώστε ένα link να ανοίγει ακριβώς τον χάρτη που βλέπεις. Τα πεδία
// είναι θεσιακά και URI-encoded, ώστε ονόματα με κενά ή διαχωριστικά να μη
// σπάνε το URL. Το custom SQL ΔΕΝ αποθηκεύεται (πολύ μεγάλο για URL) — ένα link
// επαναφέρει το template, όχι χειρόγραφες αλλαγές στο query. Τα αποτελέσματα
// δεν εκτελούνται αυτόματα: ο χρήστης πατάει Run όταν θέλει.
// Database / collection / ASideLocation ανήκουν στον ΧΑΡΤΗ, όχι στο layer: τα
// layers ενός panel συγκρίνουν πάντα διαφορετικά queries πάνω στα ΙΔΙΑ δεδομένα.
interface LayerScope {
  db: string;
  collection: string;
  location: string;
}

interface LayerInit {
  tmplIdx?: number;
  shape?: MarkerShape;
  radius?: number;
  weight?: number;
  mode?: MapMode;
  visible?: boolean;
  opacity?: number;
  outline?: boolean;
  /** true μόνο όταν ο χρήστης άλλαξε ο ίδιος το στυλ αυτού του layer. */
  styleTouched?: boolean;
}

const FIELD_SEP = "~";
const LAYER_SEP = ";";
const PANEL_SEP = "|";

// Το encodeURIComponent ΔΕΝ κάνει escape το `~` (unreserved), οπότε ένα όνομα
// collection/location με `~` θα έσπαγε το parsing των πεδίων — το κωδικοποιούμε
// ρητά. Τα `;` και `|` τα καλύπτει ήδη το encodeURIComponent.
const encField = (v: string) => encodeURIComponent(v).replace(/~/g, "%7E");

const safeDecode = (v: string) => {
  try { return decodeURIComponent(v); } catch { return ""; }
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Το κοινό scope του panel — πρώτο chunk της σειριοποίησης. */
function serializeScope(scope: LayerScope): string {
  return [encField(scope.db), encField(scope.collection), encField(scope.location)].join(FIELD_SEP);
}

function serializeLayerInit(l: Required<LayerInit>): string {
  return [
    String(l.tmplIdx),
    l.shape,
    String(l.radius),
    String(l.weight),
    l.mode === "bubble" ? "b" : "p",
    l.visible ? "1" : "0",
    l.opacity.toFixed(2),
    l.outline ? "1" : "0",
    l.styleTouched ? "1" : "0",
  ].join(FIELD_SEP);
}

function parseLayerInit(raw: string): LayerInit | null {
  const f = raw.split(FIELD_SEP);
  const tmplIdx = Number(f[0]);
  if (!Number.isInteger(tmplIdx)) return null;
  const shape = f[1] as MarkerShape;
  const radius = Number(f[2]);
  const weight = Number(f[3]);
  return {
    tmplIdx: tmplIdx >= 0 && tmplIdx < TEMPLATES.length ? tmplIdx : 0,
    shape: SHAPE_OPTIONS.some((o) => o.value === shape) ? shape : undefined,
    radius: Number.isFinite(radius) ? clamp(radius, 2, 14) : undefined,
    weight: Number.isFinite(weight) ? clamp(weight, 0, 6) : undefined,
    mode: f[4] === "b" ? "bubble" : f[4] === "p" ? "points" : undefined,
    visible: f[5] === undefined ? undefined : f[5] === "1",
    opacity: f[6] && Number.isFinite(Number(f[6])) ? clamp(Number(f[6]), 0.2, 1) : undefined,
    outline: f[7] === undefined ? undefined : f[7] === "1",
    styleTouched: f[8] === "1",
  };
}

interface PanelInit {
  scope: LayerScope;
  layers: LayerInit[];
}

/**
 * `?qmap=` → ένα PanelInit ανά panel. Μορφή:
 *   panel := db~collection~location ; layer ; layer …
 *   layer := tmplIdx~shape~radius~weight~mode~visible~opacity~outline
 * Άκυρα κομμάτια αγνοούνται — ένα χειρόγραφο URL δεν σπάει το UI.
 *
 * Συμβατότητα: στην πρώτη έκδοση το db/collection/location ζούσαν ΜΕΣΑ σε κάθε
 * layer (9+ πεδία ανά chunk). Τέτοια links/localStorage διαβάζονται ακόμη —
 * επαναφέρουν database, collection, location και template· το στυλ (σχήμα,
 * μέγεθος, διαφάνεια) πέφτει στα defaults, αφού τα πεδία δεν στοιχίζονται.
 */
function parseQueryMapUrlState(raw: string): PanelInit[] {
  if (!raw) return [];
  return raw
    .split(PANEL_SEP)
    .map((panel): PanelInit | null => {
      const chunks = panel.split(LAYER_SEP).filter(Boolean);
      if (chunks.length === 0) return null;
      const first = chunks[0].split(FIELD_SEP);
      const legacy = first.length >= 9;
      const scope: LayerScope = legacy
        ? { db: safeDecode(first[0]), collection: safeDecode(first[2]), location: safeDecode(first[3]) }
        : { db: safeDecode(first[0]), collection: safeDecode(first[1]), location: safeDecode(first[2]) };
      // Στο legacy σχήμα τα πεδία δεν στοιχίζονται με το σημερινό: κρατάμε μόνο
      // το template (αν διαβάζαμε θεσιακά, το "visible" θα έπεφτε πάνω σε άλλο
      // πεδίο και τα layers θα επανέρχονταν κρυμμένα).
      const layers = (legacy
        ? chunks.map((c) => {
            const tmplIdx = Number(c.split(FIELD_SEP)[1]);
            return Number.isInteger(tmplIdx) && tmplIdx >= 0 && tmplIdx < TEMPLATES.length
              ? { tmplIdx } as LayerInit
              : null;
          })
        : chunks.slice(1).map((c) => parseLayerInit(c))
      )
        .filter((l): l is LayerInit => l !== null)
        .slice(0, MAX_LAYERS);
      return layers.length > 0 ? { scope, layers } : null;
    })
    .filter((p): p is PanelInit => p !== null)
    .slice(0, MAX_PANELS);
}

interface LayerState {
  tmplIdx: number;
  sql: string;
  mode: MapMode;
  quantityCol: string;
  labelCol: string;
  latCol: string;
  lngCol: string;
  valueCol: string;
  colorSchemeKey: string;
  columns: string[];
  rows: Record<string, CellValue>[];
  executionTime: number | null;
  error: string | null;
  filterNRARFCN: string;
  filterLink: string;
  selectedGroup: string | null;
  selectedBuckets: Set<string>;
  visible: boolean;
  shape: MarkerShape;
  radius: number;
  weight: number;
  opacity: number;
  outline: boolean;
  styleTouched: boolean;
}

function useQueryLayer(init: LayerInit, index: number, scope: LayerScope) {
  // Αρχικές τιμές από το URL (ή defaults) — διαβάζονται μία φορά, στο mount
  const initTemplate = TEMPLATES[init.tmplIdx ?? 0] ?? TEMPLATES[0];
  const { db, collection: filterCollection, location: filterLocation } = scope;

  const [tmplIdx, setTmplIdx]               = useState(init.tmplIdx ?? 0);
  const [sql, setSql]                       = useState(initTemplate.sql);
  const [mode, setMode]                     = useState<MapMode>(init.mode ?? initTemplate.mode);
  const [quantityCol, setQuantityCol]       = useState(initTemplate.quantityCol ?? "");
  const [labelCol, setLabelCol]             = useState(initTemplate.labelCol);
  const [latCol, setLatCol]                 = useState("");
  const [lngCol, setLngCol]                 = useState("");
  const [valueCol, setValueCol]             = useState(initTemplate.valueCol ?? "");
  const [colorSchemeKey, setColorSchemeKey] = useState(initTemplate.colorScheme ?? "rsrp_data");
  const [isRunning, setIsRunning]           = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [columns, setColumns]               = useState<string[]>([]);
  const [rows, setRows]                     = useState<Record<string, CellValue>[]>([]);
  const [executionTime, setExecutionTime]   = useState<number | null>(null);
  const [filterNRARFCN, setFilterNRARFCN]       = useState("");
  const [filterLink, setFilterLink]             = useState("");
  const [selectedGroup, setSelectedGroup]       = useState<string | null>(null);
  // Multiple legend value-groups can be isolated at once (e.g. RSRP -75..-65 AND -85..-75)
  const [selectedBuckets, setSelectedBuckets]   = useState<Set<string>>(new Set());
  const [visible, setVisible]                   = useState(init.visible ?? true);
  // Στυλ κουκκίδας — ξεκινά από το URL ή από το default του layer, και αλλάζει δυναμικά
  const [shape, setShape]     = useState<MarkerShape>(init.shape ?? markerStyleFor(index).shape);
  const [radius, setRadius]   = useState<number>(init.radius ?? markerStyleFor(index).radius);
  const [weight, setWeight]   = useState<number>(init.weight ?? markerStyleFor(index).weight);
  const [opacity, setOpacity] = useState<number>(init.opacity ?? markerStyleFor(index).opacity);
  const [outline, setOutline] = useState<boolean>(init.outline ?? markerStyleFor(index).outline);
  // Μόλις ο χρήστης αγγίξει ο ΙΔΙΟΣ το στυλ, σταματάμε να το προσαρμόζουμε
  // αυτόματα. Το flag ταξιδεύει στο URL: αλλιώς, επειδή αποθηκεύουμε πάντα το
  // τρέχον στυλ, κάθε reload θα έμοιαζε με «χειροκίνητη» ρύθμιση και το auto
  // styling δεν θα ξανάπαιζε ποτέ στον πρώτο χάρτη (αυτόν που έχει seed).
  const [styleTouched, setStyleTouched] = useState(init.styleTouched ?? false);
  const markStyleTouched = useCallback(() => setStyleTouched(true), []);

  // Σταθερό callback: περνά σαν prop στο memoized LayerMarkers
  const toggleGroup = useCallback((label: string) => {
    setSelectedGroup((g) => (g === label ? null : label));
  }, []);

  const toggleBucket = useCallback((label: string) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }, []);

  const baseScheme = COLOR_SCHEMES[colorSchemeKey];

  const effLatCol   = latCol      || columns.find((c) => ["lat","latitude"].includes(lc(c)))                                          || "";
  const effLngCol   = lngCol      || columns.find((c) => ["lng","lon","longitude"].includes(lc(c)))                                   || "";
  const effQtyCol   = quantityCol || columns.find((c) => ["total_calls","count","total","calls","sessions","avg","value"].some(k => lc(c).includes(k))) || columns[1] || "";
  const effValCol   = valueCol    || columns.find((c) => lc(c) === lc(baseScheme.suggestCol))                                         || columns[2]  || "";
  const effLabelCol = labelCol    || columns.find((c) => ["location","asidelocation","name","label"].includes(lc(c)))                 || columns[0]  || "";

  const filteredRows = useMemo(() => {
    const nrCol = TEMPLATES[tmplIdx]?.nrarfcnCol;
    const linkCol = TEMPLATES[tmplIdx]?.linkCol;
    let out = rows;
    if (nrCol && filterNRARFCN) out = out.filter((r) => String(r[nrCol] ?? "") === filterNRARFCN);
    if (linkCol && filterLink) out = out.filter((r) => String(r[linkCol] ?? "") === filterLink);
    if (selectedGroup !== null && effLabelCol) out = out.filter((r) => String(r[effLabelCol] ?? "") === selectedGroup);
    return out;
  }, [rows, tmplIdx, filterNRARFCN, filterLink, selectedGroup, effLabelCol]);

  // PCI has no fixed value bands: color the top-sampled PCI values dynamically,
  // per the current result set, instead of static 1-99/100-199… ranges.
  const currentScheme = useMemo<ColorScheme>(() => {
    if (colorSchemeKey === "pci_lte") {
      return { ...baseScheme, type: "category", categories: buildDynamicPciCategories(filteredRows, effValCol) } as CategoryScheme;
    }
    return baseScheme;
  }, [colorSchemeKey, baseScheme, filteredRows, effValCol]);

  const availableNRARFCNs = useMemo(() => {
    const nrCol = TEMPLATES[tmplIdx]?.nrarfcnCol;
    if (!nrCol || rows.length === 0) return [];
    return [...new Set(rows.map((r) => String(r[nrCol] ?? "")).filter(Boolean))].sort(
      (a, b) => Number(a) - Number(b),
    );
  }, [rows, tmplIdx]);

  const availableLinks = useMemo(() => {
    const linkCol = TEMPLATES[tmplIdx]?.linkCol;
    if (!linkCol || rows.length === 0) return [];
    return [...new Set(rows.map((r) => String(r[linkCol] ?? "")).filter(Boolean))].sort();
  }, [rows, tmplIdx]);

  const template = TEMPLATES[tmplIdx];
  const needsFilters = template?.requiresFilters ?? false;
  const filtersReady = !needsFilters || (filterCollection !== "" && filterLocation !== "");

  // Αύξων αριθμός τρέχοντος run — φρουρός για out-of-order απαντήσεις
  const runIdRef = useRef(0);

  const clearResults = () => {
    // Αλλαγή template/db ακυρώνει ό,τι τρέχει: η απάντησή του δεν αφορά
    // πια αυτό που βλέπει ο χρήστης.
    runIdRef.current++;
    setIsRunning(false);
    setRows([]); setColumns([]); setError(null); setExecutionTime(null);
    setFilterNRARFCN(""); setFilterLink(""); setSelectedGroup(null); setSelectedBuckets(new Set());
  };

  const selectTemplate = (idx: number) => {
    const t = TEMPLATES[idx];
    setTmplIdx(idx); setSql(t.sql); setMode(t.mode);
    setQuantityCol(t.quantityCol ?? ""); setValueCol(t.valueCol ?? "");
    setLabelCol(t.labelCol); setLatCol(""); setLngCol("");
    if (t.colorScheme) setColorSchemeKey(t.colorScheme);
    clearResults();
  };

  // Apply an operator-sync payload coming from panel 1
  const applySync = (s: LayerSync) => {
    setTmplIdx(s.tmplIdx);
    setSql(s.sql);
    setMode(s.mode);
    setValueCol(s.valueCol);
    setColorSchemeKey(s.colorSchemeKey);
    setLabelCol(s.labelCol);
    setQuantityCol(s.quantityCol);
    setLatCol(""); setLngCol("");
    setVisible(true);
    clearResults();
  };

  const getState = (): LayerState => ({
    tmplIdx, sql, mode, quantityCol, labelCol, latCol, lngCol, valueCol,
    colorSchemeKey, columns, rows, executionTime, error,
    filterNRARFCN, filterLink,
    selectedGroup, selectedBuckets, visible, shape, radius, weight, opacity, outline, styleTouched,
  });

  const setState = (s: LayerState) => {
    setTmplIdx(s.tmplIdx); setSql(s.sql); setMode(s.mode);
    setQuantityCol(s.quantityCol); setLabelCol(s.labelCol);
    setLatCol(s.latCol); setLngCol(s.lngCol); setValueCol(s.valueCol);
    setColorSchemeKey(s.colorSchemeKey); setColumns(s.columns); setRows(s.rows);
    setExecutionTime(s.executionTime); setError(s.error);
    setFilterNRARFCN(s.filterNRARFCN); setFilterLink(s.filterLink);
    setSelectedGroup(s.selectedGroup); setSelectedBuckets(s.selectedBuckets);
    setVisible(s.visible);
    setShape(s.shape); setRadius(s.radius); setWeight(s.weight);
    setOpacity(s.opacity); setOutline(s.outline); setStyleTouched(s.styleTouched);
  };

  const runQuery = async () => {
    if (!db) { setError("Επιλέξτε database πρώτα."); return; }
    if (!filtersReady) { setError("Επιλέξτε Collection και ASideLocation πριν εκτελέσετε το query."); return; }
    // Κάθε run παίρνει αύξοντα αριθμό: μια αργή απάντηση που γυρίζει ΜΕΤΑ από
    // νεότερο run (ή μετά από αλλαγή template/db) αγνοείται, αντί να γράψει από πάνω.
    const runId = ++runIdRef.current;
    setIsRunning(true); setError(null); setSelectedGroup(null); setSelectedBuckets(new Set());
    const effectiveSql = applySqlFilter(
      applySqlFilter(sql, "collection", filterCollection),
      "location", filterLocation,
    );
    try {
      const result = await runBenchmarkApi(db, [effectiveSql]);
      if (runId !== runIdRef.current) return;
      const r = result.results[0];
      if (r) {
        setColumns(r.columns); setRows(r.data); setExecutionTime(r.executionTime);
        if (!template?.colorScheme) {
          const colsLower = r.columns.map((c) => c.toLowerCase());
          const match = Object.entries(COLOR_SCHEMES).find(([, sc]) => colsLower.includes(sc.suggestCol.toLowerCase()));
          if (match) setColorSchemeKey(match[0]);
        }
      }
    } catch (e) {
      if (runId !== runIdRef.current) return;
      setError(e instanceof Error ? e.message : "Σφάλμα εκτέλεσης query");
    } finally {
      if (runId === runIdRef.current) setIsRunning(false);
    }
  };

  // Keep ref pointing to latest runQuery so external triggers avoid stale closures
  const runRef = useRef<() => void>(() => {});
  runRef.current = runQuery;

  const bubblePoints = useMemo<BubblePointData[]>(() => {
    if (mode !== "bubble" || !effQtyCol || filteredRows.length === 0) return [];
    const vals = filteredRows.map((r) => Number(r[effQtyCol])).filter((v) => !isNaN(v));
    if (!vals.length) return [];
    let minV = vals[0], maxV = vals[0];
    for (let i = 1; i < vals.length; i++) { if (vals[i] < minV) minV = vals[i]; if (vals[i] > maxV) maxV = vals[i]; }
    const range = maxV - minV || 1;
    return filteredRows.flatMap((row) => {
      const qty = Number(row[effQtyCol]);
      if (isNaN(qty)) return [];
      let lat: number | null = null, lng: number | null = null;
      if (effLatCol && effLngCol) {
        const a = Number(row[effLatCol]), b = Number(row[effLngCol]);
        if (!isNaN(a) && !isNaN(b) && !(a === 0 && b === 0)) { lat = a; lng = b; }
      }
      if (lat === null && effLabelCol && row[effLabelCol] != null) {
        const c = resolveCity(String(row[effLabelCol]));
        if (c) { lat = c.lat; lng = c.lng; }
      }
      if (lat === null || lng === null) return [];
      const normalized = (qty - minV) / range;
      return [{ lat, lng, qty, normalized, radius: 8 + normalized * 36, row }];
    });
  }, [mode, filteredRows, effQtyCol, effLatCol, effLngCol, effLabelCol]);

  // Counts per bubble tier — computed on the full (unfiltered-by-tier) bubble set
  // so the legend always shows all tiers, even the one currently isolated.
  const bubbleTierCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of bubblePoints) {
      const t = bubbleTierLabel(p.normalized);
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [bubblePoints]);

  // Legend click-to-filter: isolate one or more rank tiers
  const visibleBubblePoints = useMemo(() => {
    if (selectedBuckets.size === 0) return bubblePoints;
    return bubblePoints.filter((p) => selectedBuckets.has(bubbleTierLabel(p.normalized)));
  }, [bubblePoints, selectedBuckets]);

  // Χωρίς το `row`: το tooltip των σημείων δείχνει μόνο label + τιμή, οπότε δεν
  // κρατάμε ολόκληρη τη γραμμή του DB ×20.000 markers ×layers ×panels.
  const pointMarkers = useMemo<PointMarkerData[]>(() => {
    if (mode !== "points" || !effValCol || !effLatCol || !effLngCol || filteredRows.length === 0) return [];
    const raw = filteredRows.flatMap((row) => {
      const lat = Number(row[effLatCol]), lng = Number(row[effLngCol]);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return [];
      const val = row[effValCol];
      if (val == null) return [];
      return [{
        lat, lng, val,
        color: colorForValue(currentScheme, val),
        bucketKey: bucketKeyForValue(currentScheme, val),
        label: effLabelCol ? String(row[effLabelCol] ?? "") : "",
      }];
    });
    // Χωρίς αραίωση εδώ: το αραίωμα γίνεται πλέον ανά viewport (decimateForView)
    return raw;
  }, [mode, filteredRows, effValCol, effLatCol, effLngCol, effLabelCol, currentScheme]);

  // Legend click-to-filter: isolate one or more value buckets/categories
  const visiblePointMarkers = useMemo(() => {
    if (selectedBuckets.size === 0) return pointMarkers;
    return pointMarkers.filter((p) => selectedBuckets.has(p.bucketKey));
  }, [pointMarkers, selectedBuckets]);

  // Ό,τι δείχνει ο χάρτης αυτή τη στιγμή (πριν το per-viewport αραίωμα)
  const shownPoints = mode === "bubble" ? visibleBubblePoints : visiblePointMarkers;
  const pointCount = shownPoints.length;
  // Bounds αντί για πίνακα σημείων: το MapBounds θέλει μόνο το πλαίσιο, και έτσι
  // δεν φτιάχνεται πίνακας 20.000 αντικειμένων σε κάθε render.
  const dataBounds = useMemo(() => computeBounds(shownPoints), [shownPoints]);

  // Πυκνό χαλί ή αραιά σημεία αναφοράς; Ο ρόλος βγαίνει από το ΣΥΝΟΛΟ των
  // σημείων του query — όχι από το πλήθος που έμεινε μετά από φίλτρο legend,
  // αλλιώς η απομόνωση ενός bucket θα άλλαζε ξαφνικά όλο το στυλ του layer.
  const dataPointCount = mode === "bubble" ? bubblePoints.length : pointMarkers.length;
  const role = roleForCount(dataPointCount);
  const appliedRole = useRef<LayerRole | null>(null);
  useEffect(() => {
    if (styleTouched || !role || role === appliedRole.current) return;
    appliedRole.current = role;
    const preset = ROLE_PRESETS[role];
    setShape(preset.shape);
    setRadius(preset.radius);
    setWeight(preset.weight);
    setOpacity(preset.opacity);
    setOutline(preset.outline);
  }, [role, styleTouched]);

  const bucketCounters = useMemo(() => {
    if (mode !== "points" || !effValCol || filteredRows.length === 0) return new Map<string, number>();
    return computeBucketCounters(filteredRows, effValCol, currentScheme);
  }, [mode, filteredRows, effValCol, currentScheme]);

  const pointsTotal = [...bucketCounters.values()].reduce((a, b) => a + b, 0);

  return {
    tmplIdx, setTmplIdx, sql, setSql, mode, setMode, template,
    quantityCol, labelCol, valueCol, colorSchemeKey,
    isRunning, error, setError, columns, rows, executionTime,
    filterNRARFCN, setFilterNRARFCN, filterLink, setFilterLink,
    selectedGroup, setSelectedGroup, toggleGroup, selectedBuckets, setSelectedBuckets, toggleBucket,
    visible, setVisible,
    shape, setShape, radius, setRadius, weight, setWeight,
    opacity, setOpacity, outline, setOutline, markStyleTouched, styleTouched, role, dataPointCount,
    effLatCol, effLngCol, effQtyCol, effValCol, effLabelCol,
    filteredRows, currentScheme, availableNRARFCNs, availableLinks,
    filtersReady, selectTemplate, applySync, getState, setState, clearResults,
    runQuery, runRef,
    visibleBubblePoints, bubbleTierCounts, visiblePointMarkers, pointCount, dataBounds,
    bucketCounters, pointsTotal,
  };
}

type QueryLayer = ReturnType<typeof useQueryLayer>;

// Short name of a layer, shown in tabs / tooltips / legend headers
function layerName(L: QueryLayer, index: number): string {
  return `L${index + 1} · ${L.template?.label ?? "—"}`;
}

// ── Σχήμα κουκκίδας ενός layer, για legend / tabs / status row ───────────────
// Δείχνει πάντα το ΤΡΕΧΟΝ σχήμα του layer, στο χρώμα που του δίνεις (accent του
// layer στα headers, χρώμα της τιμής στις γραμμές του legend).
const LayerShapeSwatch = ({ shape, color, size = 11 }: {
  shape: MarkerShape; color: string; size?: number;
}) => {
  const mid = size / 2;
  const r = mid - (shape === "circle" ? 1.4 : 1.8);
  const strokeOnly = isStrokeOnly(shape);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <path d={shapePathD(mid, mid, r, shape)}
        fill={strokeOnly ? "none" : color} fillOpacity={0.9}
        stroke={color} strokeWidth={strokeOnly ? 2 : 1}
        strokeLinecap="round" />
    </svg>
  );
};

// ── Σειρά σχεδίασης των layers ────────────────────────────────────────────────
// Κάθε layer ζωγραφίζεται σε δικό του Leaflet pane, οπότε η σειρά «ποιο πάει
// πάνω» είναι ένα z-index στο pane — αλλάζει ακαριαία, ακόμη και με δεκάδες
// χιλιάδες σημεία (καμία μετακίνηση DOM κόμβων).
const layerPaneName = (index: number) => `qm-layer-${index}`;
const LAYER_PANE_Z = 401;

const PaneStack = ({ order }: { order: number[] }) => {
  const map = useMap();
  useEffect(() => {
    order.forEach((layerIdx, pos) => {
      const pane = map.getPane(layerPaneName(layerIdx));
      if (pane) pane.style.zIndex = String(LAYER_PANE_Z + pos);
    });
  }, [map, order]);
  return null;
};

// ── Markers of one layer, drawn inside the shared <MapContainer> ──────────────
interface PointMarkerData {
  lat: number;
  lng: number;
  val: CellValue;
  color: string;
  bucketKey: string | null;
  label: string;
}

interface BubblePointData {
  lat: number;
  lng: number;
  qty: number;
  normalized: number;
  radius: number;
  row: Record<string, CellValue>;
}

interface LayerMarkersProps {
  visible: boolean;
  mode: MapMode;
  bubblePoints: BubblePointData[];
  pointMarkers: PointMarkerData[];
  shape: MarkerShape;
  radius: number;
  weight: number;
  opacity: number;
  outline: boolean;
  dimmed: boolean;
  accent: string;
  isBase: boolean;
  name: string;
  showName: boolean;
  valueCol: string;
  qtyCol: string;
  labelCol: string;
  latCol: string;
  lngCol: string;
  selectedGroup: string | null;
  onToggleGroup: (label: string) => void;
}

// ── Zoom-aware decimation ─────────────────────────────────────────────────────
// Κρατάμε μόνο ό,τι πέφτει στο τρέχον viewport και ένα σημείο ανά κελί οθόνης.
// Πριν, το αραίωμα γινόταν μία φορά για όλο το dataset: σε zoom-in έχανες
// δείγματα που χωρούσαν άνετα. Επιστρέφει δείκτες, ώστε να μην αντιγράφονται
// αντικείμενα σε κάθε μετακίνηση του χάρτη.
function decimateForView(
  pts: Array<{ lat: number; lng: number }>,
  map: LeafletMap,
  spacingPx: number,
  max = MAX_RENDER_POINTS,
): number[] {
  const b = map.getBounds().pad(0.25);
  const south = b.getSouth(), north = b.getNorth(), west = b.getWest(), east = b.getEast();
  // Μοίρες ανά pixel στο τρέχον zoom (Web Mercator, 256px tiles)
  const degPerPx = 360 / (256 * Math.pow(2, map.getZoom()));
  const cellLng = Math.max(spacingPx, 1) * degPerPx;
  // Στον Mercator τα pixels/μοίρα στο lat είναι 1/cos(φ) των lng — το κελί
  // διορθώνεται ώστε η αραίωση να είναι ισότροπη στην οθόνη.
  const cellLat = cellLng * Math.cos((map.getCenter().lat * Math.PI) / 180) || cellLng;
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.lat < south || p.lat > north || p.lng < west || p.lng > east) continue;
    const key = `${Math.floor(p.lat / cellLat)},${Math.floor(p.lng / cellLng)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
    if (out.length >= max) break;
  }
  return out;
}

// ── Tooltip σημείου ως HTML ───────────────────────────────────────────────────
// Ένα tooltip ανά layer (όχι ανά σημείο) σημαίνει ότι το περιεχόμενο φτιάχνεται
// εκτός React — άρα με ρητό escaping των τιμών που έρχονται από τη βάση.
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

interface HoverContext {
  points: PointMarkerData[];
  valueCol: string;
  name: string;
  showName: boolean;
  accent: string;
  selectedGroup: string | null;
  onToggleGroup: (label: string) => void;
}

function pointTooltipHtml(pt: PointMarkerData, ctx: HoverContext): string {
  const display = typeof pt.val === "number"
    ? (pt.val % 1 === 0 ? pt.val.toLocaleString() : pt.val.toFixed(2))
    : String(pt.val);
  const head = ctx.showName
    ? `<div class="text-[9px] font-semibold uppercase tracking-wide" style="color:${escapeHtml(ctx.accent)}">${escapeHtml(ctx.name)}</div>`
    : "";
  const label = pt.label
    ? `<div class="font-bold text-xs border-b border-gray-200 pb-0.5 mb-0.5">${escapeHtml(pt.label)}</div>`
    : "";
  const hint = pt.label
    ? `<div class="text-[9px] text-gray-400 italic">${ctx.selectedGroup === pt.label ? "κλικ για επαναφορά όλων" : "κλικ για προβολή μόνο αυτής"}</div>`
    : "";
  return `<div class="font-sans text-center space-y-0.5">${head}${label}`
    + `<div class="text-xs"><span class="text-gray-500">${escapeHtml(ctx.valueCol)}:</span> `
    + `<span class="font-mono font-bold" style="color:${escapeHtml(pt.color)}">${escapeHtml(display)}</span></div>`
    + `${hint}</div>`;
}

// Memo: ο γονιός ξαναγίνεται render σε κάθε πληκτρολόγηση στο SQL, σε κάθε hover
// στο legend κ.λπ. Με primitive props + memoized πίνακες σημείων, οι δεκάδες
// χιλιάδες markers δεν ξαναπερνούν καθόλου όταν δεν άλλαξαν τα δεδομένα τους.
const LayerMarkers = memo(function LayerMarkers({
  visible, mode, bubblePoints, pointMarkers,
  shape, radius, weight, opacity, outline, dimmed, accent, isBase,
  name, showName, valueCol, qtyCol, labelCol, latCol, lngCol,
  selectedGroup, onToggleGroup,
}: LayerMarkersProps) {
  const map = useMap();
  // Focus σε άλλο layer: αυτό πέφτει κατά 60% (μένει στο 40%)
  const dim = dimmed ? 0.4 : 1;
  const strokeOnly = isStrokeOnly(shape);

  // Ό,τι διαβάζουν τα κοινά handlers ζει σε ref, ώστε τα handlers να μένουν
  // σταθερά — αλλιώς 20.000 markers θα ξανα-δένονταν σε κάθε αλλαγή state.
  const hoverRef = useRef<HoverContext>({ points: pointMarkers, valueCol, name, showName, accent, selectedGroup, onToggleGroup });
  hoverRef.current = { points: pointMarkers, valueCol, name, showName, accent, selectedGroup, onToggleGroup };

  const tooltip = useMemo(() => new LeafletTooltipClass({ direction: "top", offset: [0, -6], opacity: 0.95 }), []);
  useEffect(() => () => { map.closeTooltip(tooltip); }, [map, tooltip]);

  // ΕΝΑ tooltip + ΕΝΑ σετ handlers για όλο το layer, αντί για ένα <Tooltip>
  // React component και ξεχωριστό closure σε κάθε σημείο.
  const handlers = useMemo<LeafletEventHandlerFnMap>(() => {
    const pointOf = (e: LeafletLeafletEvent) => {
      const idx = (e.target as { options?: { idx?: number } })?.options?.idx;
      return idx === undefined ? null : hoverRef.current.points[idx] ?? null;
    };
    return {
      mouseover(e) {
        const pt = pointOf(e);
        if (!pt) return;
        tooltip.setLatLng([pt.lat, pt.lng]).setContent(pointTooltipHtml(pt, hoverRef.current));
        map.openTooltip(tooltip);
      },
      mouseout() {
        map.closeTooltip(tooltip);
      },
      click(e) {
        const pt = pointOf(e);
        if (pt?.label) hoverRef.current.onToggleGroup(pt.label);
      },
    };
  }, [map, tooltip]);

  // Ένα pathOptions ΑΝΑ ΧΡΩΜΑ (όχι ανά σημείο): σταθερό reference ⇒ η
  // react-leaflet δεν ξανακαλεί setStyle() σε κάθε marker σε κάθε render.
  const styleByColor = useMemo(() => {
    // Το περίγραμμα ισχύει μόνο σε γεμάτα σχήματα: στο Χ/σταυρό η γραμμή ΕΙΝΑΙ
    // το σύμβολο, οπότε λευκό stroke θα έσβηνε το χρώμα της τιμής.
    const halo = outline && !strokeOnly;
    const m = new Map<string, PathOptions>();
    for (const pt of pointMarkers) {
      if (m.has(pt.color)) continue;
      m.set(pt.color, {
        fillColor: pt.color,
        fill: !strokeOnly,
        fillOpacity: strokeOnly ? 0 : opacity * dim,
        color: halo ? OUTLINE_COLOR : pt.color,
        opacity: (halo ? 1 : opacity) * dim,
        stroke: weight > 0,
        weight,
        lineCap: "round",
      });
    }
    return m;
  }, [pointMarkers, strokeOnly, dim, weight, opacity, outline]);

  // Ξανα-επιλογή σημείων όποτε αλλάζει το viewport
  const [viewTick, setViewTick] = useState(0);
  useEffect(() => {
    const onMove = () => setViewTick((t) => t + 1);
    map.on("moveend", onMove);
    return () => { map.off("moveend", onMove); };
  }, [map]);

  const rendered = useMemo(
    () => decimateForView(pointMarkers, map, Math.max(radius * 1.4, 3)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointMarkers, map, radius, viewTick],
  );

  if (!visible) return null;

  if (mode === "bubble") {
    return (
      <>
        {bubblePoints.map((pt, i) => {
          const { fill, stroke } = bubbleColor(pt.normalized);
          const label = labelCol ? String(pt.row[labelCol] ?? `#${i}`) : `#${i}`;
          const extra = Object.entries(pt.row).filter(([k]) => k !== labelCol && k !== latCol && k !== lngCol && k !== qtyCol);
          return (
            <CircleMarker key={i} center={[pt.lat, pt.lng]} radius={pt.radius}
              pathOptions={{ fillColor: fill, fillOpacity: 0.78 * dim, opacity: dim, color: isBase ? stroke : accent, weight: isBase ? 2 : 3 }}
              eventHandlers={{ click: () => labelCol && onToggleGroup(label) }}>
              <Tooltip direction="top" offset={[0, -pt.radius]} opacity={0.97}>
                <div className="font-sans text-center space-y-0.5 min-w-[120px]">
                  {showName && (
                    <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: accent }}>{name}</div>
                  )}
                  <div className="font-bold text-xs border-b border-gray-200 pb-1 mb-1">{label}</div>
                  {labelCol && (
                    <div className="text-[9px] text-gray-400 italic">
                      {selectedGroup === label ? "κλικ για επαναφορά όλων" : "κλικ για προβολή μόνο αυτής"}
                    </div>
                  )}
                  <div className="text-xs">
                    <span className="text-gray-500">{qtyCol}:</span>{" "}
                    <span className="font-mono font-bold" style={{ color: stroke }}>
                      {pt.qty % 1 === 0 ? pt.qty.toLocaleString() : pt.qty.toFixed(2)}
                    </span>
                  </div>
                  {extra.map(([k, v]) => (
                    <div key={k} className="text-[10px] text-gray-500">
                      {k}: <span className="text-gray-700 font-mono">{v != null ? String(v) : "—"}</span>
                    </div>
                  ))}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </>
    );
  }

  // Σχήμα / μέγεθος / πάχος: δυναμικά ανά layer (όχι λευκό περίγραμμα — σε πυκνά
  // δεδομένα τα περιγράμματα αλληλοκαλύπτονταν και έβγαζαν «μισοφέγγαρα»).
  // Το `idx` ταυτοποιεί το σημείο στα κοινά handlers, χωρίς per-marker closure.
  return (
    <>
      {rendered.map((idx) => {
        const pt = pointMarkers[idx];
        return (
          <ShapeMarker key={idx} center={[pt.lat, pt.lng]} radius={radius} shape={shape}
            idx={idx} pathOptions={styleByColor.get(pt.color)} eventHandlers={handlers} />
        );
      })}
    </>
  );
});

// ── Legend of one layer — stacked, one block per visible layer ────────────────
const LayerLegend = ({ L, index, name, showName, focused, dimmed, onToggleFocus }: {
  L: QueryLayer; index: number; name: string; showName: boolean;
  focused?: boolean; dimmed?: boolean; onToggleFocus?: () => void;
}) => {
  const rowCls = (cnt: number, active: boolean) =>
    `w-full flex items-center gap-1 rounded px-0.5 text-left transition-colors ${cnt === 0 ? "opacity-25 cursor-default" : "cursor-pointer hover:bg-primary/10"} ${active ? "bg-primary/15 ring-1 ring-inset ring-primary/40" : ""}`;

  return (
    <div className={`${showName ? "pt-1 mt-1 border-t border-border/60 first:pt-0 first:mt-0 first:border-t-0" : ""} ${dimmed ? "opacity-40" : ""} transition-opacity`}>
      {showName && (
        <button
          type="button"
          onClick={onToggleFocus}
          title={focused
            ? "Κλικ για επαναφορά — όλα τα layers κανονικά"
            : "Κλικ για focus σε αυτό το layer — τα υπόλοιπα ξεθωριάζουν"}
          className={`w-full flex items-center gap-1 mb-0.5 rounded px-0.5 text-left transition-colors hover:bg-primary/10 ${focused ? "bg-primary/15 ring-1 ring-inset ring-primary/40" : ""}`}
        >
          <LayerShapeSwatch shape={L.shape} color={LAYER_ACCENTS[index]} />
          <span className="text-[9px] font-bold uppercase tracking-wide text-foreground truncate flex-1">{name}</span>
          <span className="text-[9px] font-mono text-foreground/75 shrink-0">{L.pointCount.toLocaleString()}</span>
        </button>
      )}
      {L.mode === "bubble" ? (
        <>
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/90">Κλίμακα</p>
            {L.selectedBuckets.size > 0 && (
              <button type="button" onClick={() => L.setSelectedBuckets(new Set())}
                title="Εμφάνιση όλων" className="text-primary/70 hover:text-primary">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {BUBBLE_TIERS.map(({ label, fill }) => {
            const cnt = L.bubbleTierCounts.get(label) ?? 0;
            const active = L.selectedBuckets.has(label);
            return (
              <button type="button" key={label} disabled={cnt === 0}
                title={cnt > 0 ? "Κλικ για προσθήκη/αφαίρεση από την επιλογή (πολλαπλή επιλογή)" : undefined}
                onClick={() => L.toggleBucket(label)}
                className={rowCls(cnt, active)}>
                <LayerShapeSwatch shape={L.mode === "bubble" ? "circle" : L.shape} color={fill} size={10} />
                <span className="text-[10px] text-foreground flex-1 leading-none">{label}</span>
                {cnt > 0 && (
                  <span className="text-[9px] font-mono text-foreground/75 whitespace-nowrap">{cnt.toLocaleString()}</span>
                )}
              </button>
            );
          })}
          <p className="text-[9px] text-foreground/80 border-t border-border/50 pt-0.5 mt-0.5">∝ {L.effQtyCol || "qty"}</p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/90 truncate">{L.currentScheme.label}</p>
            {L.selectedBuckets.size > 0 && (
              <button type="button" onClick={() => L.setSelectedBuckets(new Set())}
                title="Εμφάνιση όλων" className="text-primary/70 hover:text-primary shrink-0">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {L.currentScheme.type === "range"
            ? L.currentScheme.buckets.map((b) => {
                const cnt = L.bucketCounters.get(b.label) ?? 0;
                const active = L.selectedBuckets.has(b.label);
                return (
                  <button type="button" key={b.label} disabled={cnt === 0}
                    title={cnt > 0 ? "Κλικ για προσθήκη/αφαίρεση από την επιλογή (πολλαπλή επιλογή)" : undefined}
                    onClick={() => L.toggleBucket(b.label)}
                    className={rowCls(cnt, active)}>
                    <LayerShapeSwatch shape={L.mode === "bubble" ? "circle" : L.shape} color={b.color} size={10} />
                    <span className="text-[10px] text-foreground flex-1 leading-none">{b.label}</span>
                    {cnt > 0 && (
                      <span className="text-[9px] font-mono text-foreground/75 whitespace-nowrap">
                        {cnt.toLocaleString()} <span className="text-primary">{(cnt / L.pointsTotal * 100).toFixed(1)}%</span>
                      </span>
                    )}
                  </button>
                );
              })
            : L.currentScheme.categories.map((c) => {
                const cnt = L.bucketCounters.get(c.value) ?? 0;
                const active = L.selectedBuckets.has(c.value);
                return (
                  <button type="button" key={c.value} disabled={cnt === 0}
                    title={cnt > 0 ? "Κλικ για προσθήκη/αφαίρεση από την επιλογή (πολλαπλή επιλογή)" : undefined}
                    onClick={() => L.toggleBucket(c.value)}
                    className={rowCls(cnt, active)}>
                    <LayerShapeSwatch shape={L.mode === "bubble" ? "circle" : L.shape} color={c.color} size={10} />
                    <span className="text-[10px] text-foreground flex-1 leading-none">{c.value}</span>
                    {cnt > 0 && (
                      <span className="text-[9px] font-mono text-foreground/75 whitespace-nowrap">
                        {cnt.toLocaleString()} <span className="text-primary">{(cnt / L.pointsTotal * 100).toFixed(1)}%</span>
                      </span>
                    )}
                  </button>
                );
              })}
          <p className="text-[9px] text-foreground/70 border-t border-border/50 pt-0.5 mt-0.5 font-mono truncate">
            {L.effValCol || "—"} · {L.pointsTotal.toLocaleString()} pts
          </p>
        </>
      )}
    </div>
  );
};

// ── Scope του χάρτη: collection + ASideLocation, κοινά σε όλα τα layers ──────
const ScopeFilters = ({ collection, location, collections, locations, onCollection, onLocation }: {
  collection: string;
  location: string;
  collections: string[];
  locations: string[];
  onCollection: (v: string) => void;
  onLocation: (v: string) => void;
}) => (
  <div className="grid grid-cols-2 gap-1.5">
    <div>
      <label className="text-[10px] text-muted-foreground block mb-0.5">Collection</label>
      <select
        value={collection}
        onChange={(e) => onCollection(e.target.value)}
        className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
      >
        <option value="">— Όλα —</option>
        {(collection && !collections.includes(collection) ? [collection, ...collections] : collections)
          .map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
    <div>
      <label className="text-[10px] text-muted-foreground block mb-0.5">ASideLocation</label>
      <select
        value={location}
        onChange={(e) => onLocation(e.target.value)}
        className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
      >
        <option value="">— Όλες —</option>
        {(location && !locations.includes(location) ? [location, ...locations] : locations)
          .map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  </div>
);

// ── Φίλτρα που εξαρτώνται από το template του ενεργού layer ──────────────────
const LayerFilters = ({ L }: { L: QueryLayer }) => (
  <>
    {/* NRARFCN filter — εμφανίζεται μόνο για 5G templates */}
    {L.template?.nrarfcnCol && (
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">
          NRARFCN
          {L.availableNRARFCNs.length > 0 && (
            <span className="ml-1 text-primary/70">({L.availableNRARFCNs.length} διαθέσιμα)</span>
          )}
        </label>
        <select
          value={L.filterNRARFCN}
          onChange={(e) => L.setFilterNRARFCN(e.target.value)}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">— Όλα τα NRARFCN —</option>
          {L.availableNRARFCNs.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    )}

    {/* Link filter — εμφανίζεται μόνο όταν το template έχει στήλη [link] */}
    {L.template?.linkCol && (
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">
          Link
          {L.availableLinks.length > 0 && (
            <span className="ml-1 text-primary/70">({L.availableLinks.length} διαθέσιμα)</span>
          )}
        </label>
        <select
          value={L.filterLink}
          onChange={(e) => L.setFilterLink(e.target.value)}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">— Όλα τα links —</option>
          {L.availableLinks.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    )}
  </>
);

// ── Single self-contained map panel (1 χάρτης, 1–3 layers) ───────────────────
interface SingleMapPanelProps {
  databases: string[];
  defaultDatabase?: string;
  panelIndex?: number;
  label?: string;
  onRemove?: () => void;
  syncTarget?: SyncPayload | null;
  onSyncRequest?: (payload: SyncPayload, collections: string[], locations: string[]) => void;
  runTrigger?: number;
  /** Αρχική κατάσταση (scope + layers) από το URL — διαβάζεται μόνο στο mount. */
  initialPanel?: PanelInit;
  /** Αναφέρει τη serialized κατάσταση του panel στο URL state του γονιού. */
  onPersist?: (serialized: string) => void;
}

const SingleMapPanel = ({ databases, defaultDatabase = "", panelIndex = 0, label, onRemove, syncTarget, onSyncRequest, runTrigger, initialPanel, onPersist }: SingleMapPanelProps) => {
  // Το URL state διαβάζεται ΜΟΝΟ στο mount: μετά κερδίζει ό,τι κάνει ο χρήστης
  const seed = useRef(initialPanel?.layers ?? []).current;
  const seedScope = useRef(initialPanel?.scope).current;

  // ── Scope του χάρτη: κοινό σε ΟΛΑ τα layers ────────────────────────────────
  // Τα layers ενός panel συγκρίνουν διαφορετικά queries πάνω στα ίδια δεδομένα,
  // οπότε database / collection / ASideLocation ζουν εδώ και όχι στο layer.
  const [db, setDb]                 = useState(seedScope?.db || defaultDatabase);
  const [collection, setCollection] = useState(seedScope?.collection ?? "");
  const [location, setLocation]     = useState(seedScope?.location ?? "");
  const [collections, setCollections] = useState<string[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [locations, setLocations]   = useState<string[]>([]);

  useEffect(() => {
    if (!db) { setCollections([]); setLocations([]); return; }
    setCollectionsLoading(true);
    fetchCollectionNames(db)
      .then(setCollections)
      .catch(() => setCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, [db]);

  useEffect(() => {
    if (!db) { setLocations([]); return; }
    fetchLocations(db, collection ? [collection] : [])
      .then(setLocations)
      .catch(() => setLocations([]));
  }, [db, collection]);

  const scope = useMemo<LayerScope>(() => ({ db, collection, location }), [db, collection, location]);

  // Fixed number of hook calls; only the first `layerCount` are active
  const layer0 = useQueryLayer(seed[0] ?? {}, 0, scope);
  const layer1 = useQueryLayer(seed[1] ?? {}, 1, scope);
  const layer2 = useQueryLayer(seed[2] ?? {}, 2, scope);
  const allLayers = [layer0, layer1, layer2];

  // Αλλαγή scope ⇒ τα αποτελέσματα όλων των layers αφορούν άλλα δεδομένα
  const changeDb = (value: string) => {
    setDb(value); setCollection(""); setLocation("");
    allLayers.forEach((l) => l.clearResults());
  };
  const changeCollection = (value: string) => {
    setCollection(value);
    allLayers.forEach((l) => l.setSelectedGroup(null));
  };
  const changeLocation = (value: string) => {
    setLocation(value);
    allLayers.forEach((l) => l.setSelectedGroup(null));
  };

  const [layerCount, setLayerCount] = useState(Math.max(1, Math.min(seed.length, MAX_LAYERS)));
  const [activeLayer, setActiveLayer] = useState(0);
  const [showExpanded, setShowExpanded] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  // Σειρά σχεδίασης, από κάτω προς τα πάνω: ΠΑΝΤΑ κατά πυκνότητα. Το πυκνό χαλί
  // πέφτει από κάτω και τα λίγα σημεία επιπλέουν, ανεξάρτητα από το slot τους —
  // χωρίς χειροκίνητη παράκαμψη, αλλιώς 30 σημεία θάβονται κάτω από 30.000.
  // (stable sort ⇒ με ίσα πλήθη κρατιέται η σειρά L1 → L2 → L3.)
  const stackOrder = useMemo(
    () => allLayers.map((l, i) => ({ i, n: l.dataPointCount })).sort((a, b) => b.n - a.n).map((c) => c.i),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layer0.dataPointCount, layer1.dataPointCount, layer2.dataPointCount],
  );

  // Κλικ στον τίτλο ενός legend: focus σε αυτό το layer — τα υπόλοιπα στο 70%
  const [focusedLayer, setFocusedLayer] = useState<number | null>(null);
  const toggleFocus = (i: number) => setFocusedLayer((f) => (f === i ? null : i));

  const setLayerVisible = (i: number, on: boolean) => allLayers[i].setVisible(on);

  const layers = allLayers.slice(0, layerCount);
  const activeIdx = Math.min(activeLayer, layerCount - 1);
  const L = allLayers[activeIdx];
  const multiLayer = layerCount > 1;

  const addLayer = () => {
    if (layerCount >= MAX_LAYERS) return;
    const next = allLayers[layerCount];
    // The slot may still hold the results of a layer that was removed earlier —
    // clear them so no ghost markers come back with the new layer.
    next.clearResults();
    // Το database / collection / location είναι ήδη κοινά σε όλο το panel
    next.setVisible(true);
    setActiveLayer(layerCount);
    setLayerCount(layerCount + 1);
  };

  // Layers are positional (fixed hook slots), so removing one shifts every
  // following layer's whole state down by a slot.
  const removeLayer = (idx: number) => {
    if (layerCount <= 1) return;
    for (let i = idx; i < layerCount - 1; i++) allLayers[i].setState(allLayers[i + 1].getState());
    setLayerCount(layerCount - 1);
    setFocusedLayer(null);
    setActiveLayer((a) => Math.max(0, Math.min(a, layerCount - 2)));
  };

  // Apply sync from panel 1 (operator sync) — every layer of the source panel
  useEffect(() => {
    if (!syncTarget) return;
    const incoming = syncTarget.layers.slice(0, MAX_LAYERS);
    if (syncTarget.db) setDb(syncTarget.db);
    setCollection(syncTarget.collection);
    setLocation(syncTarget.location);
    incoming.forEach((s, i) => allLayers[i].applySync(s));
    setLayerCount(Math.max(1, incoming.length));
    setActiveLayer(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncTarget]);

  const runAll = () => {
    // Το database είναι κοινό: ή τρέχουν όλα τα layers, ή κανένα (το πρώτο
    // layer αναλαμβάνει να δείξει το μήνυμα λάθους).
    if (!db) { layer0.runRef.current(); return; }
    layers.forEach((l) => l.runRef.current());
  };
  const latestRunAll = useRef<() => void>(() => {});
  latestRunAll.current = runAll;

  useEffect(() => {
    if (!runTrigger) return;
    latestRunAll.current();
  }, [runTrigger]);

  // Keep the map overlay up a beat after the last query so markers are painted
  const anyRunning = layers.some((l) => l.isRunning);
  useEffect(() => {
    if (anyRunning) { setMapLoading(true); return; }
    const t = setTimeout(() => setMapLoading(false), 600);
    return () => clearTimeout(t);
  }, [anyRunning]);

  // Union of every visible layer's points — MapBounds fits the map to all of them
  const fitBounds = useMemo(
    () => unionBounds(allLayers.slice(0, layerCount).filter((l) => l.visible).map((l) => l.dataBounds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerCount, layer0.visible, layer1.visible, layer2.visible,
     layer0.dataBounds, layer1.dataBounds, layer2.dataBounds],
  );
  const shownPoints = layers.reduce((n, l) => n + (l.visible ? l.pointCount : 0), 0);

  // Ό,τι αξίζει να ζει σε ένα shareable link. Είναι string, οπότε το effect
  // τρέχει μόνο όταν αλλάζει πραγματικά κάτι από αυτά.
  const persisted = [
    serializeScope(scope),
    ...layers.map((l) => serializeLayerInit({
      tmplIdx: l.tmplIdx, shape: l.shape, radius: l.radius, weight: l.weight,
      mode: l.mode, visible: l.visible, opacity: l.opacity, outline: l.outline,
      styleTouched: l.styleTouched,
    })),
  ].join(LAYER_SEP);

  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  useEffect(() => { persistRef.current?.(persisted); }, [persisted]);
  const anyRows = layers.some((l) => l.rows.length > 0);

  // Τα ενεργά φίλτρα παρουσιάζονται και καθαρίζονται για όλα τα layers μαζί
  const selectionCount = layers.reduce(
    (n, l) => n + l.selectedBuckets.size + (l.selectedGroup !== null ? 1 : 0), 0);

  const clearAllSelections = () => layers.forEach((l) => {
    l.setSelectedBuckets(new Set()); l.setSelectedGroup(null);
  });

  const resetAllFilters = () => {
    setCollection(""); setLocation("");
    layers.forEach((l) => {
      l.setFilterNRARFCN(""); l.setFilterLink("");
      l.setSelectedGroup(null); l.setSelectedBuckets(new Set());
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">

      {/* ── Controls ── */}
      <div className="p-2 space-y-1.5 border-b border-border bg-muted/20">

        {/* Row -1: Panel label + remove (only when part of a multi-map split) */}
        {(label || onRemove) && (
          <div className="flex items-center justify-between -mt-0.5 -mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wide">
              {label}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                title="Αφαίρεση χάρτη"
                className="p-1 -mr-1 -mt-1 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Row -0.5: Layer strip — πολλαπλά queries πάνω στον ίδιο χάρτη */}
        <div className="flex items-center gap-1 flex-wrap">
          {layers.map((lyr, i) => {
            const active = i === activeIdx;
            return (
              <div
                key={i}
                className={`flex items-center gap-1 rounded border pl-1 pr-0.5 py-0.5 transition-all ${active ? "border-primary/60 bg-primary/10" : "border-border bg-background hover:border-primary/30"}`}
              >
                <input
                  type="checkbox"
                  checked={lyr.visible}
                  onChange={(e) => setLayerVisible(i, e.target.checked)}
                  title={lyr.visible ? "Απόκρυψη layer από τον χάρτη" : "Εμφάνιση layer στον χάρτη"}
                  className="h-3 w-3 accent-primary cursor-pointer shrink-0"
                />
                <button
                  type="button"
                  onClick={() => setActiveLayer(i)}
                  title={`${layerName(lyr, i)} — κλικ για επεξεργασία αυτού του layer`}
                  className="flex items-center gap-1 max-w-[150px]"
                >
                  <LayerShapeSwatch shape={lyr.shape} color={LAYER_ACCENTS[i]} size={10} />
                  <span className={`text-[10px] truncate ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    L{i + 1}{lyr.effValCol ? ` · ${lyr.effValCol}` : ""}
                  </span>
                </button>
                {multiLayer && (
                  <button
                    type="button"
                    onClick={() => removeLayer(i)}
                    title="Αφαίρεση layer"
                    className="p-0.5 rounded text-muted-foreground/60 hover:text-destructive"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
          {layerCount < MAX_LAYERS && (
            <button
              type="button"
              onClick={addLayer}
              title="Προσθήκη layer στον ίδιο χάρτη (π.χ. calls πάνω από free RSRP)"
              className="flex items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-all"
            >
              <Plus className="h-3 w-3" /> Layer
            </button>
          )}
        </div>

        {/* Row 0: Database selector (του ενεργού layer) */}
        <select
          value={db}
          onChange={(e) => changeDb(e.target.value)}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">— Επιλέξτε Database —</option>
          {databases.map((db) => <option key={db} value={db}>{db}</option>)}
        </select>
        {collectionsLoading && (
          <p className="text-[10px] text-muted-foreground">Φόρτωση collections…</p>
        )}

        {/* Row 0b: Scope του χάρτη — κοινό collection / location για όλα τα layers */}
        <ScopeFilters
          collection={collection} location={location}
          collections={collections} locations={locations}
          onCollection={changeCollection} onLocation={changeLocation}
        />

        {/* Row 1: Template + mode + run */}
        <div className="flex items-center gap-1.5">
          <select
            value={L.tmplIdx}
            onChange={(e) => L.selectTemplate(Number(e.target.value))}
            className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs truncate"
          >
            {TEMPLATES.map((t, i) => (
              <option key={i} value={i}>[{t.category}] {t.label}</option>
            ))}
          </select>

          {/* mode pills */}
          <button type="button" onClick={() => { L.setMode("bubble"); L.setSelectedBuckets(new Set()); }}
            title="Bubble mode"
            className={`p-1.5 rounded border text-xs transition-all ${L.mode === "bubble" ? "bg-background border-border text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => { L.setMode("points"); L.setSelectedBuckets(new Set()); }}
            title="GPS Points mode"
            className={`p-1.5 rounded border text-xs transition-all ${L.mode === "points" ? "bg-background border-border text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <MapPin className="h-3.5 w-3.5" />
          </button>

          <Button onClick={runAll} disabled={anyRunning || !db} size="sm" className="h-7 px-2.5 gap-1 shrink-0"
            title={multiLayer ? `Εκτέλεση και των ${layerCount} layers` : "Εκτέλεση query"}>
            {anyRunning
              ? <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <Play className="h-3 w-3" />}
          </Button>

          {panelIndex === 0 && onSyncRequest && (location || collection) && (
            <button
              type="button"
              title={`Sync template & operator → υπόλοιπα panels\n${location ? `Location: ${location}` : `Collection: ${collection}`}`}
              onClick={() => onSyncRequest(
                {
                  db, collection, location,
                  layers: layers.map((lyr) => ({
                    tmplIdx: lyr.tmplIdx, sql: lyr.sql, mode: lyr.mode, valueCol: lyr.valueCol,
                    colorSchemeKey: lyr.colorSchemeKey, labelCol: lyr.labelCol, quantityCol: lyr.quantityCol,
                  })),
                },
                collections,
                locations,
              )}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary text-xs transition-all shrink-0"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Row 2: Φίλτρα που εξαρτώνται από το template του ενεργού layer */}
        <LayerFilters L={L} />

        {/* Row 3: Expand toggle */}
        <button
          type="button"
          onClick={() => setShowExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings2 className="h-3 w-3" />
          SQL / Ρυθμίσεις{multiLayer ? ` — L${activeIdx + 1}` : ""}
          <ChevronDown className={`h-3 w-3 ml-0.5 transition-transform ${showExpanded ? "rotate-180" : ""}`} />
        </button>

        {showExpanded && (
          <div className="space-y-2 pt-2 border-t border-border">
            {/* Στυλ κουκκίδας του ενεργού layer — σχήμα / μέγεθος / πάχος / διαφάνεια */}
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <label className="text-[10px] text-muted-foreground">
                  Κουκκίδα{multiLayer ? ` — L${activeIdx + 1}` : ""}
                </label>
                {L.role && (
                  <span className="text-[9px] px-1 rounded bg-primary/10 text-primary/80"
                    title={L.role === "carpet"
                      ? `Πυκνό στρώμα (${L.dataPointCount.toLocaleString()} σημεία ≥ ${REFERENCE_MAX_POINTS}): κουκκίδες 3px`
                      : `Αραιό στρώμα αναφοράς (${L.dataPointCount.toLocaleString()} σημεία < ${REFERENCE_MAX_POINTS}): ρόμβοι 7px με λευκό περίγραμμα`}>
                    {L.role === "carpet" ? "χαλί" : "σημεία αναφοράς"}
                  </span>
                )}
                <label className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none"
                  title="Λευκό περίγραμμα ώστε τα σύμβολα να ξεχωρίζουν πάνω από το πυκνό στρώμα">
                  <input type="checkbox" checked={L.outline}
                    onChange={(e) => { L.markStyleTouched(); L.setOutline(e.target.checked); }}
                    disabled={isStrokeOnly(L.shape)}
                    className="h-3 w-3 accent-primary cursor-pointer disabled:cursor-not-allowed" />
                  περίγραμμα
                </label>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-1.5 shrink-0">
                  <LayerShapeSwatch shape={L.shape} color={LAYER_ACCENTS[activeIdx]} size={14} />
                  <select
                    value={L.shape}
                    onChange={(e) => { L.markStyleTouched(); L.setShape(e.target.value as MarkerShape); }}
                    className="bg-background border border-border rounded px-1.5 py-1 text-xs"
                  >
                    {SHAPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <label className="flex-1 min-w-0">
                  <span className="text-[10px] text-muted-foreground block">
                    Μέγεθος <span className="font-mono text-primary/70">{L.radius}</span>
                  </span>
                  <input type="range" min={2} max={14} step={1} value={L.radius}
                    onChange={(e) => { L.markStyleTouched(); L.setRadius(Number(e.target.value)); }}
                    className="w-full h-4 accent-primary cursor-pointer" />
                </label>
                <label className="flex-1 min-w-0">
                  <span className="text-[10px] text-muted-foreground block">
                    Πάχος <span className="font-mono text-primary/70">{L.weight}</span>
                  </span>
                  <input type="range" min={0} max={6} step={0.5} value={L.weight}
                    onChange={(e) => { L.markStyleTouched(); L.setWeight(Number(e.target.value)); }}
                    className="w-full h-4 accent-primary cursor-pointer" />
                </label>
                <label className="flex-1 min-w-0">
                  <span className="text-[10px] text-muted-foreground block">
                    Διαφάνεια <span className="font-mono text-primary/70">{L.opacity.toFixed(2)}</span>
                  </span>
                  <input type="range" min={0.2} max={1} step={0.05} value={L.opacity}
                    onChange={(e) => { L.markStyleTouched(); L.setOpacity(Number(e.target.value)); }}
                    className="w-full h-4 accent-primary cursor-pointer" />
                </label>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">SQL Query</label>
              <textarea
                value={L.sql}
                onChange={(e) => { L.setSql(e.target.value); L.setTmplIdx(TEMPLATES.length - 1); }}
                className="w-full h-32 font-mono text-[11px] bg-background border border-border rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* Status row — stats του ενεργού layer, ενεργά φίλτρα ΟΛΩΝ των layers μαζί */}
        {anyRows && !anyRunning && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono flex-wrap">
            {/* Ένα checkbox ανά layer: κρύβει ΜΟΝΟ τα δείγματα & το legend του */}
            {layers.map((lyr, i) => (
              <label key={i} className="flex items-center gap-1 cursor-pointer select-none shrink-0"
                title={`${lyr.visible ? "Απόκρυψη" : "Εμφάνιση"} δειγμάτων & legend — ${layerName(lyr, i)}`}>
                <input type="checkbox" checked={lyr.visible}
                  onChange={(e) => setLayerVisible(i, e.target.checked)}
                  className="h-3 w-3 accent-primary cursor-pointer" />
                <LayerShapeSwatch shape={lyr.shape} color={LAYER_ACCENTS[i]} size={9} />
                <span className={lyr.visible ? "text-foreground/70" : "opacity-50 line-through"}>
                  L{i + 1}{lyr.effValCol ? ` · ${lyr.effValCol}` : ""}
                </span>
              </label>
            ))}
            <span className={L.pointCount === 0 ? "text-destructive" : "text-primary"}>
              {L.pointCount} pts
            </span>
            <span>/ {L.filteredRows.length !== L.rows.length ? `${L.filteredRows.length} filtered /` : ""} {L.rows.length} rows</span>
            {L.executionTime != null && <span className="ml-auto">{L.executionTime.toFixed(0)} ms</span>}

            {/* Κάθε ενεργό value-filter κάθε layer — με χρωματική κουκκίδα του layer */}
            {layers.flatMap((lyr, i) => {
              const dot = multiLayer
                ? <LayerShapeSwatch shape={lyr.shape} color={LAYER_ACCENTS[i]} size={9} />
                : null;
              const chip = (key: string, text: string, title: string, onClick: () => void) => (
                <button type="button" key={key} onClick={onClick} title={title}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 truncate max-w-[160px]">
                  <X className="h-2.5 w-2.5 shrink-0" />{dot}<span className="truncate">{text}</span>
                </button>
              );
              const chips = [];
              if (lyr.selectedGroup !== null) {
                chips.push(chip(`g${i}`, lyr.selectedGroup, "Καθαρισμός επιλογής ομάδας — εμφάνιση όλων", () => lyr.setSelectedGroup(null)));
              }
              for (const b of lyr.selectedBuckets) {
                chips.push(chip(`b${i}-${b}`, b, "Αφαίρεση αυτής της τιμής από την επιλογή", () => lyr.toggleBucket(b)));
              }
              return chips;
            })}

            {selectionCount > 1 && (
              <button type="button" onClick={clearAllSelections}
                title="Καθαρισμός επιλογών legend σε όλα τα layers"
                className="text-[9px] text-muted-foreground hover:text-primary underline underline-offset-2">
                καθαρισμός όλων
              </button>
            )}
            {(collection || location) && (
              <button type="button" onClick={resetAllFilters}
                title={multiLayer ? "Καθαρισμός φίλτρων σε όλα τα layers" : "Καθαρισμός φίλτρων"}
                className="text-primary/70 hover:text-primary flex items-center gap-0.5">
                <X className="h-2.5 w-2.5" /> reset
              </button>
            )}
          </div>
        )}

        {/* Errors (όλων των layers) */}
        {layers.map((lyr, i) => lyr.error && (
          <div key={i} className="flex items-start gap-1.5 p-2 rounded bg-destructive/10 border border-destructive/30 text-[11px] text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="break-all">{multiLayer ? `L${i + 1}: ` : ""}{lyr.error}</span>
          </div>
        ))}
      </div>

      {/* ── Map ── */}
      <div className="relative" style={{ height: 560 }}>
        {mapLoading && (
          <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="h-9 w-9 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <MapContainer
          center={[39.07, 23.73]}
          zoom={6}
          scrollWheelZoom
          // Canvas αντί για SVG: δεκάδες χιλιάδες σημεία ζωγραφίζονται σε ένα
          // canvas ανά pane, αντί για έναν κόμβο DOM ανά σημείο.
          preferCanvas
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapBounds bounds={fitBounds} />

          {/* Ένα pane ανά layer: default L1 κάτω → L3 πάνω, και ό,τι ξανα-επιλεγεί
              ανεβαίνει πρώτο (βλ. PaneStack / setLayerVisible) */}
          {layers.map((lyr, i) => (
            <Pane key={i} name={layerPaneName(i)} style={{ zIndex: LAYER_PANE_Z + stackOrder.indexOf(i) }}>
              <LayerMarkers
                visible={lyr.visible}
                mode={lyr.mode}
                bubblePoints={lyr.visibleBubblePoints}
                pointMarkers={lyr.visiblePointMarkers}
                shape={lyr.shape} radius={lyr.radius} weight={lyr.weight}
                opacity={lyr.opacity} outline={lyr.outline}
                dimmed={focusedLayer !== null && focusedLayer !== i}
                accent={LAYER_ACCENTS[i]} isBase={i === 0}
                name={layerName(lyr, i)} showName={multiLayer}
                valueCol={lyr.effValCol} qtyCol={lyr.effQtyCol} labelCol={lyr.effLabelCol}
                latCol={lyr.effLatCol} lngCol={lyr.effLngCol}
                selectedGroup={lyr.selectedGroup} onToggleGroup={lyr.toggleGroup} />
            </Pane>
          ))}
          <PaneStack order={stackOrder} />
        </MapContainer>

        {/* Legend overlay — ένα block ανά ορατό layer (on/off ανά layer, status row) */}
        {shownPoints > 0 && (
          <div className="absolute bottom-2 right-2 bg-muted/70 backdrop-blur-sm border border-border/50 rounded-md p-2 space-y-0.5 z-[1000] shadow-md max-h-[368px] overflow-y-auto min-w-[161px]">
            {layers.map((lyr, i) => (lyr.visible && lyr.pointCount > 0) && (
              <LayerLegend key={i} L={lyr} index={i} name={layerName(lyr, i)} showName={multiLayer}
                focused={focusedLayer === i}
                dimmed={focusedLayer !== null && focusedLayer !== i}
                onToggleFocus={() => toggleFocus(i)} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {shownPoints === 0 && !anyRunning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-2">
              <MapPin className="h-10 w-10 text-muted-foreground/20 mx-auto" />
              <p className="text-xs text-muted-foreground/60">
                {!anyRows
                  ? "Εκτελέστε query"
                  : layers.every((l) => !l.visible)
                    ? "Όλα τα layers είναι κρυμμένα"
                    : "Δεν βρέθηκαν συντεταγμένες"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface QueryMapProps {
  databases: string[];
  defaultDatabase?: string;
}


function gridColsClass(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n === 3) return "grid-cols-3";
  return "grid-cols-2"; // 4 panels → uniform 2×2
}

// ── Main component — starts as 1 map, freely split into up to MAX_PANELS ────
const QueryMap = ({ databases, defaultDatabase = "" }: QueryMapProps) => {
  // Shareable link (με localStorage fallback): panels → layers, χωρίς το SQL
  const [urlState, setUrlState] = useUrlStringState<string>("qmap", "", { storageKey: "queryMap.panels" });
  const seedPanels = useRef(parseQueryMapUrlState(urlState)).current;

  const [panels, setPanels] = useState<number[]>(() =>
    seedPanels.length > 0 ? seedPanels.map((_, i) => i) : [0]);
  const nextPanelId = useRef(Math.max(1, seedPanels.length));
  const [syncTargets, setSyncTargets] = useState<Record<number, SyncPayload | null>>({});
  const [runAllTrigger, setRunAllTrigger] = useState(0);

  // Κάθε panel αναφέρει το serialized state του· γράφουμε στο URL με μικρή
  // καθυστέρηση, ώστε ένα σύρσιμο slider να μη γράφει σε κάθε pixel.
  const snapshots = useRef(new Map<number, string>());
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const writeTimer = useRef<number | undefined>(undefined);

  const persistPanels = useCallback(() => {
    window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      setUrlState(panelsRef.current
        .map((id) => snapshots.current.get(id) ?? "")
        .filter(Boolean)
        .join(PANEL_SEP));
    }, 400);
  }, [setUrlState]);

  useEffect(() => () => window.clearTimeout(writeTimer.current), []);

  const addPanel = () => {
    setPanels((prev) => (prev.length >= MAX_PANELS ? prev : [...prev, nextPanelId.current++]));
  };

  const removePanel = (id: number) => {
    setPanels((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p !== id)));
    snapshots.current.delete(id);
    persistPanels();
    setSyncTargets((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSyncRequest = (payload: SyncPayload, collections: string[], locations: string[]) => {
    // Ο operator ανιχνεύεται από το location (π.χ. "Cosmote Free A"), αλλιώς
    // από το collection. Το scope είναι ένα ανά panel, οπότε γίνεται μία
    // αντιστοίχιση — τα layers κουβαλούν μόνο τα queries τους.
    const refOp = detectOperator(payload.location) || detectOperator(payload.collection);
    const others = OPERATOR_GROUPS.filter((g) => g.name !== refOp);
    const targetIds = panels.slice(1);
    const updates: Record<number, SyncPayload | null> = {};
    targetIds.forEach((id, i) => {
      const targetOp = others[i];
      // Πάνω από 3 panels δεν υπάρχει άλλος operator: ίδιο query, ίδιο scope
      if (!targetOp) { updates[id] = payload; return; }
      // Location του αντίστοιχου operator (π.χ. "Vodafone Free A")
      const locCandidates = locations.filter((l) => detectOperator(l) === targetOp.name);
      const bestLoc = bestCollectionForOperator(payload.location, refOp ?? "", targetOp.name, locCandidates) ?? "";
      // Το collection αλλάζει μόνο αν περιέχει κι αυτό όνομα operator
      const collRefOp = detectOperator(payload.collection);
      const collCandidates = collRefOp ? collections.filter((c) => detectOperator(c) === targetOp.name) : [];
      const bestColl = collRefOp && collCandidates.length > 0
        ? bestCollectionForOperator(payload.collection, collRefOp, targetOp.name, collCandidates) ?? payload.collection
        : payload.collection;
      updates[id] = { ...payload, collection: bestColl, location: bestLoc };
    });
    setSyncTargets((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold">
          Query Map{panels.length > 1 ? ` — ${panels.length} Χάρτες` : ""}
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {panels.length > 1
            ? "Κάθε χάρτης έχει ανεξάρτητο query· «+ Layer» για πολλαπλά queries στον ίδιο χάρτη"
            : "Ανεξάρτητο query, φίλτρα και χρωματική κλίμακα · «+ Layer» για overlay (π.χ. calls πάνω σε free RSRP)"}
        </span>

        <button
          type="button"
          onClick={addPanel}
          disabled={panels.length >= MAX_PANELS}
          title={panels.length >= MAX_PANELS ? `Μέγιστο ${MAX_PANELS} χάρτες` : "Προσθήκη χάρτη"}
          className="ml-auto h-7 px-2.5 gap-1.5 flex items-center rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border"
        >
          <Plus className="h-3.5 w-3.5" />
          Χάρτης
        </button>

        <Button
          size="sm"
          className="h-7 px-3 gap-1.5"
          onClick={() => setRunAllTrigger(v => v + 1)}
        >
          <Play className="h-3 w-3" />
          Run All
        </Button>
      </div>
      <div className={`grid gap-2 ${gridColsClass(panels.length)}`}>
        {panels.map((id, idx) => (
          <SingleMapPanel
            key={id}
            databases={databases} defaultDatabase={defaultDatabase}
            panelIndex={idx}
            label={panels.length > 1 ? `Χάρτης ${idx + 1}` : undefined}
            onRemove={panels.length > 1 ? () => removePanel(id) : undefined}
            onSyncRequest={idx === 0 ? handleSyncRequest : undefined}
            syncTarget={idx > 0 ? syncTargets[id] ?? null : undefined}
            runTrigger={runAllTrigger}
            initialPanel={seedPanels[id]}
            onPersist={(serialized) => { snapshots.current.set(id, serialized); persistPanels(); }}
          />
        ))}
      </div>
    </div>
  );
};

export default QueryMap;
