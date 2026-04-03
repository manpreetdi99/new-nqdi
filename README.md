# Performance Insights / FASMETRICS Analytics

A full-stack benchmarking dashboard for **SQL Server query execution** and **network call analytics visualization**.

The project has two main parts:

- **Frontend**: React + TypeScript + Vite + shadcn/ui + Tailwind
- **Backend**: FastAPI(python) + pyodbc for SQL Server access

It allows a user to:

- connect to a SQL Server instance,
- load available databases,
- run one or more SQL queries as a benchmark batch,
- measure execution time and row counts,
- render returned data in tables and charts,
- browse a separate mock telecom call analytics UI with filters, call details, and a Greece map.

---

## 0. Quick Start: Πώς να τρέξετε την εφαρμογή (Local vs LAN)

### Α. Για 1 Χρήστη Τοπικά (Στον ίδιο υπολογιστή - Single Local User)
Ιδανικό για ανάπτυξη (development). Το frontend και το backend βρίσκονται στο ίδιο PC.

1. **Backend (Python):** Στο τερματικό τρέξτε τον server για τοπικό reload.
   ```bash
   cd backend
   uvicorn app:app --reload --port 8000
   ```
2. **Frontend (React):** Βεβαιωθείτε ότι στο αρχείο `src/lib/api.ts` το URL του API είναι: `const API_BASE_URL = "http://localhost:8000";`
   ```bash
   npm run dev
   ```
3. Ανοίξτε το `http://localhost:5173` στον browser σας.
*(Για προεπισκόπηση μέσω **Lovable**, κάντε public Port Forwarding της θύρας 8000 μέσω VS Code και αλλάξτε το `API_BASE_URL` σε αυτό).*

### Β. Για Πολλαπλούς Χρήστες & Κινητά (Στο ίδιο WiFi - Multi Local User)
Ιδανικό για testing από άλλα κινητά ή PC του σπιτιού/γραφείου σας, χωρίς να περνάτε από cloud tunnels που καθυστερούν την εφαρμογή.

1. **Βρείτε την τοπική TCP/IPv4 IP σας:** Ανοίξτε το τερματικό και πληκτρολογήστε `ipconfig` (π.χ. `192.168.x.x`).
2. **Backend (Python):** Τρέξτε τον server, ώστε να ακούει σε όλες τις διευθύνσεις (`0.0.0.0`) και να δέχεται πολλαπλά αιτήματα ταυτόχρονα με 4 workers (ταχύτητα).
   ```bash
   cd backend
   uvicorn app:app --host 0.0.0.0 --port 8000 --workers 4
   ```
3. **Frontend (React):** Αλλάξτε το αρχείο `src/lib/api.ts` ώστε το URL να δείχνει στην IPv4 του υπολογιστή σας:
   `const API_BASE_URL = "http://192.168.x.x:8000";`
   
   Στη συνέχεια, "ανοίξτε" το Vite στο δίκτυο με την εντολή:
   ```bash
   npm run dev -- --host
   ```
4. Πάρτε τα κινητά και **ανοίξτε τον browser**: `http://192.168.x.x:5173`. Θα δείτε την εφαρμογή να φορτώνει και να παίζει απρόσκοπτα από το τοπικό δίκτυο (LAN)!

---

## 1. High-level architecture

```text
Frontend (React / Vite)
    |
    | HTTP fetch
    v
FastAPI backend (localhost:8000)
    |
    | pyodbc
    v
SQL Server
```

### Request flow

1. The frontend loads.
2. `src/pages/Index.tsx` calls `fetchDatabases()` from `src/lib/api.ts`.
3. The frontend sends `GET /api/databases` to the FastAPI backend.
4. The backend uses `backend/db.py` to connect to SQL Server and read online databases.
5. When the user runs queries, the frontend sends `POST /api/benchmark` with:
   - selected database name
   - array of SQL queries
6. The backend executes each query in sequence and returns structured results.
7. The frontend renders:
   - summary cards
   - charts
   - result tables

---

## 2. Project structure

