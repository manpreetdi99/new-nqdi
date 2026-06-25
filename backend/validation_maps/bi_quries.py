import pandas as pd
from sqlalchemy import text
from databese import make_engine
from typing import Optional


def query_m_to_m(phone: Optional[str], collection: str) -> pd.DataFrame:
    """
    For a given collection name, find the immediately previous available scope
    (same collection prefix before the final '-') and return call KPIs by location.

    Args:
        phone (Optional[str]): ASideLocation filter. Use None or "" for all locations.
        collection (str): Current collection name (e.g. "ATTICA-ROUTE-25h1").

    Returns:
        pd.DataFrame: Aggregated call stats per ASideLocation for previous scope.
    """
    engine = make_engine("BI_VOICE")

    total_calls = text("""
        WITH input_collection AS (
    SELECT
        CAST(:collection AS NVARCHAR(255)) AS current_collection,
        LEFT(
            CAST(:collection AS NVARCHAR(255)),
            LEN(CAST(:collection AS NVARCHAR(255)))
              - CHARINDEX('_', REVERSE(CAST(:collection AS NVARCHAR(255))))
        ) AS base_collection,
        RIGHT(
            CAST(:collection AS NVARCHAR(255)),
            CHARINDEX('_', REVERSE(CAST(:collection AS NVARCHAR(255)))) - 1
        ) AS current_scope
),
distinct_collections AS (
    SELECT DISTINCT
        m.CollectionName,
        LEFT(m.CollectionName, LEN(m.CollectionName) - CHARINDEX('_', REVERSE(m.CollectionName))) AS base_collection,
        RIGHT(m.CollectionName, CHARINDEX('_', REVERSE(m.CollectionName)) - 1) AS scope_code
    FROM BI_VOICE.dbo.BI_VOICE_MtoM m
    WHERE m.CollectionName LIKE '%[_]%'
),
ranked_scopes AS (
    SELECT
        dc.CollectionName,
        dc.base_collection,
        dc.scope_code,
        CASE
            WHEN dc.scope_code LIKE '[0-9][0-9][0-9][0-9]H[12]'
            THEN TRY_CONVERT(INT, LEFT(dc.scope_code, 4)) * 2
                 + CASE RIGHT(dc.scope_code, 1)
                     WHEN '1' THEN 1
                     WHEN '2' THEN 2
                   END
            ELSE NULL
        END AS scope_rank
    FROM distinct_collections dc
    WHERE dc.scope_code LIKE '[0-9][0-9][0-9][0-9]H[12]'
),
current_scope_rank AS (
    SELECT
        ic.current_collection,
        ic.base_collection,
        CASE
            WHEN ic.current_scope LIKE '[0-9][0-9][0-9][0-9]H[12]'
            THEN TRY_CONVERT(INT, LEFT(ic.current_scope, 4)) * 2
                 + CASE RIGHT(ic.current_scope, 1)
                     WHEN '1' THEN 1
                     WHEN '2' THEN 2
                   END
            ELSE NULL
        END AS current_rank
    FROM input_collection ic
),
previous_collection AS (
    SELECT TOP (1)
        rs.CollectionName AS previous_collection_name,
        rs.scope_code AS previous_scope
    FROM ranked_scopes rs
    JOIN current_scope_rank csr
        ON rs.base_collection = csr.base_collection
    WHERE rs.scope_rank < csr.current_rank
    ORDER BY rs.scope_rank DESC
)
SELECT
    pc.previous_collection_name,
    pc.previous_scope,
    m.ASideLocation,
    COUNT(*) AS total_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) IN ('success', 'completed', 'complete') THEN 1 ELSE 0 END) AS success_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) LIKE 'fail%' THEN 1 ELSE 0 END) AS failed_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) LIKE 'drop%' THEN 1 ELSE 0 END) AS dropped_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) LIKE '%system%release%' THEN 1 ELSE 0 END) AS system_release_calls,
    SUM(CASE
        WHEN LOWER(ISNULL(m.callStatus, '')) IN ('success', 'completed', 'complete')
          OR LOWER(ISNULL(m.callStatus, '')) LIKE 'fail%'
          OR LOWER(ISNULL(m.callStatus, '')) LIKE 'drop%'
          OR LOWER(ISNULL(m.callStatus, '')) LIKE '%system%release%'
        THEN 0 ELSE 1
    END) AS other_calls
FROM BI_VOICE.dbo.BI_VOICE_MtoM m
CROSS JOIN previous_collection pc
WHERE m.CollectionName = pc.previous_collection_name
  AND (:phone IS NULL OR :phone = '' OR m.ASideLocation = :phone)
GROUP BY pc.previous_collection_name, pc.previous_scope, m.ASideLocation
ORDER BY m.ASideLocation;
    """)

    with engine.begin() as conn:
        df = pd.read_sql(total_calls, conn, params={
            "phone": phone or "",
            "collection": collection,
        })

    print(f"Previous-scope call summary loaded: {len(df)} rows for collection '{collection}'.")
    return df


