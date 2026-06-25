#!/usr/bin/env python3
"""
panel_data.py

DATA device panel (RSRP-only).

Creates a Folium map panel with:
- Route / waypoints drawn using OSRM
- DATA RSRP layer (from query_rsrp_data)
- Basic counters for RSRP buckets

Public API:
    make_panel_data(...)
"""

from turtle import pd
from typing import Dict, List, Tuple, Optional

import folium
from folium.plugins import FeatureGroupSubGroup

from optimize_osmr import osrm_route
from queries import query_ookla, query_rsrp_data
from queries import query_rsrp_free


# ---------------------------------------------------------------------------
# Helper functions (local to this module)
# ---------------------------------------------------------------------------


def bounds(points: List[Tuple[float, float]]) -> Optional[List[List[float]]]:
    """
    Return bounding box [[min_lat, min_lon], [max_lat, max_lon]] for a list of (lat, lon).
    """
    if not points:
        return None
    min_lat = min(p[0] for p in points)
    max_lat = max(p[0] for p in points)
    min_lon = min(p[1] for p in points)
    max_lon = max(p[1] for p in points)
    return [[min_lat, min_lon], [max_lat, max_lon]]


def add_values_groups(m: folium.Map, parent_name: str = "VALUES") -> Dict[str, folium.FeatureGroup]:
    """
    Create a parent FeatureGroup and fixed set of subgroups on a map.

    Returns a dict of subgroups:
        ROUTE, TECH, RSRP, RX, CALLS, MOS, SCANNER, DATA

    Only DATA + ROUTE are actually used in this file,
    but we keep the same structure as the other panels.
    """
    parent = folium.FeatureGroup(name=parent_name, show=True).add_to(m)
    groups = {
        "ROUTE": FeatureGroupSubGroup(parent, "ROUTE").add_to(m),
        "DATA RSRP": FeatureGroupSubGroup(parent, "DATA RSRP").add_to(m),
        "OOKLA": FeatureGroupSubGroup(parent, "OOKLA").add_to(m),
    }
    return groups


def _build_route_and_waypoints(
    m: folium.Map,
    groups: Dict[str, folium.FeatureGroup],
    waypoints,
    via_groups,
    args,
) -> Tuple[List[Tuple[float, float]], List[Tuple[float, float]]]:
    """
    Common logic: draw route, ST/END waypoints and OSRM paths.

    Returns:
        (all_input_pts, all_drawn_pts)
    """
    all_input_pts: List[Tuple[float, float]] = []
    for g in via_groups:
        all_input_pts.extend(g)
    all_input_pts.extend([(w["lat"], w["lon"]) for w in waypoints])

    # Sub-groups for route + waypoints
    g_route = FeatureGroupSubGroup(groups["ROUTE"], "ROUTE")
    m.add_child(g_route)
    g_way = FeatureGroupSubGroup(groups["ROUTE"], "Waypoints", show=False)
    m.add_child(g_way)

    # Sort ST* and END* waypoints if we have them
    import re

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
            # start
            folium.Marker(
                [w["lat"], w["lon"]],
                popup=f"{name}",
                tooltip=name,
                icon=folium.Icon(color="green"),
            ).add_to(g_route)
        elif i == len(ordered_waypoints) - 1:
            # end
            folium.Marker(
                [w["lat"], w["lon"]],
                popup=f"{name}",
                tooltip=name,
                icon=folium.Icon(color="red"),
            ).add_to(g_route)
        else:
            # intermediate
            folium.Marker(
                [w["lat"], w["lon"]],
                popup=f"{name}{desc}",
                tooltip=name,
                icon=folium.Icon(color="blue"),
            ).add_to(g_way)

    # OSRM route(s)
    all_drawn_pts: List[Tuple[float, float]] = []

    for idx, vias in enumerate(via_groups, start=1):
        # Optional straight segments
        if getattr(args, "show_straight", False) and len(vias) >= 2:
            folium.PolyLine(
                vias,
                weight=2,
                color="gray",
                opacity=0.6,
                tooltip=f"Raw straight #{idx}",
            ).add_to(g_route)

        # Road-following OSRM route
        road_line: List[Tuple[float, float]] = []
        if len(vias) >= 2:
            try:
                road_line = osrm_route(
                    vias,
                    getattr(args, "osrm_url", "https://router.project-osrm.org"),
                    profile=getattr(args, "profile", "driving"),
                )
            except Exception as e:
                import sys

                sys.stderr.write(f"[OSRM] Route {idx} failed: {e}\n")

        if road_line:
            folium.PolyLine(
                road_line,
                weight=8,
                color="black",
                opacity=1.0,
                tooltip=f"OSRM {getattr(args, 'profile', 'driving')} route #{idx}",
            ).add_to(g_route)
            all_drawn_pts.extend(road_line)

    return all_input_pts, all_drawn_pts


# ---------------------------------------------------------------------------
# Panel for DATA devices (RSRP only)
# ---------------------------------------------------------------------------


