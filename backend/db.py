import os
import pyodbc
from dotenv import load_dotenv

load_dotenv()

SERVER = os.getenv("DB_HOST", "swissqual-srvsa")
USER = os.getenv("DB_USER", "sa")
PASSWORD = os.getenv("DB_PASS", "test123@")
DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")
DB_PORT = os.getenv("DB_PORT", "1433")


def get_connection(database_name: str):
    return pyodbc.connect(
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER},{DB_PORT};"
        f"DATABASE={database_name};"
        f"UID={USER};"
        f"PWD={PASSWORD};"
        "TrustServerCertificate=yes;",
        timeout=5
    )


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