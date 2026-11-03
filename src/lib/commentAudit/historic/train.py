"""
Εκπαίδευση του Historic από το exports/audit-kpis-historic.csv → model.json (δίπλα σε αυτό το αρχείο).

    python -I -X utf8 src/lib/commentAudit/historic/train.py exports/audit-kpis-historic.csv

Στόχος = το σχόλιο του χρήστη (user_label). Features = μόνο ΜΕΤΡΗΣΕΙΣ της κλήσης: ράδιο A/B (όλη η κλήση
και τέλος κλήσης), uplink/TA, μετρήσεις σηματοδοσίας, ενδείξεις tracelog/L3. Δεν μπαίνουν τα αποτελέσματα
του Standard, οι ερμηνείες ράδιο του Standard (f_lteLowRsrp κ.λπ.), ο scanner (δεν φορτώνεται στο Analyze),
ούτε ταυτότητες/θέση (session, κυψέλη, συντεταγμένες), ώστε το μοντέλο να μη «θυμάται» διαδρομές.
"""
import csv
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

MIN_CLASS_ROWS = 3
FOLDS = 5
C_GRID = (0.03, 0.1, 0.3, 1.0)
SEED = 42

NOT_FEATURES = {
    "database_name", "session_id", "collection", "a_side_location", "call_dir", "configured_duration_s",
    "latitude", "longitude", "call_start_time", "a_last_pci", "a_last_earfcn", "band",
    "native_code", "native_description", "disconnect_cause", "sip_bye_reason", "sip_error_codes",
    "user_comment", "user_label", "is_valid", "final_label", "final_label_source",
}
NOT_PREFIXES = ("scan_", "standard_", "historic_", "a_ue_minus_scan", "b_ue_minus_scan")
# Ερμηνείες ράδιο του Standard: το Historic βλέπει τις ίδιες τις μετρήσεις ράδιο.
STANDARD_RADIO = {"f_lteLowRsrp", "f_lteLowQuality", "f_gsmLowRxLev", "f_gsmHighRxQual", "f_radioGood", "f_noRadio", "f_ueStuck"}
CATEGORICAL = ("technology", "end_technology", "call_status", "sip_bye_direction", "sip_cancel_direction", "last_ho_type", "native_group")
# Κωδικοί → 0/1 «υπάρχει».
PRESENCE = ("sip_5xx_code", "sip_user_code")


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return np.nan


def build_features(rows, columns):
    numeric = [c for c in columns if c not in NOT_FEATURES and c not in CATEGORICAL and c not in PRESENCE
               and c not in STANDARD_RADIO and not c.startswith(NOT_PREFIXES)]
    names, cols = [], []
    for c in numeric:
        vals = np.array([to_float(r[c]) for r in rows])
        if np.all(np.isnan(vals)) or np.nanstd(vals) == 0:
            continue
        names.append(c)
        cols.append(vals)
    for c in PRESENCE:
        names.append(f"{c}_present")
        cols.append(np.array([1.0 if r[c] else 0.0 for r in rows]))
    for c in CATEGORICAL:
        values = sorted({r[c] for r in rows if r[c]})
        for v in values:
            col = np.array([1.0 if r[c] == v else 0.0 for r in rows])
            if 2 <= col.sum() <= len(rows) - 2:
                names.append(f"{c}={v}")
                cols.append(col)
    return names, np.column_stack(cols)


def standardize(X):
    mean = np.nanmean(X, axis=0)
    std = np.nanstd(X, axis=0)
    std[std == 0] = 1.0
    Z = (X - mean) / std
    return np.nan_to_num(Z, nan=0.0), mean, std


def main(csv_path):
    with open(csv_path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames
        rows = list(reader)
    # «στήλη=τιμή» και «στήλη_present» υπολογίζονται με τον ίδιο τρόπο στο historic.ts (featureValue).
    names, X = build_features(rows, columns)
    Z, mean, std = standardize(X)

    counts = {}
    for r in rows:
        if r["user_label"]:
            counts[r["user_label"]] = counts.get(r["user_label"], 0) + 1
    classes = sorted(l for l, n in counts.items() if n >= MIN_CLASS_ROWS)
    train = [i for i, r in enumerate(rows) if r["user_label"] in classes]
    y = np.array([rows[i]["user_label"] for i in train])
    Zt = Z[train]
    folds = min(FOLDS, min(counts[c] for c in classes))
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=SEED)

    best = None
    for C in C_GRID:
        model = LogisticRegression(C=C, class_weight="balanced", max_iter=5000)
        proba = cross_val_predict(model, Zt, y, cv=cv, method="predict_proba")
        pred = np.array(sorted(classes))[proba.argmax(axis=1)]
        score = balanced_accuracy_score(y, pred)
        print(f"C={C}: accuracy {accuracy_score(y, pred):.3f} · balanced {score:.3f}")
        if best is None or score > best[0]:
            best = (score, C, proba, pred)
    _, C, proba, pred = best
    final = LogisticRegression(C=C, class_weight="balanced", max_iter=5000).fit(Zt, y)
    assert list(final.classes_) == classes

    oof = {f'{rows[i]["database_name"]}:{rows[i]["session_id"]}': [round(float(p), 4) for p in proba[k]] for k, i in enumerate(train)}
    out = {
        "version": 1,
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "databases": sorted({r["database_name"] for r in rows}),
        "rows": len(train),
        "classes": classes,
        "features": [{"name": n, "mean": round(float(m), 5), "std": round(float(s), 5)} for n, m, s in zip(names, mean, std)],
        "coef": [[round(float(w), 5) for w in row] for row in final.coef_],
        "intercept": [round(float(b), 5) for b in final.intercept_],
        "oof": oof,
        "cv": {"accuracy": round(float(accuracy_score(y, pred)), 4), "folds": folds, "C": C},
    }
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(train)} κλήσεις · {len(classes)} κατηγορίες · {len(names)} features · C={C} · CV accuracy {out['cv']['accuracy']}")
    print("κατηγορίες:", {c: counts[c] for c in classes})


if __name__ == "__main__":
    main(sys.argv[1])
