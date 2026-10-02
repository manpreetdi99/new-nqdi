import React from 'react';
import { createRoot } from 'react-dom/client';
import ResultCharts from '../src/components/ResultCharts';
import '../src/index.css';

// Ντετερμινιστικό "random" για σταθερά screenshots.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const OPS = [
  { loc: 'Cosmote Free A', cssr: 0.985, drop: 0.012 },
  { loc: 'Vodafone Free A', cssr: 0.972, drop: 0.02 },
  { loc: 'Nova Free A', cssr: 0.955, drop: 0.03 },
];
const COLLECTIONS = ['DT_ATHENS_MAJOR CITIES_2026H2', 'DT_EGNATIA_MOTORWAYS_2026H2', 'DT_TRIKALA_MAJOR TOWNS_2026H2'];

// 1. LQCallData.sql — μία γραμμή ανά κλήση με 0/1 flags
const voiceRows = Array.from({ length: 900 }, (_, i) => {
  const op = OPS[i % 3];
  const r = rnd();
  const status = r < 1 - op.cssr ? 'Failed' : r < 1 - op.cssr + op.drop ? 'Dropped' : 'Completed';
  return {
    SessionId: 50_000 + i,
    CollectionName: pick(COLLECTIONS),
    ASideLocation: op.loc,
    CallStatus: status,
    MOCMTC: i % 2 ? 'MOC' : 'MTC',
    CustomCallMode: rnd() < 0.8 ? 'VoLTE Call' : 'CS call',
    startTime: new Date(Date.UTC(2026, 8, 1 + Math.floor(i / 60), 8 + (i % 10), (i * 7) % 60)).toISOString().slice(0, 19),
    'CallSetupTimeVoLTE ': status === 'Failed' ? null : +(1.2 + rnd() * 1.4 + (i % 3) * 0.15).toFixed(3),
    CallAttemps: 1,
    Callconnected: status === 'Failed' ? 0 : 1,
    CallCompleted: status === 'Completed' ? 1 : 0,
    CallDropped: status === 'Dropped' ? 1 : 0,
    CallFailed: status === 'Failed' ? 1 : 0,
  };
});

// 2. HTTP BROWSING p1 RAW — ήδη group-αρισμένο, "Avg" = AVG*COUNT
const browsingRows = OPS.flatMap((op, oi) =>
  ['www.google.gr', 'www.ert.gr', 'www.in.gr', 'www.skai.gr'].flatMap((url) =>
    ['Successful', 'Failed'].map((status) => {
      const num = status === 'Successful' ? 40 + Math.floor(rnd() * 30) : 1 + Math.floor(rnd() * 3);
      const mean = 1.1 + oi * 0.25 + rnd() * 0.6;
      return {
        'Collection Name': 'HTTP Browsing',
        ASideLocation: op.loc.replace('Free', 'Data'),
        'Serving Operator': op.loc.split(' ')[0],
        Status: status,
        Num: num,
        Avg: status === 'Successful' ? +(mean * num).toFixed(3) : null,
        MinVal: status === 'Successful' ? +(mean * 0.5).toFixed(3) : null,
        MaxVal: status === 'Successful' ? +(mean * 2.4).toFixed(3) : null,
        StdVal: status === 'Successful' ? +(mean * 0.3).toFixed(3) : null,
        URL: url,
      };
    }),
  ),
);

// 3. Raw LTE + MOS δείγματα με χρόνο
const T0 = Date.UTC(2026, 8, 10, 7, 0, 0);
const radioRows = Array.from({ length: 3000 }, (_, i) => {
  const op = OPS[i % 3];
  const oi = i % 3;
  const rsrp = -85 - oi * 4 - 18 * Math.abs(Math.sin(i / 97)) - rnd() * 8;
  return {
    Location: op.loc,
    CollectionName: COLLECTIONS[Math.floor(i / 1000)],
    FullDate: new Date(T0 + i * 4000).toISOString().replace('Z', ''),
    EARFCN: pick([1850, 6300, 3350]),
    RSRP: +rsrp.toFixed(1),
    SINR: +(22 + (rsrp + 85) * 0.6 + rnd() * 4).toFixed(1),
    MOS: +Math.min(4.6, Math.max(1, 4.4 + (rsrp + 90) * 0.03 - rnd() * 0.6)).toFixed(2),
    latitude: 38 + rnd(),
    longitude: 23 + rnd(),
  };
});