```text
performance-insights - Copy (2)/
├── backend/
│   ├── app.py              # FastAPI app and API routes
│   ├── db.py               # SQL Server connection helpers
│   ├── requirements.txt    # Python dependencies
│   └── .env                # Backend environment variables
├── src/
│   ├── components/         # UI building blocks
│   ├── hooks/              # UI hooks (toasts etc.)
│   ├── lib/                # API client, sample/mock data helpers
│   ├── pages/
│   │   └── Index.tsx       # Main dashboard page
│   ├── types/
│   │   └── benchmark.ts    # Benchmark result typings
│   ├── App.tsx             # App root with router/providers
│   └── main.tsx            # React entry point
├── supabase/
│   └── config.toml         # Supabase config (currently not core to SQL flow)
├── package.json            # Frontend dependencies and scripts
├── vite.config.ts          # Vite config
└── README.md
```

---

## 3. Tech stack

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Recharts
- React Router
- TanStack React Query
- Lucide React icons

### Backend

- FastAPI
- Pydantic
- pyodbc
- python-dotenv
- SQL Server via ODBC Driver 17

---

## 4. How to run the project

## 4.1 Backend setup

Go to the backend folder:

```bash
cd backend
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the API server:

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

The backend will be available at:

```text
http://localhost:8000
```

---

## 4.2 Frontend setup

From the project root:

```bash
npm install
npm run dev
```

The frontend will usually start on:

```text
http://localhost:5173
```

---

## 4.3 Important note about Lovable/web preview

The frontend API client is hardcoded to:

```ts
const API_BASE_URL = "http://localhost:8000";
```

This means:

- it works when the frontend is running **on your own machine**, and
- the FastAPI backend is also running **on your own machine**.

It may **not** work inside remote previews such as Lovable preview, because the preview environment cannot automatically access `localhost` on your computer.

That case is already handled in `src/lib/api.ts` with error code:

- `NET-001` = preview cannot reach the local Python server.

---

## 5. Environment variables

## 5.1 Backend `.env`

The backend expects these variables:

```env
DB_HOST=swissqual-srvsa
DB_USER=sa
DB_PASS=your_password
DB_DRIVER=ODBC Driver 17 for SQL Server
DB_PORT=1433
```

### What each one does

- `DB_HOST`: SQL Server hostname or IP
- `DB_USER`: SQL Server login
- `DB_PASS`: SQL Server password
- `DB_DRIVER`: ODBC driver installed on the machine
- `DB_PORT`: SQL Server TCP port, usually `1433`

### Important security note

Do **not** commit real credentials to git. Use example values only, and keep production credentials outside version control.

---

## 5.2 Frontend `.env`

The root `.env` contains Supabase-related values:

```env
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_URL=...
```

In the current SQL benchmarking flow, these values are **not the main data source**. The benchmark data path uses the FastAPI backend and SQL Server.

---

## 6. Backend code explanation

## 6.1 `backend/db.py`

This file is responsible for database connectivity.

### Main responsibilities

- load environment variables with `load_dotenv()`
- create a SQL Server connection with `pyodbc.connect(...)`
- fetch the list of online databases from `sys.databases`

### Core code responsibilities

#### `get_connection(database_name: str)`

Creates a connection string like:

```text
DRIVER={ODBC Driver 17 for SQL Server};
SERVER=host,port;
DATABASE=database_name;
UID=user;
PWD=password;
TrustServerCertificate=yes;
```

Returns an active `pyodbc` connection.

#### `get_available_databases()`

1. Connects to the `master` database.
2. Runs:

```sql
SELECT name
FROM sys.databases
WHERE state_desc = 'ONLINE'
ORDER BY name
```

3. Returns a Python list of database names.

### Why `master` is used

SQL Server stores server-wide database metadata inside `master`, so that is the correct place to query the available databases.

---

## 6.2 `backend/app.py`

This file exposes the REST API.

### Main responsibilities

- initialize the FastAPI app
- enable CORS
- define request models
- expose endpoints used by the React frontend

### CORS setup

```py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

