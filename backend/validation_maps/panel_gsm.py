#!/usr/bin/env python3
"""
panels_gsm.py

GSM panels: RX (RxLevFull), MOS, CALLS, TECH (GSM only).
"""

import re
import sys
from typing import Dict, List, Tuple, Optional

import folium
from folium.plugins import FeatureGroupSubGroup
import pandas as pd

from optimize_osmr import osrm_route
from queries import (
    query_rx_lev_gsm,
    query_calls_free,
    query_technology_free,
    query_mos_free,
    query_rx_lev_sub_gsm
)
from bi_quries import query_m_to_f

# ---------------------------------------------------------------------------
# Helpers (duplicated)
# ---------------------------------------------------------------------------

def bounds(points: List[Tuple[float, float]]) -> Optional[List[List[float]]]:
    if not points:
        return None
    min_lat = min(p[0] for p in points)
    max_lat = max(p[0] for p in points)
    min_lon = min(p[1] for p in points)
    max_lon = max(p[1] for p in points)
    return [[min_lat, min_lon], [max_lat, max_lon]]


def thin_equidistant(pts: List[Tuple[float, float]], max_pts: int = 120) -> List[Tuple[float, float]]:
    n = len(pts)
    if n <= max_pts:
        return pts
    idxs = [int(i * (n - 1) / (max_pts - 1)) for i in range(max_pts)]
    return [pts[i] for i in idxs]


def add_values_groups(m: folium.Map, parent_name: str = "VALUES") -> Dict[str, folium.FeatureGroup]:
    parent = folium.FeatureGroup(name=parent_name, show=True).add_to(m)
    groups = {
        "ROUTE": FeatureGroupSubGroup(parent, "ROUTE").add_to(m),
        "TECH": FeatureGroupSubGroup(parent, "TECH").add_to(m),
        "RX": FeatureGroupSubGroup(parent, "RX").add_to(m),
        "CALLS": FeatureGroupSubGroup(parent, "CALLS").add_to(m),
        "MOS": FeatureGroupSubGroup(parent, "MOS").add_to(m),
    }
    return groups


def _build_route_and_waypoints(
    m: folium.Map,
    groups: Dict[str, folium.FeatureGroup],
    waypoints,
    via_groups,
    args,
) -> Tuple[List[Tuple[float, float]], List[Tuple[float, float]]]:
    all_input_pts: List[Tuple[float, float]] = []
    for g in via_groups:
        all_input_pts.extend(g)
    all_input_pts.extend([(w["lat"], w["lon"]) for w in waypoints])

    g_route = FeatureGroupSubGroup(groups["ROUTE"], "ROUTE")
    m.add_child(g_route)
    g_way = FeatureGroupSubGroup(groups["ROUTE"], "Waypoints", show=False)
    m.add_child(g_way)

    st_points = sorted(
        [w for w in waypoints if w["name"].startswith("ST") and len(waypoints) > 2],
        key=lambda w: int(re.search(r"\d+", w["name"]).group()),
    )
    end_points = sorted(
        [w for w in waypoints if w["name"].startswith("END") and len(waypoints) > 2],
        key=lambda w: int(re.search(r"\d+", w["name"]).group()),
    )
    ordered_waypoints = st_points + end_points

    for i, w in enumerate(ordered_waypoints):
        name = w["name"] or "Waypoint"
        desc = f"<br>{w['desc']}" if w.get("desc") else ""
        if i == 0:
            folium.Marker(
                [w["lat"], w["lon"]],
                popup=f"{name}",
                tooltip=name,
                icon=folium.Icon(color="green"),
            ).add_to(g_route)
        elif i == len(ordered_waypoints) - 1:
            folium.Marker(
                [w["lat"], w["lon"]],
                popup=f"{name}",
                tooltip=name,
                icon=folium.Icon(color="red"),
            ).add_to(g_route)
        else:
            folium.Marker(
                [w["lat"], w["lon"]],
                popup=f"{name}{desc}",
                tooltip=name,
                icon=folium.Icon(color="blue"),
            ).add_to(g_way)

    all_drawn_pts: List[Tuple[float, float]] = []
    for idx, vias in enumerate(via_groups, start=1):
        if args.show_straight and len(vias) >= 2:
            folium.PolyLine(
                vias,
                weight=2,
                color="gray",
                opacity=0.6,
                tooltip=f"Raw straight #{idx}",
            ).add_to(g_route)

        road_line: List[Tuple[float, float]] = []
        if len(vias) >= 2:
            try:
                road_line = osrm_route(vias, args.osrm_url, profile=args.profile)
            except Exception as e:
                sys.stderr.write(f"[OSRM] Route {idx} failed: {e}\n")

        if road_line:
            folium.PolyLine(
                road_line,
                weight=8,
                color="black",
                opacity=1.0,
                tooltip=f"OSRM {args.profile} route #{idx}",
            ).add_to(g_route)
            all_drawn_pts.extend(road_line)

    return all_input_pts, all_drawn_pts


