import React from 'react';
import { createRoot } from 'react-dom/client';
import { CallSignalChart } from '../src/components/CallSignalChart';
import type { SignalSample } from '../src/lib/signalSeries';
import '../src/index.css';

const T0 = Date.parse('2026-09-10T12:00:00.000Z');
const at = (s: number) => T0 + s * 1000;
const SPAN = 180;

// LTE όλη την ώρα, GSM σκέλος μετά το SRVCC στο +120s, scanner overlay.
const samples: SignalSample[] = Array.from({ length: SPAN }, (_, i) => ({
  t: at(i),
  RSRP: i < 125 ? -95 - 25 * Math.abs(Math.sin(i / 18)) : undefined,
  RSRQ: i < 125 ? -11 - 8 * Math.abs(Math.sin(i / 11)) : undefined,
  RxLev: i >= 120 ? -75 - 20 * Math.abs(Math.sin(i / 14)) : undefined,
  ScannerStrength: i < 125 ? -93 - 25 * Math.abs(Math.sin(i / 18)) : undefined,
}));

const events = [
  { seconds: 12, label: 'SIP INVITE', color: '#a855f7' },
  { seconds: 14, label: 'SIP INVITE Ringing', color: '#a855f7' },
  { seconds: 16, label: 'Paging', color: '#22c55e' },
  { seconds: 62, label: 'Tracking area update', color: '#f59e0b' },
  { seconds: 120, label: 'SRVCC LTE->GSM Success', color: '#ef4444' },
  { seconds: 170, label: 'EPS bearer release', color: '#f59e0b' },
].map((e) => ({
  timestamp: at(e.seconds), label: e.label, detail: `${e.label} detail`,
  technology: 'LTE', layer: 'RRC', direction: 'DL', color: e.color,
}));

const overviewTimes = Array.from({ length: 121 }, (_, i) => at((SPAN - 1) * (i / 120)));
const overviewLanes = [
  {
    name: 'Κατάσταση',
    segments: [
      { from: at(0), to: at(30), label: 'IDLE', color: '#4b5563' },
      { from: at(30), to: at(150), label: 'CALL · MOC', color: '#dc2626' },
      { from: at(150), to: at(SPAN - 1), label: 'IDLE', color: '#4b5563' },
    ],
  },
  {
    name: 'Τεχνολογία',
    segments: [
      { from: at(0), to: at(120), label: 'LTE E-UTRA 20', color: '#3b82f6' },
      { from: at(120), to: at(SPAN - 1), label: 'GSM 900', color: '#fb7185' },
    ],
  },
];

function Harness() {
  const [hoveredTime, setHoveredTime] = React.useState<number | null>(null);
  const [pinned, setPinned] = React.useState(true);
  const rows = React.useMemo(() => samples.filter((_, i) => i % 3 === 0), []);
  return (
    <div className="dark bg-background text-foreground min-h-screen p-4 space-y-2">
      <div data-testid="sticky-wrapper" className={pinned ? 'sticky top-[57px] z-30 bg-background/95 backdrop-blur-sm rounded-lg' : ''}>
        <CallSignalChart
          network="LTE"
          samples={samples}
          domain={{ start: at(0), end: at(SPAN - 1) }}
          callBounds={{ start: at(30), end: at(150) }}
          overviewTimes={overviewTimes}
          overviewLanes={overviewLanes}
          events={events}
          hoveredTime={hoveredTime}
          onHoverTime={setHoveredTime}
          pinned={pinned}
          onPinnedChange={setPinned}
          subtitle={`±30s γύρω από την κλήση · ${samples.length} δείγματα · A-side`}
        />
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => {
            const active = hoveredTime != null && Math.abs(row.t - hoveredTime) <= 1500;
            return (
              <tr
                key={row.t}
                data-row-time={row.t}
                onMouseEnter={() => setHoveredTime(row.t)}
                onMouseLeave={() => setHoveredTime(null)}
                className={active ? 'bg-cyan-500/10' : 'hover:bg-muted/40'}
              >
                <td className="px-2 py-1 font-mono">{new Date(row.t).toISOString().slice(11, 23)}</td>
                <td className="px-2 py-1 font-mono">{row.RSRP?.toFixed(1) ?? '—'}</td>
                <td className="px-2 py-1 font-mono">{row.RxLev?.toFixed(1) ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
