import os
import pyodbc
from dotenv import load_dotenv

load_dotenv()

SERVER = os.getenv("DB_SERVER")
USER = os.getenv("DB_USER")
PASSWORD = os.getenv("DB_PASS")
DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")
DB_PREFIX = os.getenv("DB_PREFIX", "NMS_")

def get_connection(database_name: str):
    return pyodbc.connect(
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={database_name};"
        f"UID={USER};"
        f"PWD={PASSWORD};"
        "TrustServerCertificate=yes;"
    )

def get_available_databases():
    conn = get_connection("master")
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name
        FROM sys.databases
        WHERE state_desc = 'ONLINE'
          AND name LIKE ?
        ORDER BY name
    """, f"{DB_PREFIX}%")
    rows = cursor.fetchall()
    conn.close()
    return [row[0] for row in rows]