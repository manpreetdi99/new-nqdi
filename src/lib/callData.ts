/**
 * Το CallEvent ορίζει τη δομή για κάθε γεγονός (γεγονός κατά τη διάρκεια μιας κλήσης).
 * Χρησιμοποιούνται αυστηροί τύποι (π.χ. status: "success" | "warning" | "error")
 * αντί για απλό string, ώστε η TypeScript να "χτυπήσει" αν βάλουμε λάθος τιμή.
 */
export interface CallEvent {
  timestamp: string; // ISO string ημερομηνίας/ώρας
  event: string;
  duration_ms: number;
  status: "success" | "warning" | "error"; // Union Type: Μόνο αυτές οι 3 επιλογές επιτρέπονται
  details: string;
}

/**
 * Το CallRecord αντιπροσωπεύει μια ολόκληρη κλήση (ή data session) 
 * και θα χρησιμοποιηθεί σε όλο το application σου.
 */
export interface CallRecord {
  id: string;
  callId: string;
  startTime: string;
  endTime: string;
  duration_s: number;
  operator: string;
  region: string;
  technology: string;
  callMode?: string | null;
  callType: string;
  status: "completed" | "dropped" | "failed" | "system release"; // Ενεργοποιούμε το auto-complete του IDE
  setupTime_ms: number;
  avgMos: number;
  downloadSpeed: number;
  uploadSpeed: number;
  latency: number;
  jitter: number;
  packetLoss: number;
  latitude?: number | null;
  longitude?: number | null;
  comment?: string | null; // Optional comment field
  asideFileName?: string | null; // Device / file name
  events: CallEvent[]; // Ένας πίνακας που περιέχει αντικείμενα τύπου CallEvent
}

const OPERATORS = ["Cosmote", "Vodafone", "Wind", "Nova"];
const REGIONS = ["Athens", "Thessaloniki", "Patras", "Heraklion", "Larissa", "Volos", "Ioannina", "Kavala"];
const TECHNOLOGIES = ["5G SA", "5G NSA", "4G LTE", "4G+", "3G"];
const CALL_TYPES = ["Voice Call", "Video Call", "Data Session", "VoLTE", "VoNR"];
const STATUSES: CallRecord["status"][] = ["completed", "completed", "completed", "dropped", "failed"];

function rand(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateEvents(callType: string, duration_s: number, status: CallRecord["status"]): CallEvent[] {
  const events: CallEvent[] = [];
  const baseTime = new Date(2026, 2, 25, Math.floor(rand(6, 22)), Math.floor(rand(0, 59)));

  events.push({
    timestamp: baseTime.toISOString(),
    event: "Call Initiated",
    duration_ms: 0,
    status: "success",
    details: `${callType} request sent to network`,
  });

  const setupMs = rand(50, 800);
  events.push({
    timestamp: new Date(baseTime.getTime() + setupMs).toISOString(),
    event: "RRC Connection Setup",
    duration_ms: Math.round(setupMs),
    status: setupMs > 500 ? "warning" : "success",
    details: `Radio Resource Control connection established in ${Math.round(setupMs)}ms`,
  });

  events.push({
    timestamp: new Date(baseTime.getTime() + setupMs + rand(20, 100)).toISOString(),
    event: "Authentication",
    duration_ms: Math.round(rand(15, 80)),
    status: "success",
    details: "UE authenticated with network",
  });

  events.push({
    timestamp: new Date(baseTime.getTime() + setupMs + rand(100, 300)).toISOString(),
    event: "Bearer Setup",
    duration_ms: Math.round(rand(30, 200)),
    status: "success",
    details: `Dedicated bearer established for ${callType}`,
  });

  if (callType === "Voice Call" || callType === "VoLTE" || callType === "VoNR") {
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(500, 1500)).toISOString(),
      event: "Codec Negotiation",
      duration_ms: Math.round(rand(10, 60)),
      status: "success",
      details: "AMR-WB codec selected, 23.85 kbps",
    });
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(1500, 3000)).toISOString(),
      event: "RTP Stream Active",
      duration_ms: Math.round(duration_s * 1000),
      status: "success",
      details: `Voice stream active for ${duration_s}s, MOS: ${rand(3.0, 4.5).toFixed(1)}`,
    });
  }

  if (callType === "Data Session") {
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(400, 800)).toISOString(),
      event: "TCP Handshake",
      duration_ms: Math.round(rand(10, 50)),
      status: "success",
      details: "3-way handshake completed",
    });
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(800, 1500)).toISOString(),
      event: "Data Transfer",
      duration_ms: Math.round(duration_s * 1000),
      status: "success",
      details: `Transferred ${rand(5, 500).toFixed(0)} MB at ${rand(10, 200).toFixed(1)} Mbps`,
    });
  }

  if (status === "dropped") {
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(5000, duration_s * 900)).toISOString(),
      event: "Handover Attempt",
      duration_ms: Math.round(rand(100, 2000)),
      status: "warning",
      details: "Inter-frequency handover triggered",
    });
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(duration_s * 500, duration_s * 950)).toISOString(),
      event: "Call Dropped",
      duration_ms: 0,
      status: "error",
      details: "RLF (Radio Link Failure) detected, call terminated",
    });
  } else if (status === "failed") {
    events.push({
      timestamp: new Date(baseTime.getTime() + rand(300, 1000)).toISOString(),
      event: "Setup Failure",
      duration_ms: 0,
      status: "error",
      details: "Network rejected call setup - congestion",
    });
  } else {
    events.push({
      timestamp: new Date(baseTime.getTime() + duration_s * 1000).toISOString(),
      event: "Call Terminated",
      duration_ms: 0,
      status: "success",
      details: "Normal call clearing, resources released",
    });
  }

  return events;
}

export function generateCallRecords(count: number = 30): CallRecord[] {
  const records: CallRecord[] = [];

  for (let i = 0; i < count; i++) {
    const status = pick(STATUSES);
    const callType = pick(CALL_TYPES);
    const duration_s = status === "failed" ? rand(0, 2) : rand(10, 600);
    const startDate = new Date(2026, 2, 25 - Math.floor(rand(0, 3)), Math.floor(rand(6, 22)), Math.floor(rand(0, 59)), Math.floor(rand(0, 59)));
    const endDate = new Date(startDate.getTime() + duration_s * 1000);

    records.push({
      id: `call-${i + 1}`,
      callId: `CID-${String(1000 + i).padStart(6, "0")}`,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      duration_s: Math.round(duration_s),
      operator: pick(OPERATORS),
      region: pick(REGIONS),
      technology: pick(TECHNOLOGIES),
      callType,
      status,
      setupTime_ms: Math.round(rand(80, 1200)),
      avgMos: rand(2.5, 4.5),
      downloadSpeed: rand(5, 250),
      uploadSpeed: rand(1, 60),
      latency: rand(8, 120),
      
      jitter: rand(1, 30),
      packetLoss: rand(0, 5),
      events: generateEvents(callType, duration_s, status),
    });
  }

  return records.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}