This allows the browser frontend to call the backend from another origin, such as `localhost:5173`.

For production, this should be restricted to specific frontend domains.

---

## 7. API documentation

## 7.1 `GET /api/databases`

### Purpose

Returns the list of available SQL Server databases.

### Backend function

```py
@app.get("/api/databases")
def list_databases():
```

### Internal flow

- calls `get_available_databases()` from `db.py`
- catches exceptions
- returns JSON response

### Success response

```json
{
  "databases": ["master", "tempdb", "MyDatabase"]
}
```

### Error response

```json
{
  "detail": "<error message>"
}
```

### Used by frontend in

- `src/pages/Index.tsx` inside `useEffect(...)`
- through `fetchDatabases()` from `src/lib/api.ts`

---

## 7.2 `POST /api/benchmark`

### Purpose

Executes a list of SQL queries against the selected database and returns benchmark-style results.

### Request model

Defined with Pydantic:

```py
class QueryRequest(BaseModel):
    database: str
    queries: list[str]
```

### Example request body

```json
{
  "database": "MyDatabase",
  "queries": [
    "SELECT TOP 100 * FROM CallTable ORDER BY StartTime DESC",
    "SELECT Operator, COUNT(*) AS TotalCalls FROM CallTable GROUP BY Operator"
  ]
}
```

### Internal execution flow

For each query:

1. connect to the selected database
2. run `cursor.execute(query)`
3. inspect `cursor.description` to get column names
4. fetch rows with `cursor.fetchall()`
5. transform each row into a JSON-serializable dictionary
6. measure execution time in milliseconds
7. add the result to a `results` array

### Success response shape

```json
{
  "results": [
    {
      "id": "result-0",
      "queryLabel": "Query 1",
      "executionTime": 14,
      "rowsReturned": 100,
      "columns": ["Operator", "Technology"],
      "data": [
        {
          "Operator": "COSMOTE",
          "Technology": "5G"
        }
      ]
    }
  ],
  "totalTime": 27
}
```

### Field meanings

- `id`: frontend-friendly unique identifier per query result
- `queryLabel`: label such as `Query 1`, `Query 2`
- `executionTime`: execution time for that query in milliseconds
- `rowsReturned`: number of rows returned
- `columns`: ordered list of column names
- `data`: array of row objects
- `totalTime`: total batch execution time for all queries

### Error behavior

Any exception is converted into:

```json
{
  "detail": "<error message>"
}
```

with HTTP status `500`.

### Used by frontend in

- `handleRunQueries(...)` in `src/pages/Index.tsx`
- through `runBenchmarkApi(...)` in `src/lib/api.ts`

---

## 8. Frontend code explanation

## 8.1 `src/App.tsx`

This is the React root application wrapper.

### Responsibilities

- creates a `QueryClient` for React Query
- wraps the app with providers
- sets up routes

### Routes

- `/` → `Index`
- `*` → `NotFound`

Even though React Query is configured, the current benchmark calls are done manually with `fetch`, not through React Query hooks.

---

## 8.2 `src/pages/Index.tsx`

This is the main dashboard and the most important frontend file.

### Main responsibilities

- fetch database names on load
- store selected database
- run SQL benchmark requests
- display benchmark charts, tables, and summary cards
- manage the extra telecom call analytics tabs

### Key state values

- `databases`: list loaded from backend
- `selectedDatabase`: current database chosen in the `<select>`
- `results`: benchmark results returned from backend
- `isRunning`: loading state while benchmark is executing
- `totalTime`: total execution time from backend
- `selectedCall`: currently selected telecom call record
- `activeTab`: current UI tab
- `filters`: call filters for the mock call analytics data

### Benchmark flow in `Index.tsx`

#### On page load

```ts
useEffect(() => {
  const dbs = await fetchDatabases();
  setDatabases(dbs);
  if (dbs.length > 0) setSelectedDatabase(dbs[0]);
}, []);
```

This loads the available SQL Server databases and auto-selects the first one.

#### When the user clicks “Run Benchmark”

`handleRunQueries(queries)`:

