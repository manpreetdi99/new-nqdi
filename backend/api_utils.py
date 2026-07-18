"""Κοινά helpers για τα routers."""


def _rows(cursor):
    cols = [c[0] for c in cursor.description] if cursor.description else []
    return [{cols[i]: r[i] for i in range(len(cols))} for r in cursor.fetchall()]
