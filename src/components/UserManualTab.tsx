import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Info, ListOrdered } from "lucide-react";

import { useUrlStringState } from "@/hooks/use-url-state";
import { resolveOperator } from "@/lib/attachmentC";
import { STATUS_COLORS, technologyColor } from "@/lib/chartStyles";
import { cn } from "@/lib/utils";

/**
 * User Manual tab: τα δύο εγχειρίδια (docs/Summary_Tab_User_Manual.pdf και
 * docs/All_Sessions_Call_Detail_User_Manual.pdf) ως κανονική σελίδα μέσα στην εφαρμογή —
 * πίνακες, διαγράμματα οθόνης σε HTML και πίνακας περιεχομένων που ακολουθεί το scroll.
 *
 * Τα χρώματα (operators, status, event labels, χάρτης, τεχνολογίες) διαβάζονται από τις ίδιες
 * πηγές με τα πραγματικά tabs, ώστε το manual να δείχνει ό,τι βλέπει ο χρήστης στην οθόνη.
 * Operator ονόματα όπως στην εφαρμογή (COSMOTE) — όχι TELEKOM όπως στο TELEKOM PDF.
 */

type GuideId = "summary" | "sessions";
const GUIDE_IDS: readonly GuideId[] = ["summary", "sessions"];

type TocEntry = { id: string; title: string };

const SUMMARY_SECTIONS: TocEntry[] = [
  { id: "sum-1", title: "1. What the Summary tab is" },
  { id: "sum-2", title: "2. Quick start" },
  { id: "sum-3", title: "3. Screen layout" },
  { id: "sum-4", title: "4. The headline number" },
  { id: "sum-5", title: "5. Display options" },
  { id: "sum-6", title: "6. Reading the tables" },
  { id: "sum-7", title: "7. Compact view and Full view" },
  { id: "sum-8", title: "8. Colours" },
  { id: "sum-9", title: "9. Troubleshooting" },
];

const SESSIONS_SECTIONS: TocEntry[] = [
  { id: "ses-1", title: "1. Overview" },
  { id: "ses-2", title: "2. The session list" },
  { id: "ses-3", title: "3. Call Detail at a glance" },
  { id: "ses-4", title: "4. The call header" },
  { id: "ses-5", title: "5. The signal chart" },
  { id: "ses-6", title: "6. SRVCC and CSFB transitions" },
  { id: "ses-7", title: "7. The map" },
  { id: "ses-8", title: "8. The tables" },
  { id: "ses-9", title: "9. Example: investigating a dropped call" },
  { id: "ses-10", title: "10. Troubleshooting" },
];

const SECTION_TITLES = new Map([...SUMMARY_SECTIONS, ...SESSIONS_SECTIONS].map((entry) => [entry.id, entry.title]));

const OPERATORS = ["COSMOTE", "VODAFONE", "NOVA"].map((name) => resolveOperator(name));

/** Ίδια αντιστοίχιση με το eventColor του CallDetail (ταμπέλες πάνω από το διάγραμμα σήματος). */
const EVENT_LAYER_COLORS = {
  handover: "#ef4444",
  sip: "#a855f7",
  nas: "#f59e0b",
  rrc: "#06b6d4",
  other: "#22c55e",
} as const;

/** Ίδια κατώφλια/χρώματα με rsrpColor / rxLevColor του χάρτη στο CallDetail. */
const ROUTE_COLORS = { good: "#22c55e", fair: "#f97316", bad: "#ef4444" } as const;

// Το sticky header της εφαρμογής δημοσιεύει το ύψος του ως --app-header-height (βλ. Index.tsx).
const SCROLL_MARGIN: CSSProperties = { scrollMarginTop: "calc(var(--app-header-height, 57px) + 1rem)" };
const STICKY_TOP: CSSProperties = { top: "calc(var(--app-header-height, 57px) + 1rem)" };

const scrollToSection = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

// ─── Building blocks ──────────────────────────────────────────────────────────────

const Section = ({ id, children }: { id: string; children: ReactNode }) => (
  <section id={id} style={SCROLL_MARGIN} className="space-y-3 border-t border-border pt-8 first:border-t-0 first:pt-0">
    <h2 className="text-xl font-bold tracking-tight text-foreground">{SECTION_TITLES.get(id)}</h2>
    {children}
  </section>
);

const Sub = ({ id, children }: { id: string; children: ReactNode }) => (
  <h3 id={id} style={SCROLL_MARGIN} className="pt-3 text-base font-semibold text-primary">
    {children}
  </h3>
);

const P = ({ children, muted = false }: { children: ReactNode; muted?: boolean }) => (
  <p className={cn("leading-relaxed", muted ? "text-xs text-muted-foreground" : "text-sm text-foreground/90")}>{children}</p>
);

const SecLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <a
    href={`#${to}`}
    onClick={(event) => {
      event.preventDefault();
      scrollToSection(to);
    }}
    className="font-medium text-primary underline-offset-2 hover:underline"
  >
    {children}
  </a>
);

const Callout = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-3 rounded-r-md border-l-4 border-primary bg-muted/50 px-4 py-3 text-sm leading-relaxed text-foreground/90">
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
    <div>{children}</div>
  </div>
);

const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="space-y-2 text-sm text-foreground/90">
    {items.map((item, index) => (
      <li key={index} className="flex gap-3 leading-relaxed">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
          {index + 1}
        </span>
        <span>{item}</span>
      </li>
    ))}
  </ol>
);

const Bullets = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90 marker:text-muted-foreground">
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