def make_panel_data(
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
    Create one DATA map panel and return (map, counters).

    Args:
        center:  (lat, lon) for initial map center
        zoom:    initial zoom
        position: (left, top, width, height) as CSS percentages for Folium's map positioning
        tiles:   tile layer (e.g. "OpenStreetMap")
        title:   panel title (not used internally, but kept for consistency)
        args:    object with attributes: osrm_url, profile, show_straight
        waypoints: list of GPX waypoints
        via_groups: list of route segments [[(lat, lon), ...], ...]
        phone:   DATA device name (passed to query_rsrp_data)
        database: SQL Server database
        collection: CollectionName (route identifier)

    Returns:
        (folium.Map, counters_dict)
            counters_dict keys:
                "RSRP_UNDER80", "RSRP_90-80", "RSRP_100-90",
                "RSRP_110-100", "RSRP_OVER110"
    """
    # Base map
    m = folium.Map(
        location=center,
        zoom_start=zoom,
        prefer_canvas=True,
        tiles=None,
        
        attr=args.attr if hasattr(args, 'attr') else None,  # Pull it from args    #Added for custom tiles
        
        position="absolute",
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
    
    counters: Dict[str, int] = {
        "RSRP_UNDER80": 0,
        "RSRP_90-80": 0,
        "RSRP_100-90": 0,
        "RSRP_110-100": 0,
        "RSRP_OVER110": 0,
        "OOKLA TOTAL": 0,
        "OOKLA SUCCESS": 0,
        "TOTAL THROUGHPUT": 0,
    }

    # Add feature groups
    groups = add_values_groups(m, parent_name="VALUES")

    # ROUTE / WAYPOINTS
    all_input_pts, all_drawn_pts = _build_route_and_waypoints(
        m, groups, waypoints, via_groups, args
    )

    # Recenter map on input points if available
    b = bounds(all_input_pts) if all_input_pts else None
    if b:
        m.location = [(b[0][0] + b[1][0]) / 2.0, (b[0][1] + b[1][1]) / 2.0]

    # DATA RSRP LAYER
    df_data = query_rsrp_free(phone, collection, database)

    # Basic sanity filters
    df_data = df_data.dropna(subset=["latitude", "longitude", "rsrp"])
    df_data = df_data[
        (df_data["latitude"].between(-90, 90))
        & (df_data["longitude"].between(-180, 180))
    ]

    g_data = FeatureGroupSubGroup(groups["DATA RSRP"], "DATA RSRP", show=True)
    m.add_child(g_data)
    previous_color = None
    same_color_count = 0
    COUNTER2= 0
    if not df_data.empty:
        for _, r in df_data.iterrows():
            rsrp = float(r["rsrp"])
            if rsrp >= -80:
                counters["RSRP_UNDER80"] += 1
                color = "green"
            elif -90 <= rsrp < -80:
                # color = "lightgreen"
                counters["RSRP_90-80"] += 1
                color = "lightgreen"
            elif -100 <= rsrp < -90:
                # color = "yellow"
                counters["RSRP_100-90"] += 1
                color = "yellow"
            elif -110 <= rsrp < -100:
                # color = "orange"
                counters["RSRP_110-100"] += 1
                color = "orange"
            else:
                # color = "red"
                counters["RSRP_OVER110"] += 1
                color = "red"
            if color != previous_color or same_color_count >= 5:
                folium.CircleMarker(
                    location=[r["latitude"], r["longitude"]],
                    radius=4,
                    color=color,
                    fill=True,
                    fill_color=color,
                    fill_opacity=0.8,
                ).add_to(g_data)
                previous_color = color
                same_color_count = 0
                COUNTER2 += 1
            else:
                same_color_count += 1
                
                
     # DATA RSRP LAYER
    df_ookla = query_ookla(phone, collection, database)

    # Basic sanity filters
    df_ookla = df_ookla.dropna(subset=["latitude", "longitude","ActionStatus"])
    df_ookla = df_ookla[
        (df_ookla["latitude"].between(-90, 90))
        & (df_ookla["longitude"].between(-180, 180))
    ]

    g_data = FeatureGroupSubGroup(groups["OOKLA"], "OOKLA", show=False)
    m.add_child(g_data)
    COUNTER2= 0
    if not df_ookla.empty:
        for _, r in df_ookla.iterrows():
            Thr = float(r["Throughput"])
            counters["OOKLA TOTAL"] += 1
            if r["ActionStatus"] == "Success":
                counters["OOKLA SUCCESS"] += 1
                color = "green"
                counters["TOTAL THROUGHPUT"] += Thr
                
            else:
                color = "red"
            folium.CircleMarker(
                    location=[r["latitude"], r["longitude"]],
                    radius=6,
                    color=color,
                    fill=True,
                    fill_color=color,
                    fill_opacity=0.9,
            ).add_to(g_data)

    # PRINT TOTAL RSRP VALUES IN MAP
    # print("TOTAL RSRP VALUES IN MAP",COUNTER2)
    # Controls / auto-fit to drawn route
    folium.LayerControl(collapsed=False, position="topright").add_to(m)

    # fit_pts = all_drawn_pts if all_drawn_pts else all_input_pts
    # if fit_pts:
    #     bb = bounds(fit_pts)
    #     if bb:
    #         m.fit_bounds(bb, padding=(10, 10))
    
    sql_points = []
    if not df_data.empty:
        sql_points.extend(df_data[['latitude', 'longitude']].values.tolist())

    
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


__all__ = ["make_panel_data"]