1. checks that a database is selected
2. sets loading state
3. clears old results
4. calls `runBenchmarkApi(selectedDatabase, queries)`
5. stores new results and total time
6. shows success or error toast

---

## 8.3 `src/lib/api.ts`

This is the frontend API client layer.

### Purpose

Encapsulates all HTTP communication with FastAPI.

### Main parts

#### `API_BASE_URL`

```ts
const API_BASE_URL = "http://localhost:8000";
```

All requests are built from this base URL.

#### `ApiClientError`

A custom error class that carries:

- `code`
- `status`
- `endpoint`
- `hint`
- `message`

This is helpful because the UI can show meaningful toasts instead of generic browser fetch errors.

#### `requestJson<T>()`

Generic helper that:

- performs `fetch`
- checks `res.ok`
- tries to parse backend errors as JSON
- falls back to text when needed
- converts network failures into `ApiClientError`

#### `fetchDatabases()`

Calls:

```text
GET /api/databases
```

and returns `string[]`.

#### `runBenchmarkApi(database, queries)`

Calls:

```text
POST /api/benchmark
```

with JSON body:

```json
{
  "database": "...",
  "queries": ["..."]
}
```

---

## 8.4 `src/components/QueryEditor.tsx`

This component is the SQL input area.

### Supported modes

- **SQL mode**: user writes raw SQL manually
- **Builder mode**: user assembles a query using selectable fields and table names

### Internal behavior

#### SQL mode

Stores an array of raw SQL strings in:

```ts
const [queries, setQueries] = useState<string[]>([SAMPLE_QUERIES[0]]);
```

The user can:

- add more queries
- remove queries
- edit each SQL statement
- run all queries in one batch

#### Builder mode

Stores structured query pieces in:

```ts
interface BuilderQuery {
  selectFields: string[];
  fromTable: string;
  whereClause: string;
  groupByClause: string;
}
```

These are combined by `buildQueryString(...)` into a SQL statement.

### Important note

The builder uses predefined sample fields/tables like:

- `CallTable`
- `EventTable`
- `MeasurementTable`
- `CellInfo`
- `SignalSamples`

These appear to be UI assumptions/templates, not dynamically loaded database schema.

That means the builder is useful for demoing or for a known schema, but it is not yet a true schema-aware query builder.

---

## 8.5 `src/components/StatsCards.tsx`

Displays summary benchmark metrics.

### Inputs

- `results`
- `totalTime`

### Derived metrics

- total batch time
- average execution time
- total rows returned
- number of queries executed

This is a pure presentation component.

---

## 8.6 `src/components/BenchmarkCharts.tsx`

Renders charts from SQL results using Recharts.

### How chart selection works

For each query result:

1. it identifies numeric columns,
2. it picks one string column as the category axis,
3. it chooses chart type automatically:
   - `radar` if at least 3 numeric columns exist,
   - `area` if many rows exist,
   - otherwise `bar`

### Important behavior

This means the returned SQL shape strongly affects chart rendering.

Best chart-friendly queries are aggregation queries such as:

```sql
SELECT Operator, AVG(DL_Throughput) AS AvgDL
FROM CallTable
GROUP BY Operator
```

Flat `SELECT *` queries may render less meaningfully in charts.

---

## 8.7 `src/components/ResultsTable.tsx`

Displays raw result rows in tabular form.

### Responsibilities

- show returned columns as headers
- render each row from `data`
- format numeric values with Greek locale formatting
- show query execution summary above each table

This is the main component for inspecting raw SQL output.

---

## 8.8 Call analytics components

The project also contains a second feature area that uses generated/mock telecom call data rather than backend SQL data.

These include:

- `CallsList.tsx`
- `CallDetail.tsx`
- `CallsFilter.tsx`
- `CallsSummary.tsx`
- `CallsMap.tsx`
- `src/lib/callData.ts`

### What they do

- generate synthetic call records,
- filter calls by operator, status, technology, region, and call type,
- display per-call detail,
- summarize call KPIs,
- show a Greece SVG map with city bubbles.

