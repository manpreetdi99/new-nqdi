#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
GUI ->Excel → GPX finder + GPX parser (+ optional Folium map),

Χρήση από άλλο αρχείο:
    from gpx_tools import handler
    data = handler(
        search_value="CRE_RETHIMNO_MAJOR TOWNS_2025H2",
        excel_path=r"Z:\#TRANSFER\MANPREET\maps\map\collections-routes_merged.xlsx",
        base_path=r"Z:\#SERVICE DIVISION PROJECT FOLDER\SWISSQUAL ROUTES & HOTSPOT\#NEW MAPS 2019",
        html=None,  # ή "rethymno_map.html" αν θες να σωθεί χάρτης
    )
"""

import os
from typing import List, Tuple, Dict, Any, Optional

import pandas as pd
from xml.etree import ElementTree as ET

# Προαιρετικά (μόνο αν θες χάρτη)
import folium
from folium.plugins import FeatureGroupSubGroup


# -----------------------------
# 1) Excel → εύρεση GPX αρχείων
# -----------------------------
def find_gpx_from_excel(excel_path: str, search_value: str, base_path: str) -> Optional[List[str]]:
    """Return list of GPX file paths based on value in Column A and folder names starting with Column C."""
    df = pd.read_excel(excel_path)

    if df.shape[1] < 3:
        raise ValueError("Το Excel πρέπει να έχει τουλάχιστον 3 στήλες.")

    match = df[df.iloc[:, 0] == search_value]
    if match.empty:
        print("Δεν βρέθηκε τιμή στη στήλη Α.")
        return None

    value_col3 = str(match.iloc[0, 2])
    print(f"Βρέθηκε τιμή στη στήλη 3: {value_col3}")

    found_gpx_files: List[str] = []
    fallback_gpx_files: List[str] = []

    for root, dirs, _files in os.walk(base_path):
        for dir_name in dirs:
        # dir_name π.χ. "2.3.2.1 ISTHMIA - EPIDAVROS - ..."
            if dir_name.startswith(value_col3 + " "):
                folder_path = os.path.join(root, dir_name)
                print(f"Έλεγχος φακέλου: {folder_path}")

                try:
                    gpx_files = [f for f in os.listdir(folder_path) if f.lower().endswith(".gpx")]
                except PermissionError:
                    continue

                all_files = [f for f in gpx_files if "all" in f.lower()]

                if all_files:
                    found_gpx_files.extend([os.path.join(folder_path, f) for f in all_files])
                elif gpx_files:
                    fallback_gpx_files.extend([os.path.join(folder_path, f) for f in gpx_files])

    if found_gpx_files:
        return found_gpx_files

    if fallback_gpx_files:
        dirs = set(os.path.dirname(p) for p in fallback_gpx_files)
        if len(dirs) == 1:
            print("Δεν βρέθηκε αρχείο με 'all', αλλά βρέθηκαν GPX σε έναν φάκελο — επιστροφή όλων των GPX αυτού του φακέλου.")
            return fallback_gpx_files
        if len(fallback_gpx_files) == 1:
            print("Δεν βρέθηκε αρχείο με 'all', χρησιμοποιείται το πρώτο διαθέσιμο GPX.")
            return [fallback_gpx_files[0]]

        print("Βρέθηκαν GPX σε περισσότερους από έναν φακέλους. Απαιτείται χειροκίνητη επιλογή.")
        return None

    print("Δεν βρέθηκαν αντίστοιχοι φάκελοι ή αρχεία GPX.")
    return None


# -----------------------------
# 2) Parser για ένα GPX αρχείο
# -----------------------------
def parse_gpx(path: str) -> Tuple[List[List[Tuple[float, float]]], List[Dict[str, Any]]]:
    """
    Parse a GPX file.

    Returns:
        routes: List of routes; κάθε route = λίστα από (lat, lon).
        waypoints: List of dicts: {lat, lon, name, desc}.
    """
    tree = ET.parse(path)
    root = tree.getroot()

    if root.tag.startswith("{"):
        ns_uri = root.tag.split("}")[0].strip("{")

        def q(name: str) -> str:
            return f"{{{ns_uri}}}{name}"
    else:
        def q(name: str) -> str:
            return name

    routes: List[List[Tuple[float, float]]] = []
    waypoints: List[Dict[str, Any]] = []

    for rte in root.findall(".//" + q("rte")):
        rpts: List[Tuple[float, float]] = []
        for rp in rte.findall(q("rtept")):
            try:
                lat = float(rp.attrib.get("lat"))
                lon = float(rp.attrib.get("lon"))
            except Exception:
                continue
            rpts.append((lat, lon))
        if len(rpts) >= 2:
            routes.append(rpts)

    for wpt in root.findall(".//" + q("wpt")):
        try:
            lat = float(wpt.attrib.get("lat"))
            lon = float(wpt.attrib.get("lon"))
        except Exception:
            continue

        name_el = wpt.find(q("name"))
        cmt_el = wpt.find(q("cmt"))
        desc_el = wpt.find(q("desc"))

        name = name_el.text if (name_el is not None and name_el.text) else None
        desc = None
        for el in (desc_el, cmt_el):
            if el is not None and el.text:
                desc = el.text
                break

        waypoints.append({"lat": lat, "lon": lon, "name": name, "desc": desc})

    return routes, waypoints


# ---------------------------------------------------
# 3) Convenience: πάρε όλα τα GPX + parsed δεδομένα
# ---------------------------------------------------
def load_gpxs_from_excel(
    excel_path: str,
    base_path: str,
    search_value: str
) -> Optional[Dict[str, Dict[str, Any]]]:
    """
    Επιστρέφει dict:
        {
          "gpx_path_1": {"routes": [...], "waypoints": [...]},
          "gpx_path_2": {"routes": [...], "waypoints": [...]},
          ...
        }
    """
    gpx_paths = find_gpx_from_excel(excel_path, search_value, base_path)
    if not gpx_paths:
        return None

    out: Dict[str, Dict[str, Any]] = {}
    for p in gpx_paths:
        try:
            routes, waypoints = parse_gpx(p)
            out[p] = {"routes": routes, "waypoints": waypoints}
        except Exception as e:
            print(f"Σφάλμα στο parsing του GPX: {p} -> {e}")
    return out


# ---------------------------------------
# 4) Προαιρετικό: Φτιάξε έναν Folium χάρτη
# ---------------------------------------
def make_map(
    parsed_by_file: Dict[str, Dict[str, Any]],
    output_html: str,
    tiles: str = "OpenStreetMap",
    zoom_start: int = 8
) -> str:
    """Δημιουργεί folium χάρτη με όλα τα routes & waypoints από parsed_by_file και τον αποθηκεύει σε HTML."""
    center = None
    for info in parsed_by_file.values():
        for route in info["routes"]:
            if route:
                center = route[0]
                break
        if center:
            break
    if center is None:
        for info in parsed_by_file.values():
            if info["waypoints"]:
                w = info["waypoints"][0]
                center = (w["lat"], w["lon"])
                break
    if center is None:
        center = (38.0, 23.7)  # Greece-ish fallback

    m = folium.Map(location=center, zoom_start=zoom_start, tiles=tiles, control_scale=True)

    group_all = folium.FeatureGroup(name="GPX Layers", show=True)
    m.add_child(group_all)

    for gpx_path, info in parsed_by_file.items():
        subgroup = FeatureGroupSubGroup(group_all, name=os.path.basename(gpx_path), show=True)
        m.add_child(subgroup)

        for route in info["routes"]:
            folium.PolyLine(route, weight=4, opacity=0.9).add_to(subgroup)

        for w in info["waypoints"]:
            popup_txt = (w.get("name") or "WP") + (f"<br>{w.get('desc')}" if w.get("desc") else "")
            folium.Marker(
                location=(w["lat"], w["lon"]),
                tooltip=w.get("name") or "Waypoint",
                popup=folium.Popup(popup_txt, max_width=300),
            ).add_to(subgroup)

    folium.LayerControl().add_to(m)
    m.save(output_html)
    print(f"Χάρτης αποθηκεύτηκε: {output_html}")
    return output_html


# ----------------
# 5) Public handler
# ----------------
def handler(
    search_value: str = "IPI_IGOUMENITSA_MAJOR TOWNS_2025H2",
    excel_path: str = r"\\192.168.10.182\Public\#TRANSFER\MANPREET\maps\map\collections-routes_merged.xlsx",
    base_path: str = r"\\192.168.10.182\Public\#SERVICE DIVISION PROJECT FOLDER\SWISSQUAL ROUTES & HOTSPOT\#NEW MAPS 2019",
    html: Optional[str] = None
) -> Optional[List[str]]:
    """
    Επιστρέφει μόνο λίστα με πλήρη paths των GPX που βρέθηκαν (ή None).
    """
    gpx_paths = find_gpx_from_excel(excel_path, search_value, base_path)
    if not gpx_paths:
        print("Δεν βρέθηκαν GPX ή απαιτείται χειροκίνητη επιλογή.")
        return None

    print("Βρέθηκαν τα εξής GPX αρχεία:")
    for p in gpx_paths:
        print(f"- {p}")

    return gpx_paths
