import os
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from sqlalchemy import create_engine, text
import urllib.parse
import time

# Local modules
import main_mt as main
import gpx   

SERVER = "swissqual-srvsa"
UID = "sa"
PWD = "test123@"
ODBC_DRIVER = "SQL Server Native Client 11.0"

def odbc_connect_str(database: str) -> str:
    raw = (
        f"DRIVER={{{ODBC_DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={database};"
        f"UID={UID};"
        f"PWD={PWD};"
        f"TrustServerCertificate=Yes;Encrypt=No;Application Intent=ReadWrite;MultipleActiveResultSets=Yes;"
    )
    return urllib.parse.quote_plus(raw)

def make_engine(database: str):
    return create_engine(
        f"mssql+pyodbc:///?odbc_connect={odbc_connect_str(database)}",
        pool_pre_ping=True,
        future=True
    )

def list_databases() -> list:
    try:
        engine = make_engine("master")
        query = text("SELECT name FROM sys.databases WHERE name NOT IN ('master','model','msdb','tempdb') ORDER BY name")
        with engine.connect() as conn:
            rows = conn.execute(query).all()
        return [r[0] for r in rows]
    except Exception:
        return []

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("VALIDATION SWISSQUAL - AutoMode (MT)")
        self.geometry("900x800")
        self.configure(bg="#f5f5f5")

        self.current_db = None
        self.engine = None
        self.last_html_path = None

        self.gpx_var = tk.StringVar()
        self.ignore_gpx_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="Ready.")
        self.value_var = tk.StringVar()
        self.max_workers_var = tk.IntVar(value=6)

        self._setup_ui()
        self.refresh_databases()

    def _setup_ui(self):
        # Header
        header = ttk.Frame(self)
        header.pack(fill="x", padx=20, pady=15)
        ttk.Label(header, text="VALIDATION SWISSQUAL", font=("Segoe UI", 22, "bold")).pack(side="left")
        
        main_frame = ttk.Frame(self)
        main_frame.pack(fill="both", expand=True, padx=20, pady=10)

        # --- DATABASE SECTION ---
        db_frame = ttk.LabelFrame(main_frame, text=" 1. Database Select (Auto-Connect) ", padding=10)
        db_frame.pack(fill="x", pady=5)
        
        ttk.Label(db_frame, text="Select Database:").pack(side="left", padx=5)
        self.db_combo = ttk.Combobox(db_frame, state="readonly", width=45)
        self.db_combo.pack(side="left", padx=5)
        # Bind το event της επιλογής
        self.db_combo.bind("<<ComboboxSelected>>", self.on_db_selected)

        # --- SELECTION SECTION ---
        pick_frame = ttk.LabelFrame(main_frame, text=" 2. Collection & GPX ", padding=10)
        pick_frame.pack(fill="x", pady=10)
        
        row1 = ttk.Frame(pick_frame)
        row1.pack(fill="x", pady=5)
        ttk.Label(row1, text="Collection:", width=12).pack(side="left")
        self.value_combo = ttk.Combobox(row1, textvariable=self.value_var, state="readonly", width=60)
        self.value_combo.pack(side="left", padx=5)
        self.value_combo.bind("<<ComboboxSelected>>", lambda e: self.suggest_gpx_for_collection(silent=True))
        
        ttk.Separator(pick_frame, orient="horizontal").pack(fill="x", pady=10)
        
        row2 = ttk.Frame(pick_frame)
        row2.pack(fill="x")
        ttk.Checkbutton(row2, text="Bypass GPX (SQL Points Only)", variable=self.ignore_gpx_var).pack(side="left")
        
        row3 = ttk.Frame(pick_frame)
        row3.pack(fill="x", pady=5)
        ttk.Label(row3, text="GPX File:", width=12).pack(side="left")
        self.gpx_combo = ttk.Combobox(row3, textvariable=self.gpx_var, width=65)
        self.gpx_combo.pack(side="left", padx=5, fill="x", expand=True)
        ttk.Button(row3, text="Browse", command=self.browse_gpx).pack(side="left")

                # --- PERFORMANCE (MT) ---
        # perf_frame = ttk.LabelFrame(main_frame, text=" 3. Performance ", padding=10)
        # perf_frame.pack(fill="x", pady=5)
        # ttk.Label(perf_frame, text="Threads (max_workers):").pack(side="left", padx=5)
        # self.workers_spin = ttk.Spinbox(perf_frame, from_=1, to=32, width=6, textvariable=self.max_workers_var)
        # self.workers_spin.pack(side="left", padx=5)
        # ttk.Label(perf_frame, text="Tip: 6–10 is usually good.").pack(side="left", padx=10)