// 4. Template "R24 Voice KPI by location" (ήδη group-αρισμένο) + παλιό defaultChart
const kpiRows = COLLECTIONS.flatMap((c) =>
  OPS.map((op, oi) => {
    const total = 80 + Math.floor(rnd() * 200);
    const bad = Math.floor(total * (0.01 + oi * 0.012 + rnd() * 0.01));
    return {
      CollectionName: c,
      Location: op.loc,
      total_calls: total,
      bad_calls: bad,
      bad_call_pct: +((100 * bad) / total).toFixed(2),
      avg_setup_s: +(1.4 + oi * 0.2 + rnd() * 0.3).toFixed(3),
      avg_mos: +(3.9 - oi * 0.1 + rnd() * 0.2).toFixed(3),
    };
  }),
);

// 5. Template "GSM RxLev/RxQual ανά κλήση (30s buckets)" — ήδη bucketed στο SQL
const gsmRows = [0, 1, 2, 3].flatMap((call) => {
  const start = Date.UTC(2026, 8, 12, 9 + call, 0, 0);
  const flag = call === 2 ? 0 : 1;
  return Array.from({ length: 8 }, (_, b) => ({
    SessionId: 9000 + call,
    FileId: 77,
    callStatus: flag ? 'Completed' : 'Dropped',
    OutcomeFlag: flag,
    BucketTs: new Date(start + b * 30_000).toISOString().slice(0, 19),
    AvgRxLev: +(-70 - b * (call === 2 ? 4 : 1.2) - rnd() * 4).toFixed(2),
    AvgRxQual: +Math.min(7, (call === 2 ? b * 0.8 : 0.5) + rnd()).toFixed(2),
    SampleCount: 20 + Math.floor(rnd() * 10),
  }));
});

// 6. Template "MOS ανά operator & collection" — πολλά collections, groupCol = Location
const mosRows = Array.from({ length: 18 }, (_, i) => `DT_${['ATHENS', 'PATRA', 'LARISA', 'VOLOS', 'CHANIA', 'KOZANI'][i % 6]}_${['MAJOR CITIES', 'MOTORWAYS', 'MAJOR TOWNS'][Math.floor(i / 6)]}_2026H2`)
  .flatMap((c) => OPS.map((op, oi) => ({
    CollectionName: c,
    Location: op.loc,
    calls: 30 + Math.floor(rnd() * 90),
    avg_mos: +(3.95 - oi * 0.12 + rnd() * 0.25).toFixed(3),
    min_mos: +(1.5 + rnd()).toFixed(3),
    max_mos: +(4.4 + rnd() * 0.2).toFixed(3),
  })));

const cols = (rows: Record<string, unknown>[]) => Object.keys(rows[0]);

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-8 max-w-[1400px] mx-auto">
      <Block id="voice" title="1 · LQCallData (flags ανά κλήση)">
        <ResultCharts columns={cols(voiceRows)} data={voiceRows} />
      </Block>
      <Block id="browsing" title="2 · HTTP Browsing (alev Avg / Num)">
        <ResultCharts columns={cols(browsingRows)} data={browsingRows} />
      </Block>
      <Block id="radio" title="3 · Raw LTE / MOS με χρόνο">
        <ResultCharts columns={cols(radioRows)} data={radioRows} />
      </Block>
      <Block id="legacy" title="4 · Template R24 Voice KPI by location (legacy defaultChart)">
        <ResultCharts columns={cols(kpiRows)} data={kpiRows}
          defaultChartType="bar" defaultXCol="Location" defaultYCols={['total_calls', 'bad_calls']} defaultAggFn="sum" defaultAggEnabled={false} />
      </Block>
      <Block id="gsm" title="5 · Template GSM RxLev/RxQual 30s buckets (legacy line + axisOverrides)">
        <ResultCharts columns={cols(gsmRows)} data={gsmRows}
          defaultChartType="line" defaultXCol="BucketTs" defaultYCols={['AvgRxLev', 'AvgRxQual', 'OutcomeFlag']}
          defaultAxisOverrides={{ AvgRxQual: { domain: [0, 7], reversed: true } }} defaultGroupCol="SessionId" defaultAggFn="avg" defaultAggEnabled={false} />
      </Block>
      <Block id="mos" title="6 · Template MOS ανά operator & collection (groupCol Location)">
        <ResultCharts columns={cols(mosRows)} data={mosRows}
          defaultChartType="bar" defaultXCol="CollectionName" defaultYCols={['avg_mos']} defaultGroupCol="Location" defaultAggFn="avg" defaultAggEnabled={false} />
      </Block>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