const ManualTable = ({
  head,
  rows,
  strongFirstCol = false,
  className,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  strongFirstCol?: boolean;
  className?: string;
}) => (
  <div className={cn("overflow-x-auto rounded-lg border border-border", className)}>
    <table className="w-full min-w-[480px] text-left text-[13px]">
      <thead className="bg-muted/60">
        <tr>
          {head.map((cell, index) => (
            <th key={index} className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-foreground">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-t border-border/60 align-top">
            {row.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className={cn(
                  "px-3 py-2 leading-relaxed text-foreground/90",
                  cellIndex === 0 && strongFirstCol && "font-semibold text-foreground",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Swatch = ({ color, className }: { color?: string; className?: string }) => (
  <span
    className={cn("inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-white/25", className)}
    style={color ? { backgroundColor: color } : undefined}
  />
);

const Num = ({ n, className }: { n: number; className?: string }) => (
  <span
    className={cn(
      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow",
      className,
    )}
  >
    {n}
  </span>
);

/** Ένα «κουτί» οθόνης στα διαγράμματα layout. Dashed = εμφανίζεται μόνο όταν ισχύει. */
const Box = ({
  n,
  title,
  lines = [],
  dashed = false,
  className,
  children,
}: {
  n?: number;
  title?: ReactNode;
  lines?: ReactNode[];
  dashed?: boolean;
  className?: string;
  children?: ReactNode;
}) => (
  <div
    className={cn(
      "relative rounded-md border bg-card px-3 py-2",
      dashed ? "border-dashed border-muted-foreground/40" : "border-border",
      className,
    )}
  >
    {n != null && <Num n={n} className="absolute -right-2 -top-2" />}
    {title && <p className="text-xs font-semibold text-foreground">{title}</p>}
    {lines.map((line, index) => (
      <p key={index} className="text-[11px] leading-snug text-muted-foreground">
        {line}
      </p>
    ))}
    {children}
  </div>
);

const Diagram = ({ children, caption }: { children: ReactNode; caption?: ReactNode }) => (
  <figure className="space-y-2">
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4 pr-5">{children}</div>
    {caption && <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>}
  </figure>
);

const OperatorLegend = () => (
  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
    {OPERATORS.map((operator) => (
      <span key={operator.key} className="inline-flex items-center gap-1.5">
        <Swatch color={operator.color} />
        {operator.label}
      </span>
    ))}
  </span>
);

const ColourCell = ({ color }: { color: string }) => <Swatch color={color} />;

const Cover = ({
  title,
  subtitle,
  intro,
  meta,
}: {
  title: string;
  subtitle: string;
  intro: string;
  meta: [string, ReactNode][];
}) => (
  <header className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-primary">User manual</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
    <p className="max-w-3xl text-sm leading-relaxed text-foreground/90">{intro}</p>
    <dl className="grid max-w-3xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-t border-border pt-3 text-xs">
      {meta.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground/90">{value}</dd>
        </div>
      ))}
    </dl>
  </header>
);

// ─── Summary Tab manual ───────────────────────────────────────────────────────────

const SummaryGuide = () => (
  <div className="space-y-8">
    <Cover
      title="Summary Tab"
      subtitle="A-Level Analysis · Statistics Tables"
      intro="How to open the Summary tab, pick the data you want, read the three statistics tables and use the display options."
      meta={[
        ["Covers", "Summary tab: GSM Call Stats, Free (2G-3G-LTE) Call Stats, PS Data Stats"],
        ["Intended for", "Anyone who reviews drive-test results in the app"],
        ["Date", "24 September 2026"],
      ]}
    />

    <Section id="sum-1">
      <P>
        The Summary tab shows the <strong>Attachment C statistics tables</strong> of the A-Level report directly in the app. You
        do not need Excel: the numbers are calculated live from the database and collections you select.
      </P>
      <P>
        There are three tables. In each table the <strong>rows are KPIs</strong> and the <strong>columns are the operators</strong>{" "}
        ({OPERATORS.map((operator) => operator.label).join(", ")}), plus a <strong>Total</strong> column.
      </P>
      <ManualTable
        head={["Table on screen", "Report table", "What it shows"]}
        rows={[
          ["GSM Call Stats", "Table 20", "Voice calls made in GSM mode"],
          ["Free (2G-3G-LTE) Call Stats", "Table 21", "Voice calls made in free mode (2G / 3G / LTE, incl. VoLTE and SRVCC)"],
          ["PS Data Stats", "Table 22", "Data tests: throughput, ping, browsing, video, etc."],
        ]}
      />
    </Section>

    <Section id="sum-2">
      <Steps
        items={[
          <>
            Open the application and click the <strong>Summary</strong> tab at the top of the page.
          </>,
          <>
            In the header, open the <strong>Database</strong> list and choose the database (for example, the week's drive test).
          </>,
          <>
            Open <strong>Collections</strong> and tick the collections you want in the report. You can tick several.
          </>,
          <>
            Wait a moment. The tables fill in piece by piece while the <strong>Loading n/11 sources</strong> chip is shown. When the
            chip disappears, everything has loaded.
          </>,
          <>
            Choose <strong>Compact</strong> for a short overview or <strong>Full</strong> for every KPI (see{" "}
            <SecLink to="sum-5">section 5</SecLink>).
          </>,
        ]}
      />
      <Callout>
        <strong>Tip:</strong> The Summary tab remembers your database, collections and Compact/Full choice the next time you open it
        on the same computer. Its selection is separate from the other tabs, so changing collections here does not change the All
        Calls tab, and the reverse.
      </Callout>
    </Section>

    <Section id="sum-3">
      <P>The numbered areas below are explained in the table that follows.</P>
      <Diagram>
        <div className="grid gap-3 sm:grid-cols-3">
          <Box
            n={1}
            title="Title & info chips"
            lines={["A-Level Analysis / Statistics Tables", "Week · Period", "Loading n/11 · Failed n/11 [Retry]"]}
          />
          <Box
            n={2}
            title="Database & Collections"
            lines={[
              "Database: drop-down list",
              "Collections: tick one or more",
              <>
                <span className="text-red-400">Red name</span> = unexplained drop/fail
              </>,
            ]}
          />
          <Box n={3} title="Headline number" lines={["Overall call success rate", "coloured green / orange / red"]} />
        </div>
        <Box n={4}>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p className="flex flex-wrap items-center gap-2">
              Operators: <OperatorLegend />
            </p>
            <p>Controls: [ Full | Compact ] Valid calls · Avoid system release · Hide incl. SR · Highlight best · Hide empty rows</p>
          </div>
        </Box>
        <Box n={5} dashed title="Per-operator tiles: GSM+FREE call success rate (Full view only)" />
        <div className="relative grid gap-3 sm:grid-cols-2">
          <Num n={6} className="absolute -right-2 -top-2 z-10" />
          <Box
            title="GSM Call Stats (Table 20)"
            lines={["Rows = KPIs", `Columns = ${OPERATORS.map((operator) => operator.label).join(" · ")} · Total`]}
            className="min-h-[72px]"
          />
          <Box
            title="Free (2G-3G-LTE) Call Stats (Table 21)"
            lines={["Rows = KPIs", `Columns = ${OPERATORS.map((operator) => operator.label).join(" · ")} · Total`]}
            className="min-h-[72px]"
          />
        </div>
        <Box
          n={7}
          title="PS Data Stats (Table 22)"
          lines={["Serving Band / Serving Technology pies (Full view only)", "One small table per data test, grouped E1 … E5"]}
          className="min-h-[90px]"
        />
      </Diagram>
      <ManualTable
        head={["#", "Area", "What it is for"]}
        rows={[
          [
            "1",
            "Title & info chips",
            <>
              <strong>Week</strong> and <strong>Period</strong> (first and last date) of the selected data.{" "}
              <strong>Loading</strong> shows progress; <strong>Failed</strong> appears in red if a data source did not load.
            </>,
          ],
          [
            "2",
            "Database & Collections",
            <>
              Choose what goes into the report. A collection shown in <strong className="text-red-400">red</strong> has at least
              one dropped or failed call that has no comment yet.
            </>,
          ],
          [
            "3",
            "Headline number",
            "Overall call success rate for all selected calls, with the count of normal releases, attempts and data tests below it.",
          ],
          [
            "4",
            "Operators & controls",
            <>
              Operator colour legend, the Compact / Full switch and the display options (<SecLink to="sum-5">section 5</SecLink>).
            </>,
          ],
          ["5", "Operator tiles", "Call success rate per operator (GSM + FREE together). Full view only."],
          [
            "6",
            "Voice tables",
            "GSM Call Stats and Free (2G-3G-LTE) Call Stats. Side by side in Compact view, one above the other in Full view.",
          ],
          [
            "7",
            "PS Data Stats",
            <>
              One small table per data test type, grouped E1 to E5 (<SecLink to="sum-6-3">section 6.3</SecLink>).
            </>,
          ],
        ]}
      />
    </Section>

    <Section id="sum-4">
      <P>
        The large number at the top right is the <strong>overall call success rate</strong>: normal releases divided by call
        attempts, for all operators and both call modes together. When <strong>Avoid system release</strong> is on, its label reads{" "}
        <em>(excl. SR)</em> and system releases are left out of the calculation.
      </P>
      <P>
        When both <strong>Valid calls</strong> and <strong>Avoid system release</strong> are on, the number is coloured:
      </P>
      <ManualTable
        className="max-w-md"
        head={["Colour", "Success rate"]}
        rows={[
          [<ColourCell color={STATUS_COLORS.good} />, "Green — above 95 %"],
          [<ColourCell color={STATUS_COLORS.warning} />, "Orange — 90 % to 95 %"],
          [<ColourCell color={STATUS_COLORS.critical} />, "Red — below 90 %"],
        ]}
      />
    </Section>

    <Section id="sum-5">
      <P>
        The controls sit on the right of the line under the header. Most of them only change what you see;{" "}
        <strong>Valid calls</strong> and <strong>Avoid system release</strong> also change the numbers.
      </P>
      <ManualTable
        strongFirstCol
        head={["Option", "What it does", "Default"]}
        rows={[
          [
            "Compact / Full",
            <>
              Compact shows a short overview with only the main KPIs. Full shows every KPI, the per-operator tiles and the pie
              charts. Details in <SecLink to="sum-7">section 7</SecLink>.
            </>,
            "Compact",
          ],
          ["Valid calls", "Leaves out calls and tests that were marked as not valid.", "On"],
          [
            "Avoid system release",
            "Calculates the rates without the calls that ended in a system release, so they count neither as a success nor as a failure.",
            "On",
          ],
          [
            "Hide incl. SR",
            <>
              Hides the small grey line <em>incl. SR …</em> under each rate, which shows the value <em>with</em> system releases.
              Only available when Avoid system release is on.
            </>,
            "On",
          ],
          [
            "Highlight best",
            <>
              Marks the best operator with a <strong>best</strong> tag on the key rows (for example Call Success Rate).
            </>,
            "On",
          ],
          ["Hide empty rows", "Hides rows that have no value (or zero) for every operator.", "Off"],
        ]}
      />
      <Callout>Hover over an option or a KPI name to see a short explanation.</Callout>
    </Section>

    <Section id="sum-6">
      <Sub id="sum-6-1">6.1 How to read a cell</Sub>
      <Bullets
        items={[
          <>
            <strong>—</strong> (dash) means there is no data for that operator or KPI. It does not mean zero.
          </>,
          <>
            A small grey line <strong>incl. SR …</strong> under a rate shows the same rate calculated with system releases included.
          </>,
          <>
            In Compact view a rate cell also shows <strong>sum=…</strong>: the number of calls behind that rate.
          </>,
          <>
            <strong>MOS</strong> rows show the number of samples (<strong>n=…</strong>) and the lowest–highest value.
          </>,
          <>
            A <strong>best</strong> tag marks the best operator in that row when Highlight best is on.
          </>,
          <>
            Rates are coloured by how good they are (see <SecLink to="sum-8">section 8</SecLink>).
          </>,
        ]}
      />

      <Sub id="sum-6-2">6.2 Voice tables — main KPIs</Sub>
      <P>
        Every call is sorted into one of four outcomes: <strong>normal release</strong> (completed), <strong>dropped</strong>,{" "}
        <strong>access failure</strong> (could not be set up) or <strong>system release</strong>.
      </P>
      <ManualTable
        head={["KPI", "Meaning"]}
        rows={[
          ["Call Attempts", "All calls that were started."],
          ["Total Calls", "Calls that were set up: attempts minus access failures."],
          ["Call Success Rate (%)", "Normal releases ÷ call attempts. Higher is better."],
          ["Dropped Call Rate (%)", "Dropped calls ÷ total calls. Lower is better."],
          ["Access Failure Rate (%)", "Unsuccessful attempts ÷ call attempts. Lower is better."],
          ["System Release Rate (%)", "System releases ÷ total calls."],
          ["POLQA avg / MOS UL / MOS DL", "Speech quality score (1 = bad, 5 = excellent). UL = uplink, DL = downlink."],
          ["Low Speech Quality Calls", "Calls with poor speech quality (below 2.2, and below 1.3)."],
          ["Call Setup Time (sec)", "How long a call took to connect (MOC = outgoing, MTC = incoming)."],
          ["SRVCC attempts", "Hand-overs of a VoLTE call to 2G/3G. Free table only."],
          ["Codec Type Usage % / Technology mix", "Share of each voice codec / radio technology used."],
          [
            "Fake Event(s)",
            "Sessions marked not valid with a comment starting with “fake”. Shown even when Valid calls hides them.",
          ],
        ]}
      />
      <P muted>
        With <strong>Avoid system release</strong> on, the attempt and call counts are labelled <em>(excl. SR)</em> and all rates
        are calculated without system releases.
      </P>

      <Sub id="sum-6-3">6.3 PS Data Stats</Sub>
      <P>
        Each data test type has its own small table with <strong>Test Success Rate (%)</strong>, <strong>Total Tests</strong>, and
        the main measurement for that test. The tests are grouped as follows:
      </P>
      <ManualTable
        head={["Group", "Tests", "Main measurement"]}
        rows={[
          ["E1 · Bulk throughput", "Capacity DL/UL, HTTP Transfer DL/UL, Ookla DL/UL", "Mean throughput (Mbps) — higher is better"],
          [
            "E2 · Latency / Responsiveness",
            "Ping 40 / 800 / 1000 B, DNS Resolution, Interactivity (eGaming)",
            "Mean time in ms — lower is better",
          ],
          ["E3 · Browser engines", "Kepler, Kepler +30s Pause, Newton", "Mean throughput (Mbps)"],
          ["E4 · HTTPS sites", "9 web sites (google, amazon, ebay, youtube …)", "Mean throughput (Mbps)"],
          ["E5 · Video streaming", "YouTube Service / 4K / Live", "Mean video MOS, first delay, IP throughput (mean / max), freezing %"],
        ]}
      />
      <P>
        <strong>Test Success Rate</strong> = successful tests ÷ (successful + failed tests). In Full view the top of the card also
        shows two pie charts per operator: the 5G band used (<strong>Serving Band</strong>) and the radio technology used over time
        (<strong>Serving Technology</strong>). Each colour always means the same band or technology in every pie, so the operators
        can be compared side by side.
      </P>
    </Section>

    <Section id="sum-7">
      <P>
        Use <strong>Compact</strong> for a quick one-screen overview, and <strong>Full</strong> when you need every detail or want
        to check a number.
      </P>
      <ManualTable
        head={["", "Compact", "Full"]}
        rows={[
          [
            "Voice tables",
            "5 rows: Total Calls, Call Success Rate, Dropped Call Rate, Access Failure Rate, POLQA avg. Counts shown inside the rate cells (sum=…). Tables side by side.",
            "All KPI rows. Tables one above the other.",
          ],
          ["Operator tiles", "Hidden", "Shown"],
          ["Pie charts", "Hidden", "Shown"],
          ["Capacity / Ookla", "DL and UL combined into one table each", "Separate DL and UL tables"],
          ["Ping", "One table: all packet sizes combined", "One table per packet size"],
          ["HTTPS sites", "One table: all sites combined", "One table per site"],
          ["Not shown in Compact", "Browser engines (E3), Video streaming (E5), HTTP Transfer, DNS, Interactivity", "—"],
          ["Rows per data test", "Success rate, total tests, main measurement", "Also successful and failed test counts"],
        ]}
      />
      <P muted>Compact view also loads faster, because it does not fetch the data that only Full view shows.</P>
    </Section>

    <Section id="sum-8">
      <P>The tab uses two separate colour systems.</P>
      <P>
        <strong>Operator colours</strong> — always the same, in every table, tile and legend:
      </P>
      <ul className="max-w-xs divide-y divide-border/60 rounded-lg border border-border text-sm">
        {OPERATORS.map((operator) => (
          <li key={operator.key} className="flex items-center gap-3 px-3 py-2 text-foreground/90">
            <Swatch color={operator.color} />
            {operator.label}
          </li>
        ))}
      </ul>
      <P>
        <strong>Status colours</strong> — how good a rate is:
      </P>
      <ManualTable
        head={["", "Status", "Success rates (higher is better)", "Drop / failure rates (lower is better)"]}
        rows={[
          [<ColourCell color={STATUS_COLORS.good} />, "Good", "98 % or more", "1 % or less"],
          [<ColourCell color={STATUS_COLORS.warning} />, "Warning", "95 % to 98 %", "1 % to 2 %"],
          [<ColourCell color={STATUS_COLORS.serious} />, "Serious", "90 % to 95 %", "2 % to 5 %"],
          [<ColourCell color={STATUS_COLORS.critical} />, "Critical", "below 90 %", "above 5 %"],
        ]}
      />
    </Section>

    <Section id="sum-9">
      <ManualTable
        head={["What you see", "What to do"]}
        rows={[
          [
            <>
              Message: <em>no data — select database / collections</em>
            </>,
            "Choose a database and at least one collection in the header.",
          ],
          [
            <>
              <strong>Loading n/11 sources</strong> stays on screen
            </>,
            "The data is still loading. Large selections take longer. Wait for the chip to disappear.",
          ],
          [
            <>
              Red <strong>Failed n/11 sources</strong> chip
            </>,
            <>
              One or more data sources did not load (for example, a server timeout). Click <strong>Retry</strong>. Only the failed
              sources are loaded again.
            </>,
          ],
          [
            "A table or section is missing",
            "It has no data for your selection, it is hidden in Compact view (switch to Full), or its source failed (see the Failed chip).",
          ],
          [
            <>
              Cells show <strong>—</strong>
            </>,
            "There is no data for that operator or KPI in the selected collections.",
          ],
          [
            "A collection name is red",
            "It has dropped or failed calls without a comment. Open the All Calls tab to review them and add comments.",
          ],
          [
            "Numbers differ from a colleague's",
            <>
              Check that you both use the same database, collections, and the same <strong>Valid calls</strong> and{" "}
              <strong>Avoid system release</strong> settings.
            </>,
          ],
        ]}
      />
    </Section>
  </div>
);

// ─── All Sessions & Call Detail manual ────────────────────────────────────────────

const EventChip = ({ label, color, left }: { label: string; color: string; left: string }) => (
  <span
    className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-px text-[9px] font-semibold text-white"
    style={{ left, backgroundColor: color }}
  >
    {label}
  </span>
);

const Lane = ({ segments }: { segments: { label: string; width: string; color: string }[] }) => (
  <div className="flex h-4 overflow-hidden rounded-sm text-[9px] font-semibold text-white">
    {segments.map((segment, index) => (
      <div
        key={index}
        className="flex items-center justify-center truncate"
        style={{ width: segment.width, backgroundColor: segment.color }}
      >
        {segment.label}
      </div>
    ))}
  </div>
);

/** Σκαρίφημα του διαγράμματος σήματος (όχι πραγματικά δεδομένα) με τα 5 μέρη του. */
const SignalChartSketch = () => (
  <Diagram>
    <div className="overflow-x-auto">
      <div className="min-w-[560px] space-y-2 pr-7">
        <div className="relative flex items-center justify-between gap-3 text-[11px]">
          <span className="font-semibold text-foreground">Σήμα κλήσης · RSRP / RSRQ</span>
          <span className="text-muted-foreground">[±10s ±30s ±60s ±120s] [A-side | B-side] [Καρφιτσωμένο]</span>
          <Num n={1} className="absolute -right-7" />
        </div>
        <div className="relative text-[11px] text-muted-foreground">
          [x] RSRP [x] RSRQ [ ] LTE scanner [ ] Best LTE scanner … [x] Signaling events (n)
          <Num n={2} className="absolute -right-7 top-0" />
        </div>
        <div className="relative h-4">
          <EventChip label="RRC" color={EVENT_LAYER_COLORS.rrc} left="26%" />
          <EventChip label="SIP INVITE" color={EVENT_LAYER_COLORS.sip} left="34%" />
          <EventChip label="NAS" color={EVENT_LAYER_COLORS.nas} left="52%" />
          <EventChip label="Handover" color={EVENT_LAYER_COLORS.handover} left="62%" />
          <EventChip label="SIP BYE" color={EVENT_LAYER_COLORS.sip} left="76%" />
          <Num n={3} className="absolute -right-7 top-0" />
        </div>
        <div className="relative space-y-1">
          <Lane
            segments={[
              { label: "IDLE", width: "23%", color: "#475569" },
              { label: "CALL", width: "54%", color: "#16a34a" },
              { label: "IDLE", width: "23%", color: "#475569" },
            ]}
          />
          <Lane
            segments={[
              { label: "LTE B20", width: "61%", color: technologyColor("LTE") },
              { label: "GSM 900", width: "16%", color: technologyColor("GSM") },
              { label: "LTE B3", width: "23%", color: technologyColor("LTE") },
            ]}
          />
          <Num n={4} className="absolute -right-7 top-1" />
        </div>
        <div className="relative h-36 overflow-visible rounded-sm border border-border">
          <div className="absolute inset-y-0 left-0 w-[23%] bg-amber-300/15" />
          <div className="absolute inset-y-0 left-[23%] w-[54%] bg-sky-400/15" />
          <div className="absolute inset-y-0 left-[40%] flex w-[7%] items-end justify-center bg-muted pb-1 text-[9px] text-muted-foreground">
            No meas.
          </div>
          <div className="absolute inset-y-0 left-[77%] w-[23%] bg-orange-300/15" />
          <div className="absolute inset-y-0 left-[62%] border-l border-dashed border-foreground/70" />
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <path
              d="M0,28 C8,20 14,12 22,14 S34,24 40,25"
              fill="none"
              stroke="#60a5fa"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M47,22 L61,21 L62,31 L75,28 L76,14 L100,15"
              fill="none"
              stroke="#60a5fa"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <Num n={5} className="absolute -right-7 top-1/2 -translate-y-1/2" />
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
          <span>Πριν = before the call · Κατά = during the call · Μετά = after the call</span>
          <span>dashed line = shared cursor</span>
        </div>
      </div>
    </div>
  </Diagram>
);

const SessionsGuide = ({ onOpenGuide }: { onOpenGuide: (guide: GuideId) => void }) => (
  <div className="space-y-8">
    <Cover
      title="All Sessions"
      subtitle="with a guide to Call Detail"
      intro="How to find a call or data session in the list, open it, and investigate it in Call Detail: the signal chart, the tables, signalling and comments."
      meta={[
        ["Covers", "All Sessions list, Call Detail (in depth), Data Detail (entry point only)"],
        ["Intended for", "Anyone who reviews drive-test calls and sessions in the app"],
        [
          "Companion",
          <button type="button" onClick={() => onOpenGuide("summary")} className="font-medium text-primary hover:underline">
            Summary Tab — User Manual
          </button>,
        ],
        ["Date", "24 September 2026"],
      ]}
    />

    <Section id="ses-1">
      <P>
        The <strong>All Sessions</strong> tab lists everything recorded during a drive or walk test: <strong>voice calls</strong> at
        the top and <strong>data sessions</strong> below. From the list you open one item to see its full story.
      </P>
      <P>The tab has three views, switched from the bar at its top:</P>
      <ManualTable
        strongFirstCol
        head={["View", "What it shows", "Available when"]}
        rows={[
          ["All Sessions", "The filters and the two lists (calls and data sessions).", "Always"],
          ["Call Detail", "Everything about one voice call: radio, signalling, handovers, KPIs, map, comment.", "You have clicked a call"],
          ["Data Detail", "Everything about one data session.", "You have clicked a data session"],
        ]}
      />
      <Callout>
        <strong>Share a call:</strong> when Call Detail is open, the browser address contains the call's SessionId. Copy the address
        and send it; the other person opens exactly the same call (they need the same database and collections selected).
      </Callout>
    </Section>

    <Section id="ses-2">
      <Diagram>
        <Box n={1} className="py-1.5">
          <div className="flex gap-6 text-[11px]">
            <span className="font-semibold text-foreground">All Sessions</span>
            <span className="text-muted-foreground">Call Detail</span>
            <span className="text-muted-foreground">Data Detail</span>
          </div>
        </Box>
        <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Box
            n={2}
            title="Filters"
            lines={[
              "Database",
              "Collections",
              "Locations",
              "Session Valid",
              "Status",
              "Location (chips)",
              "File Group (±5min)",
              <span className="mt-2 block">‹ collapses to an icon</span>,
            ]}
          />
          <div className="grid gap-3">
            <Box
              n={3}
              title="All Calls (voice)"
              lines={[
                "Location Summary: Complete · Sys Rel · Drop · Fail · Total per location",
                "Search box",
                "Table: Location · SessionId · Technology · Call Mode · Status · Comment · Setup Time · Avg MOS …",
                "Click a row → Call Detail",
              ]}
            />
            <Box
              n={4}
              title="Data Session"
              lines={[
                "One row per data session (grouped by cycle if chosen)",
                "Grouping · Sort · Only problems · Search",
                "Click a row → Data Detail",
              ]}
            />
          </div>
        </div>
      </Diagram>

      <Sub id="ses-2-1">2.1 Filters</Sub>
      <P>
        The filter column on the left can be collapsed to a small icon to give the lists more room. The first three filters reload
        data from the database; the others filter what is already loaded, instantly. All filters work together (a row must match
        all of them).
      </P>
      <ManualTable
        strongFirstCol
        head={["Filter", "What it does"]}
        rows={[
          ["Database", "Choose the database. Clears the collections and locations."],
          [
            "Collections",
            <>
              Tick one or more collections. <em>Select all</em> and <em>Clear</em> are available.
            </>,
          ],
          ["Locations", "Limit to specific locations. Nothing ticked = all locations."],
          ["Session Valid", "All / only valid (1) / only not valid (0) calls."],
          ["Status", "Completed, Drop, Fail, Sys Release. Tick several to see any of them."],
          [
            <>
              Location <span className="font-normal">(chips)</span>
            </>,
            "Quick filter by location group (Data, Free + GSM (Voice)). Also filters the data sessions.",
          ],
          [
            "File Group (±5min)",
            <>
              Shows one <em>run</em>: the voice and data files that were recorded together (started within 5 minutes of each
              other). The chip shows the time range and how many voice and data sessions it contains.
            </>,
          ],
          ["Search", "Free text over the call table (location, SessionId, comment, …)."],
        ]}
      />
      <Callout>
        <strong>Device names (Location):</strong> the Location chips group the devices by the words in their name (upper or lower
        case does not matter). A <strong>voice</strong> device must contain the word <strong>free</strong>, <strong>gsm</strong> or{" "}
        <strong>voice</strong> (for example <em>Cosmote Free A</em>, <em>Vodafone GSM A</em>, <em>Nova Voice A</em>) and is shown
        under <strong>Free + GSM (Voice)</strong>. A <strong>data</strong> device must contain the word <strong>data</strong> (for
        example <em>Nova Data A</em>) and is shown under <strong>Data</strong>. A location without one of these words appears only
        under <strong>All</strong>.
      </Callout>

      <Sub id="ses-2-2">2.2 All Calls (voice)</Sub>
      <Bullets
        items={[
          <>
            <strong>Location Summary</strong> next to the title: a small table with Complete / Sys Rel / Drop / Fail / Total per
            location, for the rows currently shown.
          </>,
          "The table columns are: Location, SessionId, Technology, Call Mode, Call Type, Call Dir, Status, Comment, Setup Time, Avg MOS, Call Start Time, Call Duration, CollectionName. On a phone the rows are shown as cards.",
          <>
            <strong>Click a row</strong> to open it in Call Detail. The last row you clicked stays highlighted when you come back.
          </>,
        ]}
      />

      <Sub id="ses-2-3">2.3 Data Session</Sub>
      <Bullets
        items={[
          "Each row is one data session with its average DL / UL throughput, RTT and video MOS, plus the worst values. Expand a row to see every test type in it.",
          <>
            A <strong>cycle</strong> is one full round of the data tests. Turn on <strong>Group by cycle</strong> to see cycle
            headers; a cycle with missing sessions shows as partial (for example 4/6).
          </>,
          <>
            <strong>Only problems</strong> keeps sessions that have failures or are not valid. <strong>Sort</strong> can bring the
            most failures, the lowest DL or the highest RTT to the top.
          </>,
          <>
            <strong>Click a row</strong> to open it in Data Detail.
          </>,
        ]}
      />
      <ManualTable
        head={["Colour", "DL (Mbps)", "UL (Mbps)", "RTT (ms)", "MOS", "Success rate"]}
        rows={[
          [<Swatch className="bg-green-400" />, "20 or more", "10 or more", "50 or less", "4 or more", "98 % or more"],
          [<Swatch className="bg-yellow-400" />, "5 to 20", "2 to 10", "50 to 150", "3 to 4", "90 % to 98 %"],
          [<Swatch className="bg-red-400" />, "below 5", "below 2", "above 150", "below 3", "below 90 %"],
        ]}
      />
    </Section>

    <Section id="ses-3">
      <P>
        Call Detail shows the whole story of <strong>one</strong> voice call on a single time axis. The panels appear from top to
        bottom as below. Dashed panels appear only when they apply.
      </P>
      <Diagram>
        <Box n={1} title="Top bar" lines={["Back · Download · AVG MOS · Setup Time · status badge"]} />
        <Box n={2} dashed title="Yellow warning banner (only if some data failed to load)" />
        <Box n={3} dashed title="SRVCC Transition / CSFB Transition (only for those calls, collapsed)" />
        <Box
          n={4}
          title="Call info header"
          lines={[
            "Location · SessionId · type · technology · operator · start / end / duration",
            "HO · Codec · eNB / EARFCN / PCI / Dist · A/B outcome",
            "Prev Call / Next Call · Comment (Σχόλιο)",
          ]}
        />
        <Box n={5} dashed title="Map (COSMOTE Free only, collapsed)" />
        <Box
          n={6}
          title="Signal chart (Σήμα κλήσης)"
          lines={[
            "Window ±10 / 30 / 60 / 120 s · A-side / B-side · Pinned / Free",
            "Series checkboxes · scanner series · Signaling events",
            "Event labels · Session Overview lanes · signal curve",
            "Zones: Πριν (before) · Κατά (during) · Μετά (after)",
          ]}
        />
        <div className="relative grid gap-3 sm:grid-cols-3">
          <Num n={7} className="absolute -right-2 -top-2 z-10" />
          <Box title="TraceLog" lines={["Time · Side · Info"]} />
          <Box title="KPI Results" lines={["MsgTime · KPI · Status / Code"]} />
          <Box title="LTE / GSM Measurements" lines={["Radio samples + scanner · Δt(s)"]} />
        </div>
        <Box n={8} dashed title="Συμπεριφορά δικτύου ±Ns (network behaviour before / after)" />
        <Box n={9} title="L3 Signaling — RRC / NAS / SIP" lines={["Search · Phase · Severity · jump to findings · A/B split"]} />
        <Box n={10} dashed title="Scanner & Κινητό (device information)" />
      </Diagram>
      <ManualTable
        className="max-w-2xl"
        head={["#", "Panel", "Section"]}
        rows={[
          ["1", "Top bar", <SecLink to="ses-4-1">4.1</SecLink>],
          ["2", "Warning banner", <SecLink to="ses-10">10</SecLink>],
          ["3", "SRVCC / CSFB Transition", <SecLink to="ses-6">6</SecLink>],
          ["4", "Call info header, navigation and comment", <SecLink to="ses-4-2">4.2 – 4.4</SecLink>],
          ["5", "Map", <SecLink to="ses-7">7</SecLink>],
          ["6", "Signal chart", <SecLink to="ses-5">5</SecLink>],
          ["7", "TraceLog, KPI Results, Measurements", <SecLink to="ses-8-1">8.1 – 8.3</SecLink>],
          ["8", "Network behaviour before / after", <SecLink to="ses-8-4">8.4</SecLink>],
          ["9", "L3 Signaling", <SecLink to="ses-8-5">8.5</SecLink>],
          ["10", "Scanner & device", <SecLink to="ses-8-6">8.6</SecLink>],
        ]}
      />
      <Callout>
        <strong>The key idea — one shared cursor.</strong> Move the mouse over any row of any table (L3, TraceLog, KPI,
        Measurements) or over the map, and the chart draws a vertical line at that moment. Move over the chart, and the matching
        row lights up in every table. This is how you connect <em>what the signal did</em> with <em>what the network said</em>.
      </Callout>
    </Section>

    <Section id="ses-4">
      <Sub id="ses-4-1">4.1 Top bar</Sub>
      <P>
        A back arrow to the list, three quick metrics — <strong>Download</strong>, <strong>AVG MOS</strong> (hover to see the
        individual MOS samples) and <strong>Setup Time</strong> (orange if above 500 ms) — and the call's status badge.
      </P>

      <Sub id="ses-4-2">4.2 Call info</Sub>
      <ManualTable
        head={["Line", "Content"]}
        rows={[
          [
            "Title",
            <>
              Location · SessionId (for example <em>COSMOTE Free A · 123456</em>).
            </>,
          ],
          [
            "Details",
            <>
              Call type · technology · operator, then <strong>Έναρξη</strong> (start), <strong>Λήξη</strong> (end) and the
              duration.
            </>,
          ],
          [
            "Signalling strip",
            <>
              <strong>HO</strong>: handover results with their duration in ms (green = success). <strong>Codec</strong>: last UL
              and DL voice codec and rate. <strong>eNB / EARFCN / PCI / Dist</strong>: serving LTE cell and distance to the
              matched antenna. <strong>A / B</strong>: how each side of the call ended, with its cause code.
            </>,
          ],
        ]}
      />

      <Sub id="ses-4-3">4.3 Prev Call / Next Call</Sub>
      <P>
        Move to the previous or next call of the same recording without going back to the list. A button is grey when there is no
        call before or after. If the target call is hidden by your list filters, a message tells you so instead of opening an
        empty page.
      </P>

      <Sub id="ses-4-4">4.4 Comment (Σχόλιο)</Sub>
      <Steps
        items={[
          <>
            Pick a quick tag from <strong>Γρήγορη επιλογή…</strong> (quick choice) or type your own text.
          </>,
          <>
            Click <strong>Αποθήκευση</strong> (save). <strong>Ακύρωση</strong> cancels.
          </>,
        ]}
      />
      <ManualTable
        head={["Quick tag", "Use it for"]}
        rows={[
          ["LC GSM / LC LTE", "Low coverage in GSM / LTE"],
          ["LQ GSM / LQ LTE", "Low quality in GSM / LTE"],
          ["CORE NETWORK (DEACTIVATE BEARER)", "The core network released the bearer"],
          ["FAKE UE STUCK / FAKE NO SYNC / FAKE EOF", "Not a real network failure (device stuck, no sync, end of file)"],
          ["— Εκκαθάριση σχολίου", "Clear the comment"],
        ]}
      />
      <Bullets
        items={[
          <>
            A quick tag <strong>replaces</strong> the text in the box; it is not added to it.
          </>,
          "The new comment appears in the header and in the list straight away.",
          <>
            A call marked not valid whose comment starts with <strong>FAKE</strong> is counted as a <strong>Fake Event</strong> in
            the Summary tab.
          </>,
          "Dropped or failed calls with no comment make their collection show in red in the Summary tab — commenting them clears the red.",
        ]}
      />
    </Section>

    <Section id="ses-5">
      <P>
        The chart is the centre of Call Detail. It shows the signal before, during and after the call on one time axis, with the
        network events on top.
      </P>
      <SignalChartSketch />
      <ManualTable
        head={["#", "Part", "How to use it"]}
        rows={[
          [
            "1",
            "Title & controls",
            <>
              The title shows what is plotted: RSRP / RSRQ (LTE), RxLev / RxQual (GSM) or SS-RSRP / SS-RSRQ (5G). Then the
              controls (<SecLink to="ses-5-1">5.1</SecLink>).
            </>,
          ],
          [
            "2",
            "Series",
            <>
              Tick or untick each line. Scanner lines (LTE, GSM, 5G scanner and <em>Best</em> scanner) are off by default.{" "}
              <strong>Signaling events (n)</strong> shows or hides the labels.
            </>,
          ],
          [
            "3",
            "Event labels",
            "One label per L3 / SIP / NAS / handover message. When labels are crowded some are hidden, but SRVCC / CSFB handovers are always shown.",
          ],
          [
            "4",
            "Session Overview",
            <>
              Two lanes: <strong>IDLE / CALL</strong>, and the technology / band in use (for example LTE B20 → GSM 900).
            </>,
          ],
          [
            "5",
            "Curve & zones",
            <>
              Signal strength and quality. Background zones mark <strong>Πριν</strong> (before), <strong>Κατά</strong> (during,
              shaded) and <strong>Μετά</strong> (after) the call.
            </>,
          ],
        ]}
      />

      <Sub id="ses-5-1">5.1 Controls</Sub>
      <ManualTable
        strongFirstCol
        head={["Control", "What it does"]}
        rows={[
          [
            "±10s / ±30s / ±60s / ±120s",
            "How much time before and after the call to show. Default ±60 s for CS (GSM) calls and ±30 s for the others. Changing it is instant.",
          ],
          [
            "A-side / B-side",
            <>
              Which phone of the call to look at. This choice applies to the <strong>whole page</strong>. B is greyed out when
              there is no B-side data.
            </>,
          ],
          [
            "Καρφιτσωμένο / Ελεύθερο",
            "Pinned (default): the chart stays at the top while you scroll the tables, so the shared cursor is always visible. Free: the chart scrolls away with the page.",
          ],
        ]}
      />

      <Sub id="ses-5-2">5.2 Event label colours</Sub>
      <ManualTable
        className="max-w-sm"
        head={["", "Layer"]}
        rows={[
          [<ColourCell color={EVENT_LAYER_COLORS.handover} />, "Handover / SRVCC"],
          [<ColourCell color={EVENT_LAYER_COLORS.sip} />, "SIP"],
          [<ColourCell color={EVENT_LAYER_COLORS.nas} />, "NAS"],
          [<ColourCell color={EVENT_LAYER_COLORS.rrc} />, "RRC / RR"],
          [<ColourCell color={EVENT_LAYER_COLORS.other} />, "Other"],
        ]}
      />

      <Sub id="ses-5-3">5.3 Gaps in the curve</Sub>
      <Bullets
        items={[
          <>
            <strong>No measurements</strong>: the phone recorded nothing for more than 5 seconds. The curve is broken there on
            purpose instead of drawing a straight line across the gap.
          </>,
          <>
            <strong>No service</strong> (red outline): the network reported no service during the gap — this is a network finding,
            not just missing data. No-service periods are also shaded light red behind the curve.
          </>,
          <>
            <em>Best</em> scanner lines continue through the gaps: the scanner keeps measuring even when the phone does not.
          </>,
        ]}
      />
    </Section>

    <Section id="ses-6">
      <P>
        These panels appear only for calls that move between LTE and GSM. They start collapsed; the one-line summary shows the
        handover type, its result and the interruption in ms. Click the title to open them.
      </P>
      <ManualTable
        strongFirstCol
        head={["Panel", "Shown when", "What you get when open"]}
        rows={[
          [
            "SRVCC Transition",
            "The call mode is SRVCC (VoLTE call handed over to GSM)",
            "A zoomed LTE → GSM chart with its own toggles (strength, quality, SINR, thresholds, window) and per-leg statistics: average / min / max for each side of the handover, radio gap and power change.",
          ],
          [
            "CSFB Transition",
            "CSFB events are found in the call (even in calls listed as VoLTE or CS)",
            "A card per side, with a tile per phase: redirect → radio fallback → technology change → service → return. Durations come from the CSFB KPIs.",
          ],
        ]}
      />
    </Section>

    <Section id="ses-7">
      <P>
        Shown only for <strong>COSMOTE Free</strong> calls, collapsed by default. Open it to see the GPS route coloured by signal
        strength and a dashed line to the antenna that served the call. The expand button opens a larger map in a pop-up. If no
        GPS was recorded the panel says <strong>Χωρίς GPS</strong> (no GPS).
      </P>
      <ManualTable
        className="max-w-xl"
        head={["Route colour", "LTE (RSRP)", "GSM (RxLev)"]}
        rows={[
          [<ColourCell color={ROUTE_COLORS.good} />, "−115 dBm or better", "−88 dBm or better"],
          [<ColourCell color={ROUTE_COLORS.fair} />, "−115 to −120 dBm", "−88 to −92 dBm"],
          [<ColourCell color={ROUTE_COLORS.bad} />, "worse than −120 dBm", "worse than −92 dBm"],
        ]}
      />
    </Section>

    <Section id="ses-8">
      <Sub id="ses-8-1">8.1 TraceLog</Sub>
      <P>
        Tester log lines around the call: time, side (A/B), SessionId and the message. Useful to spot device or tool problems (for
        example the recording stopping).
      </P>

      <Sub id="ses-8-2">8.2 KPI Results</Sub>
      <P>
        The KPIs the measurement system calculated for this call: time, KPI name, status / code and values. Click a row to see all
        its fields (Value1/2/5, Counter, EndTime, IDs).
      </P>

      <Sub id="ses-8-3">8.3 LTE / GSM Measurements</Sub>
      <P>The phone's radio samples during the call, with the matching scanner values when available.</P>
      <ManualTable
        strongFirstCol
        head={["Mode", "Columns"]}
        rows={[
          ["LTE", "EARFCN · RSRP · RSRQ · MsgTime, plus RSRP Scanner, RSRQ Scanner and Δt(s) when the scanner measured the same cell"],
          ["GSM", "BCCH · Band · RxLevSub · RxQualSub, plus RxLev Scanner, BSIC and Δt(s) when the scanner measured the same cell"],
        ]}
      />
      <Bullets
        items={[
          <>
            <strong>Δt(s)</strong> is the time between the phone sample and the scanner sample it was matched with (up to 10 s). A
            small Δt means the comparison is reliable.
          </>,
          "A big gap between phone and scanner values for the same cell usually points to the phone (antenna, body loss, device) rather than the network.",
          <>
            <strong>LTE ↔ GSM</strong> switch: only shown when the call has both (SRVCC / CSFB). <strong>A-side ↔ B-side</strong>{" "}
            switch: B is greyed out, with a tooltip, when B has no data for this technology.
          </>,
          <>
            GSM warning colours: RxLevSub 90 or more (<span className="text-yellow-400">warning</span>) / 95 or more (
            <span className="text-red-400">red</span>); RxQualSub 5 (<span className="text-yellow-400">warning</span>) / 6 or more (
            <span className="text-red-400">red</span>).
          </>,
        ]}
      />

      <Sub id="ses-8-4">8.4 Συμπεριφορά δικτύου ±Ns (network behaviour before / after)</Sub>
      <P>
        One table of every technology change in the call and in the seconds before and after it, for both phones. Columns:{" "}
        <strong>Πλευρά</strong> (side A/B), <strong>Από</strong> (from), <strong>→ Σε</strong> (to), <strong>Band</strong>,{" "}
        <strong>LTE CA</strong>, <strong>Duration</strong>, <strong>Φάση</strong> (before / during / after). Rows of the other phone
        are shown faded. It follows the ±N window of the chart.
      </P>

      <Sub id="ses-8-5">8.5 L3 Signaling — RRC / NAS / SIP</Sub>
      <ManualTable
        strongFirstCol
        head={["Tool", "What it does"]}
        rows={[
          [
            "Search",
            <>
              <em>Αναζήτηση μηνύματος…</em> — find a message by name.
            </>,
          ],
          ["Φάση (phase)", "Show only messages before, during or after the call."],
          [
            "Σοβαρότητα (severity)",
            <>
              Show only messages of a given severity (<em>όλα</em> = all).
            </>,
          ],
          [
            "Ευρήματα (findings)",
            <>
              Arrows jump to the previous / next DROP, FAIL or ABNORMAL message. <strong>τέλος</strong> jumps to the end of the
              call — usually where a drop is explained.
            </>,
          ],
          ["Timeline strip", "Where each message falls in time; 0s = call start."],
          [
            "Rows",
            "Φάση, Δευτ. (seconds from start), Τεχν. (technology), Layer, Dir (↓ downlink / ↑ uplink), Μήνυμα (message), PCI, ARFCN, SIP, Ειδοπ. (notes). Click a row to see the full raw message.",
          ],
          ["A / B split", "When both phones have signalling, the two sides are shown next to each other."],
        ]}
      />

      <Sub id="ses-8-6">8.6 Scanner & Κινητό (scanner & device)</Sub>
      <P>For each side: device model, IMEI, firmware and device type. Useful when a problem repeats on one phone only.</P>
    </Section>

    <Section id="ses-9">
      <Steps
        items={[
          <>
            In All Sessions, set <strong>Status</strong> to <strong>Drop</strong>. Use <strong>File Group</strong> to stay inside
            one run.
          </>,
          <>
            Click the call. In the header, read the <strong>A / B</strong> outcome and cause code, and the <strong>HO</strong>{" "}
            results.
          </>,
          <>
            On the chart, look at the end of the <strong>Κατά</strong> zone: is the signal falling? Is there a{" "}
            <strong>No service</strong> band? Did the technology lane change just before the drop?
          </>,
          <>
            In <strong>L3 Signaling</strong>, click <strong>τέλος</strong> or the <strong>Ευρήματα</strong> arrows to jump to the
            failure message. Hover it: the chart cursor shows the signal at that moment.
          </>,
          <>
            Compare with the scanner (tick <strong>Best LTE scanner</strong> / <strong>Best GSM scanner</strong>). If the scanner
            also shows weak signal, it is coverage; if the scanner is good but the phone is weak, suspect the device.
          </>,
          <>
            Switch to <strong>B-side</strong> to check the other phone.
          </>,
          <>
            Write a comment (for example <strong>LC LTE</strong>) and save. Use <strong>Next Call</strong> to continue.
          </>,
        ]}
      />
    </Section>

    <Section id="ses-10">
      <ManualTable
        head={["What you see", "What it means / what to do"]}
        rows={[
          [
            <>
              Yellow banner <em>Μερικά API panels απέτυχαν: …</em>
            </>,
            "Some panels failed to load (for example a server timeout). The panels it names are empty because of the error, not because the call had no data. Open another call and come back, or reload the page, to retry.",
          ],
          [
            <>
              <em>Επιλέξτε μια κλήση από τη λίστα…</em> in Call Detail
            </>,
            "No call is selected, or your list filters now hide it. Go back to All Sessions and click a call.",
          ],
          ["Call Detail and Data Detail buttons are grey", "Nothing is selected yet. Click a row in the list first."],
          ["B-side button is grey", "The B phone has no data for this call or technology."],
          [
            <>
              <strong>No measurements</strong> band on the chart
            </>,
            "The phone recorded nothing for more than 5 s. Check TraceLog for tool problems.",
          ],
          ["Prev / Next shows a message instead of opening", "The neighbouring call is hidden by your list filters. Relax the filters."],
          ["No map panel", "The map exists only for COSMOTE Free calls."],
          [
            "Data sessions list is empty but calls load",
            "The data sessions failed to load or none match the Location / File Group filter.",
          ],
        ]}
      />
    </Section>
  </div>
);

// ─── Tab ──────────────────────────────────────────────────────────────────────────

const GUIDE_META: Record<GuideId, { label: string; sections: TocEntry[] }> = {
  summary: { label: "Summary Tab", sections: SUMMARY_SECTIONS },
  sessions: { label: "All Sessions & Call Detail", sections: SESSIONS_SECTIONS },
};

const UserManualTab = () => {
  const [guide, setGuide] = useUrlStringState<GuideId>("guide", "summary", {
    storageKey: "user-manual-guide",
    allowed: GUIDE_IDS,
  });
  const sections = GUIDE_META[guide].sections;
  const [activeId, setActiveId] = useState(sections[0].id);

  // Scroll-spy: η ενότητα που βρίσκεται στο πάνω μέρος της οθόνης (κάτω από το sticky header)
  // φωτίζεται στον πίνακα περιεχομένων.
  useEffect(() => {
    setActiveId(sections[0].id);
    if (typeof IntersectionObserver === "undefined") return;
    const headerHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--app-header-height"), 10) || 57;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = sections.find((section) => visible.has(section.id));
        if (first) setActiveId(first.id);
      },
      { rootMargin: `-${headerHeight + 16}px 0px -60% 0px` },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  const openGuide = (next: GuideId) => {
    setGuide(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toc = (
    <nav aria-label="Contents" className="space-y-0.5">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          onClick={(event) => {
            event.preventDefault();
            scrollToSection(section.id);
          }}
          className={cn(
            "block rounded-md border-l-2 px-3 py-1.5 text-xs transition-colors",
            activeId === section.id
              ? "border-primary bg-primary/10 font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {section.title}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="space-y-4">
      <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-border bg-muted p-1 sm:flex sm:w-fit">
        {GUIDE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => openGuide(id)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors sm:px-3",
              guide === id ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{GUIDE_META[id].label}</span>
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky max-h-[calc(100vh-8rem)] overflow-y-auto" style={STICKY_TOP}>
            <p className="mb-2 flex items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <ListOrdered className="h-3.5 w-3.5" /> Contents
            </p>
            {toc}
          </div>
        </aside>

        <div className="min-w-0 max-w-4xl space-y-6">
          <details className="rounded-lg border border-border bg-card lg:hidden">
            <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-semibold text-foreground">
              <ListOrdered className="h-3.5 w-3.5 text-primary" /> Contents
            </summary>
            <div className="border-t border-border p-2">{toc}</div>
          </details>

          {guide === "summary" ? <SummaryGuide /> : <SessionsGuide onOpenGuide={openGuide} />}
        </div>
      </div>
    </div>
  );
};

export default UserManualTab;