# --- ACTION BUTTONS ---
        act_frame = ttk.Frame(main_frame)
        act_frame.pack(fill="x", pady=10)
        
        self.run_btn = ttk.Button(act_frame, text="▶ RUN MAP GENERATOR", width=30, command=self.run_script_for_selection)
        self.run_btn.pack(side="left", ipady=5)
        
        ttk.Button(act_frame, text="📂 Open last output", command=self.open_last_map).pack(side="left", padx=10)
        
        self.progress = ttk.Progressbar(main_frame, mode="indeterminate")
        self.progress.pack(fill="x", pady=5)

        # --- TERMINAL ---
        ttk.Label(main_frame, text="System Log", font=("Consolas", 10, "bold")).pack(anchor="w", pady=(10, 0))
        t_frame = ttk.Frame(main_frame)
        t_frame.pack(fill="both", expand=True)
        
        self.terminal = tk.Text(t_frame, bg="#1e1e1e", fg="#d4d4d4", font=("Consolas", 10), state="disabled")
        scroll = ttk.Scrollbar(t_frame, command=self.terminal.yview)
        self.terminal.configure(yscrollcommand=scroll.set)
        self.terminal.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        self.terminal.tag_config("error", foreground="#ff6b6b")
        self.terminal.tag_config("success", foreground="#51cf66")
        self.terminal.tag_config("info", foreground="#5c7cfa")
        self.terminal.tag_config("timestamp", foreground="#868e96")

    def log(self, message, level="info"):
        ts = time.strftime("[%H:%M:%S]")
        self.terminal.configure(state="normal")
        self.terminal.insert(tk.END, f"{ts} ", "timestamp")
        icon = "✔" if level == "success" else "✖" if level == "error" else "ℹ"
        self.terminal.insert(tk.END, f"{icon} {message}\n", level)
        self.terminal.configure(state="disabled")
        self.terminal.see(tk.END)

    # --- AUTO-LOGIC ---

    def on_db_selected(self, event=None):
        """Εκτελείται αυτόματα όταν ο χρήστης επιλέξει βάση."""
        db = self.db_combo.get()
        if not db: return
        
        # 1. Σύνδεση
        try:
            self.engine = make_engine(db)
            self.current_db = db
            self.log(f"Auto-connected to: {db}", "success")
            self.status_var.set(f"Active DB: {db}")
            
            # 2. Αυτόματο τράβηγμα Collections
            self.auto_fetch_collections()
        except Exception as e:
            self.log(f"Auto-connect failed: {e}", "error")

    def auto_fetch_collections(self):
        """Τραβάει τα CollectionNames αμέσως μετά τη σύνδεση."""
        if not self.engine: return
        try:
            with self.engine.connect() as conn:
                res = conn.execute(text("SELECT DISTINCT (CollectionName) FROM [FileList] WHERE CollectionName IS NOT NULL"))
                values = [r[0] for r in res.fetchall()]
            
            self.value_combo["values"] = values
            if values:
                self.value_combo.current(0)
                self.log(f"Auto-loaded {len(values)} collections.", "info")
                # Trigger και το GPX suggestion για το πρώτο item
                self.suggest_gpx_for_collection(silent=True)
            else:
                self.value_combo.set("")
                self.log("No collections found in [FileList].", "error")
        except Exception as e:
            self.log(f"Query Error: {e}", "error")

    def run_script_for_selection(self):
        if not self.current_db:
            self.log("Aborted: Select a database first.", "error")
            return
        
        coll = self.value_var.get().strip()
        if not coll: return

        gpx_p = "" if self.ignore_gpx_var.get() else self.gpx_var.get().strip()
        
        # self.run_btn.config(state="disabled")
        # self.progress.start(10)
        max_workers = 6  # Μπορεί να γίνει και δυναμικό από το UI αν θέλουμε
        self.log(f"Processing {coll}... (threads={max_workers})")
        
        threading.Thread(target=self._run_map_worker, args=(coll, gpx_p, max_workers), daemon=True).start()

    def _run_map_worker(self, collection, gpx_path, max_workers):
        start = time.time()
        try:
            html = main.run_for_collection(collection, database=self.current_db, input_gpx=gpx_path, max_workers=max_workers)
            self.last_html_path = html
            self.log(f"Done! Map created in {time.time()-start:.2f}s", "success")
            os.startfile(html)
        except Exception as e:
            self.log(f"Error: {str(e)}", "error")
        finally:
            self.progress.stop()
            self.run_btn.config(state="normal")

    def suggest_gpx_for_collection(self, silent=False):
        coll = self.value_var.get()
        if not coll: return
        try:
            res = gpx.handler(search_value=coll)
            if res:
                self.gpx_combo["values"] = res
                self.gpx_var.set(res[0])
                if not silent: self.log(f"GPX auto-matched.", "info")
        except:
            pass

    def browse_gpx(self):
        p = filedialog.askopenfilename(filetypes=[("GPX files", "*.gpx")])
        if p: self.gpx_var.set(p)

    def open_last_map(self):
        path = self.last_html_path if self.last_html_path else r"\\192.168.10.182\Public\#SERVICE DIVISION PROJECT FOLDER\COSMOTE 2026 H1\OUTPUT_MAPS\output.html"
        if os.path.exists(path):
            os.startfile(path)
        else:
            messagebox.showerror("Error", "File not found.")

    def refresh_databases(self):
        dbs = list_databases()
        if dbs:
            self.db_combo["values"] = dbs
            self.log(f"System ready. {len(dbs)} databases available.", "info")

if __name__ == "__main__":
    app = App()
    app.mainloop()