# ---------------------------------------------------------------------------
# GSM panel
# ---------------------------------------------------------------------------
def _get_phone_fallback(phone: str, collection: str, database: str, query_func, test_cols: List[str] = None) -> Tuple[str, pd.DataFrame]:
    """
    Try to fetch data for the given phone. If empty, retry with fallback name (nova->wind).
    
    Returns:
        (actual_phone_used, dataframe)
    """
    if test_cols is None:
        test_cols = ["latitude", "longitude"]
    
    # Try with original phone name
    df = query_func(phone, collection, database)
    if not df.empty:
        return phone, df
    
    # If empty and phone contains 'nova', try with 'wind' fallback
    if 'nova' in phone.lower():
        fallback_phone = phone.replace('nova', 'wind').replace('Nova', 'Wind').replace('NOVA', 'WIND')
        print(f"[FALLBACK] No data for '{phone}', trying '{fallback_phone}'...")
        df = query_func(fallback_phone, collection, database)
        if not df.empty:
            return fallback_phone, df
    
    return phone, df



def make_panel_gsm(
    center: Tuple[float, float],
    zoom: int,
    position: Tuple[str, str, str, str],
    tiles: str,
    title: str,
    args,
    waypoints,
    via_groups,
    phone: str,
    database: str,
    collection: str,
) -> Tuple[folium.Map, Dict[str, int]]:
    """
    Create one GSM map panel and return (map, counters).

    Counters:
      - RX_* buckets
      - LQ buckets
      - Call status buckets
    """
    m = folium.Map(
        location=center,
        zoom_start=zoom,
        prefer_canvas=True,
        tiles=None,
        position="absolute",
        
        attr=args.attr if hasattr(args, 'attr') else None,  # Pull it from args    #Added for custom tiles
        
        left=position[0],
        top=position[1],
        width=position[2],
        height=position[3],
        control_scale=True,
    )
    
    folium.TileLayer(
        tiles=tiles,
        attr=args.attr if hasattr(args, 'attr') else None,
        name="OSM DE",   # <-- αυτό θα φαίνεται στο legend
        overlay=False,
        control=True
    ).add_to(m)

    counters = {
        "RX_UNDER80": 0,
        "RX_90-80": 0,
        "RX_100-90": 0,
        "RX_110-100": 0,
        "RX_OVER110": 0,
        "completed": 0,
        "dropped": 0,
        "failed": 0,
        "system_release": 0,
        "LQ>4.5": 0,
        "LQ4-4.5": 0,
        "LQ2-4": 0,
        "LQ1-2": 0,
        "TECH_1800": 0,
        "TECH_900": 0,
        "prev_total_calls": 0,
        "prev_success_calls": 0,
        "prev_failed_calls": 0,
        "prev_dropped_calls": 0,
        "prev_system_release_calls": 0,
        "previous_collection_name": "",
        "previous_scope": "",
    }

    groups = add_values_groups(m, parent_name="VALUES")

    # ROUTE / WAYPOINTS
    all_input_pts, all_drawn_pts = _build_route_and_waypoints(m, groups, waypoints, via_groups, args)

    # recenter
    b = bounds(all_input_pts) if all_input_pts else None
    if b:
        m.location = [(b[0][0] + b[1][0]) / 2.0, (b[0][1] + b[1][1]) / 2.0]

    # RX (GSM) LAYER
    df_rx = query_rx_lev_gsm(phone, collection, database)
    df_rx = df_rx.dropna(subset=["latitude", "longitude", "RxLevFull"])

    g_rx = FeatureGroupSubGroup(groups["RX"], "RX", show=False)
    m.add_child(g_rx)
    counter_rows = 0
    previous_color = None
    same_color_count = 0
    if not df_rx.empty:
        for _, r in df_rx.iterrows():
            rx = float(r["RxLevFull"])
            if rx >= -80:
                color = "green"
                counters["RX_UNDER80"] += 1
            elif -90 <= rx < -80:
                color = "lightgreen"
                counters["RX_90-80"] += 1
            elif -100 <= rx < -90:
                color = "yellow"
                counters["RX_100-90"] += 1
            elif -110 <= rx < -100:
                color = "orange"
                counters["RX_110-100"] += 1
            else:
                color = "red"
                counters["RX_OVER110"] += 1
            counter_rows += 1
            if color != previous_color or same_color_count >= 5:
                folium.CircleMarker(
                    location=[r["latitude"], r["longitude"]],
                    radius=3.5,
                    color=color,
                    fill=True,
                    fill_color=color,
                    fill_opacity=0.8,
                ).add_to(g_rx)
                previous_color = color # Ενημερώνουμε το προηγούμενο χρώμα ΜΟΝΟ όταν σχεδιάζουμε
                same_color_count = 0 # Μηδενίζουμε τον μετρητή επανάληψης
                # COUNTER2 += 1  # gia debug
            else:
                same_color_count += 1
    # CALLS + COUNTERS (re-use query_calls_free)
    df_calls = query_calls_free(phone, collection, database)
    df_calls = df_calls[
        (df_calls["latitude"].between(-90, 90))
        & (df_calls["longitude"].between(-180, 180))
    ]

    g_calls = FeatureGroupSubGroup(groups["CALLS"], "CALLS", show=False)
    m.add_child(g_calls)

    if not df_calls.empty and "latitude" in df_calls.columns and "longitude" in df_calls.columns:

        def norm_status(s: str) -> str:
            if not isinstance(s, str):
                return ""
            s = s.strip().upper()
            if s == "COMPLETED":
                return "COMPLETED"
            if s == "DROPPED":
                return "DROPPED"
            if s == "FAILED":
                return "FAILED"
            if s in {"SYSTEM RELEASE", "SYSTEM_RELEASE", "SYSTEM-RELEASE"}:
                return "SYSTEM RELEASE"
            return s

        for _, r in df_calls.iterrows():
            status = norm_status(r.get("status", ""))
            if status == "COMPLETED":
                color = "green"
                counters["completed"] += 1
            elif status == "DROPPED":
                color = "red"
                counters["dropped"] += 1
            elif status == "FAILED":
                color = "orange"
                counters["failed"] += 1
            elif status == "SYSTEM RELEASE":
                color = "purple"
                counters["system_release"] += 1
            else:
                color = "black"

            folium.Marker(
                location=[float(r["latitude"]), float(r["longitude"])],
                popup=f"Status: {status.title()}",
                icon=folium.Icon(color=color, icon_color="white", icon="phone"),
            ).add_to(g_calls)

    
    # PREVIOUS SCOPE CALLS (from BI_VOICE_MtoM) - with fallback
    try:
        df_prev = query_m_to_f(phone, collection)
        # If empty, try fallback
        if df_prev.empty and 'nova' in phone.lower():
            fallback_phone = phone.replace('nova', 'wind').replace('Nova', 'Wind').replace('NOVA', 'WIND')
            print(f"[BI_MtoM] No data for '{phone}', trying fallback '{fallback_phone}'...")
            df_prev = query_m_to_f(fallback_phone, collection)
        
        if not df_prev.empty:
            counters["prev_total_calls"] = int(df_prev["total_calls"].sum())
            counters["prev_success_calls"] = int(df_prev["success_calls"].sum())
            counters["prev_failed_calls"] = int(df_prev["failed_calls"].sum())
            counters["prev_dropped_calls"] = int(df_prev["dropped_calls"].sum())
            counters["prev_system_release_calls"] = int(df_prev["system_release_calls"].sum())

            # Keep one label for legend display.
            counters["previous_collection_name"] = str(df_prev.iloc[0].get("previous_collection_name", "") or "")
            counters["previous_scope"] = str(df_prev.iloc[0].get("previous_scope", "") or "")
    except Exception as e:
        sys.stderr.write(f"[BI_MtoM] Previous-scope summary failed: {e}\n")
    
      # TECHNOLOGY LAYER (GSM only)
    df_tech = query_technology_free(phone, collection, database)
    df_tech = df_tech[
        (df_tech["latitude"].between(-90, 90))
        & (df_tech["longitude"].between(-180, 180))
    ]

    if not df_tech.empty:
        for tcol in ("msgtime", "MsgTime", "timestamp", "time"):
            if tcol in df_tech.columns:
                df_tech = df_tech.sort_values(tcol)
                break

        g_radio = FeatureGroupSubGroup(groups["TECH"], "TECH", show=True)
        m.add_child(g_radio)

        def tech_color_gsm(tech: str) -> str:
            if not tech:
                return "gray"
            tech = tech.strip()
            if tech == "GSM 900":
                counters["TECH_900"] += 1
                return "cyan"
            elif tech == "GSM 1800":
                counters["TECH_1800"] += 1
                return "blue"
            return "gray"
        counter_rows = 0
        for _, r in df_tech.iterrows():
            tech_val = str(r.get("technology") or "Unknown").strip()
            color = tech_color_gsm(tech_val)
            counter_rows += 1
            if counter_rows % 4 == 0:
                folium.CircleMarker(
                    location=[r["latitude"], r["longitude"]],
                    radius=4,
                    color=color,
                    fill=True,
                    fill_color=color,
                    fill_opacity=0.8,
                ).add_to(g_radio)

        # for _, r in df_tech.iterrows():
        #     tech_val = str(r.get("technology") or "Unknown").strip()
        #     tech_counts[tech_val] = tech_counts.get(tech_val, 0) + 1  # ← NEW



    # MOS LAYER (using query_mos_free)
    df_mos = query_mos_free(phone, collection, database)
    df_mos = df_mos[
        (df_mos["latitude"].between(-90, 90))
        & (df_mos["longitude"].between(-180, 180))
    ]

    if not df_mos.empty:
        g_mos = FeatureGroupSubGroup(groups["MOS"], "MOS", show=False)
        m.add_child(g_mos)
        DELTA = 0.00020

        for _, r in df_mos.iterrows():
            lq = float(r["LQ"])
            if lq >= 4.5:
                color = "green"
                counters["LQ>4.5"] += 1
            elif 4.0 <= lq < 4.5:
                color = "lightgreen"
                counters["LQ4-4.5"] += 1
            elif 2.0 <= lq < 4.0:
                color = "orange"
                counters["LQ2-4"] += 1
            elif 1.0 <= lq < 2.0:
                color = "red"
                counters["LQ1-2"] += 1
            else:
                color = "darkred"

            folium.Marker(
            location=[r["latitude"], r["longitude"]],
            icon=folium.DivIcon(
                html=f"""
                    <div style="
                        background-color: {color};
                        width: 9px; 
                        height: 9px; 
                        border: 1px solid black;
                        opacity: 1.0;
                        transform: translate(+4px, +4px);
                    "></div>"""
            )
            ).add_to(g_mos)

    # CONTROLS / FIT
    folium.LayerControl(collapsed=False, position="topright").add_to(m)

    # fit_pts = all_drawn_pts if all_drawn_pts else all_input_pts
    # if fit_pts:
    #     bb = bounds(fit_pts)
    #     if bb:
    #         m.fit_bounds(bb, padding=(10, 10))
    sql_points = []
    if not df_tech.empty:
        sql_points.extend(df_tech[['latitude', 'longitude']].values.tolist())

    elif not df_rx.empty:
        sql_points.extend(df_rx[['latitude', 'longitude']].values.tolist())
    # 2. Καθορισμός των σημείων για το fit_bounds
    fit_pts = all_drawn_pts if all_drawn_pts else all_input_pts

    # Αν δεν υπάρχει GPX, χρησιμοποίησε τα σημεία της SQL για το κεντράρισμα
    if not fit_pts and sql_points:
        fit_pts = sql_points

    if fit_pts:
        bb = bounds(fit_pts)
    if bb:
        m.fit_bounds(bb, padding=(10, 10))
    return m, counters
