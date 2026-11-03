"""Κοινή πρόσβαση στη βάση χρηστών (USERS_DB): σύνδεση + schema (AppUsers, AppSessions).

Η βάση πρέπει να υπάρχει· οι πίνακες δημιουργούνται/αναβαθμίζονται μία φορά ανά process.
"""
import os
import threading

from db import get_connection

USERS_DB = os.getenv("USERS_DB", "F_Analyzer")

_SCHEMA_STATEMENTS = (
    """
    IF OBJECT_ID('dbo.AppUsers', 'U') IS NULL
    CREATE TABLE dbo.AppUsers (
        UserId       INT IDENTITY(1,1) PRIMARY KEY,
        Username     NVARCHAR(50)  NOT NULL CONSTRAINT UQ_AppUsers_Username UNIQUE,
        FullName     NVARCHAR(200) NULL,
        Email        NVARCHAR(255) NULL,
        PasswordHash NVARCHAR(255) NULL,
        IsAdmin      BIT           NOT NULL CONSTRAINT DF_AppUsers_IsAdmin DEFAULT 0,
        Status       NVARCHAR(10)  NOT NULL CONSTRAINT DF_AppUsers_Status DEFAULT 'active',
        CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_AppUsers_CreatedAt DEFAULT SYSUTCDATETIME()
    )
    """,
    # Πίνακας που δημιουργήθηκε σε παλιότερη έκδοση: πρόσθεσε ό,τι λείπει (οι παλιές γραμμές μένουν 'active').
    """
    IF COL_LENGTH('dbo.AppUsers', 'PasswordHash') IS NULL
    ALTER TABLE dbo.AppUsers ADD PasswordHash NVARCHAR(255) NULL
    """,
    """
    IF COL_LENGTH('dbo.AppUsers', 'IsAdmin') IS NULL
    ALTER TABLE dbo.AppUsers ADD IsAdmin BIT NOT NULL CONSTRAINT DF_AppUsers_IsAdmin DEFAULT 0
    """,
    """
    IF COL_LENGTH('dbo.AppUsers', 'Status') IS NULL
    ALTER TABLE dbo.AppUsers ADD Status NVARCHAR(10) NOT NULL CONSTRAINT DF_AppUsers_Status DEFAULT 'active'
    """,
    # Το token αποθηκεύεται μόνο ως SHA-256 hash· LastSeen οδηγεί το idle timeout.
    """
    IF OBJECT_ID('dbo.AppSessions', 'U') IS NULL
    CREATE TABLE dbo.AppSessions (
        TokenHash CHAR(64)   NOT NULL PRIMARY KEY,
        UserId    INT        NOT NULL
            CONSTRAINT FK_AppSessions_User FOREIGN KEY REFERENCES dbo.AppUsers(UserId) ON DELETE CASCADE,
        CreatedAt DATETIME2  NOT NULL CONSTRAINT DF_AppSessions_CreatedAt DEFAULT SYSUTCDATETIME(),
        LastSeen  DATETIME2  NOT NULL CONSTRAINT DF_AppSessions_LastSeen DEFAULT SYSUTCDATETIME()
    )
    """,
)

_schema_ready = False
_schema_lock = threading.Lock()


def connect_users_db():
    conn = get_connection(USERS_DB)
    global _schema_ready
    if not _schema_ready:
        with _schema_lock:
            if not _schema_ready:
                cur = conn.cursor()
                for statement in _SCHEMA_STATEMENTS:
                    cur.execute(statement)
                conn.commit()
                _schema_ready = True
    return conn
