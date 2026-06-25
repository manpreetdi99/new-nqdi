import pyodbc
import urllib.parse
from sqlalchemy import create_engine, text 
import pandas as pd

# def setup_database(database_name):
#     connection_string = (
#          f"DRIVER={{SQL Server Native Client 11.0}};"
#         f"SERVER=swissqual-srvsa;"
#         f"DATABASE={database_name};"
#         f"UID=sa;"
#         f"PWD=test123@"
#     )
#     connection = pyodbc.connect(connection_string)
#     cursor = connection.cursor()
#     return connection, cursor


from sqlalchemy import create_engine

def make_engine(database_name: str):
    raw = (
        "DRIVER={SQL Server Native Client 11.0};"
        "SERVER=swissqual-srvsa;"
        f"DATABASE={database_name};"
        "UID=sa;PWD=test123@;"
        "Encrypt=No;TrustServerCertificate=Yes;"
    )
    odbc_str = urllib.parse.quote_plus(raw)
    # SQLAlchemy 2.0+ engine
    return create_engine(
        f"mssql+pyodbc:///?odbc_connect={odbc_str}",
        pool_pre_ping=True,
        future=True,
    )


# conn, cur = setup_database("IPI_2025H2")#ONOMA DATABASE