### Important distinction

This area is currently **UI/demo data driven**, not connected to the FastAPI SQL backend.

So the project really has **two parallel experiences**:

1. **real backend-driven SQL benchmarking**, and
2. **frontend-only telecom analytics demo UI**.

---

## 9. Data models

## 9.1 Frontend benchmark type

Defined in `src/types/benchmark.ts`:

```ts
export type CellValue = string | number | boolean | null;

export interface BenchmarkResult {
  id: string;
  queryLabel: string;
  executionTime: number;
  rowsReturned: number;
  columns: string[];
  data: Record<string, CellValue>[];
}
```

This matches the JSON returned by `POST /api/benchmark`.

---

## 10. Example API usage

## 10.1 Load databases

```bash
curl http://localhost:8000/api/databases
```

## 10.2 Run benchmark queries

```bash
curl -X POST http://localhost:8000/api/benchmark \
  -H "Content-Type: application/json" \
  -d '{
    "database": "MyDatabase",
    "queries": [
      "SELECT TOP 10 * FROM CallTable",
      "SELECT Operator, COUNT(*) AS TotalCalls FROM CallTable GROUP BY Operator"
    ]
  }'
```

---

## 11. Known limitations

### 1. `localhost` API base URL

The frontend is tied to `http://localhost:8000`.

This is fine for local development, but not ideal for deployment or remote preview.

A better approach would be:

```env
VITE_API_BASE_URL=http://localhost:8000
```

and then read it from `import.meta.env`.

### 2. SQL execution is fully raw

The backend executes whatever SQL the frontend sends.

This is flexible, but risky in production.

There is currently no:

- query validation
- allowlist of statements
- timeout customization per query
- pagination for large result sets
- row limit enforcement
- protection against destructive SQL

### 3. Query builder is schema-static

The builder uses hardcoded table and field names instead of live schema introspection.

### 4. Large result sets may be heavy

`fetchall()` loads all returned rows into memory. Large queries may become slow or memory intensive.

### 5. CORS is open

`allow_origins=["*"]` is useful during development, but should be restricted in production.

---

## 12. Suggested improvements

### Backend improvements

- add `/health` endpoint
- add SQL query timeout controls
- block `INSERT`, `UPDATE`, `DELETE`, `DROP` when running in read-only mode
- support pagination / row limits
- use connection pooling if needed
- add logging for query text and execution duration
- return structured error codes

### Frontend improvements

- move API base URL to env
- add database/schema/table discovery endpoints
- make builder dynamic from real schema metadata
- persist last selected database and queries
- add export to CSV/Excel
- add syntax highlighting SQL editor

### Security improvements

- never store real DB credentials in repo
- restrict CORS origins
- use read-only SQL credentials where possible
- validate query types before execution

---

## 13. Main code map by responsibility

### Backend

- `backend/app.py` → REST API routes and request handling
- `backend/db.py` → SQL Server connection and database listing

### Frontend core

- `src/App.tsx` → app shell and routing
- `src/pages/Index.tsx` → main page, state, API orchestration
- `src/lib/api.ts` → HTTP client layer
- `src/types/benchmark.ts` → benchmark result typings

### Frontend benchmark UI

- `src/components/QueryEditor.tsx` → input and builder for queries
- `src/components/StatsCards.tsx` → benchmark summary cards
- `src/components/BenchmarkCharts.tsx` → chart rendering
- `src/components/ResultsTable.tsx` → raw query output tables

### Frontend telecom demo UI

- `src/lib/callData.ts` → generated sample call records
- `src/components/CallsFilter.tsx` → call filters
- `src/components/CallsSummary.tsx` → aggregated call KPIs
- `src/components/CallsList.tsx` → call list
- `src/components/CallDetail.tsx` → selected call view
- `src/components/CallsMap.tsx` → Greece map with regional call breakdown

---

## 14. In one sentence

This project is a **SQL Server benchmarking dashboard with a FastAPI backend and React frontend**, plus a **separate telecom analytics demo layer** built with mock call data for richer UI exploration.