def query_m_to_f(phone: Optional[str], collection: str) -> pd.DataFrame:
    """
    For a given collection name, find the immediately previous available scope
    (same collection prefix before the final '-') and return call KPIs by location.

    Args:
        phone (Optional[str]): ASideLocation filter. Use None or "" for all locations.
        collection (str): Current collection name (e.g. "ATTICA-ROUTE-25h1").

    Returns:
        pd.DataFrame: Aggregated call stats per ASideLocation for previous scope.
    """
    engine = make_engine("BI_VOICE")

    total_calls = text("""
        WITH input_collection AS (
    SELECT
        CAST(:collection AS NVARCHAR(255)) AS current_collection,
        LEFT(
            CAST(:collection AS NVARCHAR(255)),
            LEN(CAST(:collection AS NVARCHAR(255)))
              - CHARINDEX('_', REVERSE(CAST(:collection AS NVARCHAR(255))))
        ) AS base_collection,
        RIGHT(
            CAST(:collection AS NVARCHAR(255)),
            CHARINDEX('_', REVERSE(CAST(:collection AS NVARCHAR(255)))) - 1
        ) AS current_scope
),
distinct_collections AS (
    SELECT DISTINCT
        m.CollectionName,
        LEFT(m.CollectionName, LEN(m.CollectionName) - CHARINDEX('_', REVERSE(m.CollectionName))) AS base_collection,
        RIGHT(m.CollectionName, CHARINDEX('_', REVERSE(m.CollectionName)) - 1) AS scope_code
    FROM BI_VOICE.dbo.BI_VOICE_MtoF m
    WHERE m.CollectionName LIKE '%[_]%'
),
ranked_scopes AS (
    SELECT
        dc.CollectionName,
        dc.base_collection,
        dc.scope_code,
        CASE
            WHEN dc.scope_code LIKE '[0-9][0-9][0-9][0-9]H[12]'
            THEN TRY_CONVERT(INT, LEFT(dc.scope_code, 4)) * 2
                 + CASE RIGHT(dc.scope_code, 1)
                     WHEN '1' THEN 1
                     WHEN '2' THEN 2
                   END
            ELSE NULL
        END AS scope_rank
    FROM distinct_collections dc
    WHERE dc.scope_code LIKE '[0-9][0-9][0-9][0-9]H[12]'
),
current_scope_rank AS (
    SELECT
        ic.current_collection,
        ic.base_collection,
        CASE
            WHEN ic.current_scope LIKE '[0-9][0-9][0-9][0-9]H[12]'
            THEN TRY_CONVERT(INT, LEFT(ic.current_scope, 4)) * 2
                 + CASE RIGHT(ic.current_scope, 1)
                     WHEN '1' THEN 1
                     WHEN '2' THEN 2
                   END
            ELSE NULL
        END AS current_rank
    FROM input_collection ic
),
previous_collection AS (
    SELECT TOP (1)
        rs.CollectionName AS previous_collection_name,
        rs.scope_code AS previous_scope
    FROM ranked_scopes rs
    JOIN current_scope_rank csr
        ON rs.base_collection = csr.base_collection
    WHERE rs.scope_rank < csr.current_rank
    ORDER BY rs.scope_rank DESC
)
SELECT
    pc.previous_collection_name,
    pc.previous_scope,
    m.ASideLocation,
    COUNT(*) AS total_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) IN ('success', 'completed', 'complete') THEN 1 ELSE 0 END) AS success_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) LIKE 'fail%' THEN 1 ELSE 0 END) AS failed_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) LIKE 'drop%' THEN 1 ELSE 0 END) AS dropped_calls,
    SUM(CASE WHEN LOWER(ISNULL(m.callStatus, '')) LIKE '%system%release%' THEN 1 ELSE 0 END) AS system_release_calls,
    SUM(CASE
        WHEN LOWER(ISNULL(m.callStatus, '')) IN ('success', 'completed', 'complete')
          OR LOWER(ISNULL(m.callStatus, '')) LIKE 'fail%'
          OR LOWER(ISNULL(m.callStatus, '')) LIKE 'drop%'
          OR LOWER(ISNULL(m.callStatus, '')) LIKE '%system%release%'
        THEN 0 ELSE 1
    END) AS other_calls
FROM BI_VOICE.dbo.BI_VOICE_MtoF m
CROSS JOIN previous_collection pc
WHERE m.CollectionName = pc.previous_collection_name
  AND (:phone IS NULL OR :phone = '' OR m.ASideLocation = :phone)
GROUP BY pc.previous_collection_name, pc.previous_scope, m.ASideLocation
ORDER BY m.ASideLocation;
    """)

    with engine.begin() as conn:
        df = pd.read_sql(total_calls, conn, params={
            "phone": phone or "",
            "collection": collection,
        })

    print(f"Previous-scope call summary loaded: {len(df)} rows for collection '{collection}'.")
    return df