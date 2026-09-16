import os
import time

import pyodbc
from dotenv import load_dotenv

load_dotenv()

SERVER = os.getenv("DB_HOST", "swissqual-srvsa")
USER = os.getenv("DB_USER", "sa")
PASSWORD = os.getenv("DB_PASS", "test123@")
DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")
DB_PORT = os.getenv("DB_PORT", "1433")

# Πόσο περιμένουμε να ΑΝΟΙΞΕΙ η σύνδεση (SQL_ATTR_LOGIN_TIMEOUT) — ΔΕΝ είναι όριο για το
# query. Ήταν 5s: όταν το Summary tab ανοίγει 11 συνδέσεις μαζί πάνω σε όλα τα collections
# μιας βάσης, ο SQL Server αργεί να απαντήσει στο login και έσκαγε "Login timeout expired"
# πριν καν ξεκινήσει το query — το πιο συχνό "έκανε timeout" του UI.
LOGIN_TIMEOUT = int(os.getenv("DB_LOGIN_TIMEOUT", "60"))

# Όριο για το ίδιο το query (SQL_ATTR_QUERY_TIMEOUT). 0 = χωρίς όριο, που είναι και το
# default του pyodbc — το θέτουμε ρητά ώστε να μην το κληρώνουμε από driver/DSN ρυθμίσεις.
QUERY_TIMEOUT = int(os.getenv("DB_QUERY_TIMEOUT", "0"))

# Πόσες φορές ξαναδοκιμάζουμε ΜΟΝΟ το login (όχι το query — αυτό δεν είναι ασφαλές να
# επαναληφθεί τυφλά). Τα login timeouts κάτω από φορτίο είναι transient.
CONNECT_RETRIES = int(os.getenv("DB_CONNECT_RETRIES", "2"))


def get_connection(database_name: str):
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER},{DB_PORT};"
        f"DATABASE={database_name};"
        f"UID={USER};"
        f"PWD={PASSWORD};"
        "TrustServerCertificate=yes;"
    )

    last_error: Exception | None = None

    for attempt in range(CONNECT_RETRIES + 1):
        try:
            conn = pyodbc.connect(conn_str, timeout=LOGIN_TIMEOUT)
            conn.timeout = QUERY_TIMEOUT
            return conn
        except pyodbc.Error as exc:
            last_error = exc
            if attempt == CONNECT_RETRIES:
                break
            # 1s, 2s — αρκετό για να αδειάσει το login backlog του server.
            time.sleep(2 ** attempt)

    raise last_error


def get_available_databases():
    conn = get_connection("master")
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name
        FROM sys.databases
        WHERE state_desc = 'ONLINE'
        ORDER BY name
    """)
    rows = cursor.fetchall()
    conn.close()
    return [row[0] for row in rows]


if __name__ == "__main__":
    print(get_available_databases())
