"""Pairwise (2-way) περιπτώσεις από τα μοντέλα PICT drop.pict / fail.pict.

Το pypict δεν γίνεται build σε αυτό το μηχάνημα (χρειάζεται C++ compiler), οπότε εδώ υπάρχει
ένας ντετερμινιστικός greedy generator που υποστηρίζει το υποσύνολο σύνταξης PICT των
μοντέλων (IF [P] = / IN {...} THEN [Q] = / <> / IN {...};) και επαληθεύει ότι καλύπτονται
ΟΛΑ τα έγκυρα ζεύγη τιμών.

Χρήση:  python generate.py            (γράφει drop.cases.json, fail.cases.json)
"""
import itertools
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
COND = re.compile(r'\[(\w+)\]\s*(=|<>|IN)\s*(\{[^}]*\}|"[^"]*")')


def parse_model(path):
    params, constraints = {}, []
    for raw in open(path, encoding="utf-8"):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.upper().startswith("IF "):
            cond, then = re.split(r"\bTHEN\b", line[3:].rstrip(";"), maxsplit=1)
            constraints.append((COND.search(cond).groups(), COND.search(then).groups()))
        else:
            name, values = line.split(":", 1)
            params[name.strip()] = [v.strip() for v in values.split(",")]
    return params, constraints


def holds(clause, row):
    name, op, value = clause
    values = [v.strip().strip('"') for v in value.strip("{}").split(",")] if op == "IN" else [value.strip('"')]
    return (row[name] in values) if op in ("=", "IN") else (row[name] not in values)


def valid(row, constraints):
    return all(not holds(cond, row) or holds(then, row) for cond, then in constraints)


def pairs_of(row, names):
    return {((a, row[a]), (b, row[b])) for a, b in itertools.combinations(names, 2)}


def generate(path):
    params, constraints = parse_model(path)
    names = list(params)
    rows = [dict(zip(names, combo)) for combo in itertools.product(*params.values())]
    rows = [r for r in rows if valid(r, constraints)]
    required = set().union(*(pairs_of(r, names) for r in rows))
    uncovered, cases = set(required), []
    while uncovered:
        best = max(rows, key=lambda r: len(pairs_of(r, names) & uncovered))
        cases.append(best)
        uncovered -= pairs_of(best, names)
    assert set().union(*(pairs_of(c, names) for c in cases)) == required
    assert all(valid(c, constraints) for c in cases)
    return cases, len(required)


if __name__ == "__main__":
    for model in ("drop", "fail"):
        cases, pairs = generate(os.path.join(HERE, f"{model}.pict"))
        with open(os.path.join(HERE, f"{model}.cases.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(cases, f, indent=1)
        print(f"{model}: {len(cases)} cases cover all {pairs} valid pairs")
