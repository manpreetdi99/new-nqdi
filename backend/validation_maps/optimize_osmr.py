import requests #OSMR
def osrm_route(coords_latlon, base_url, profile="driving"):
    if len(coords_latlon) < 2:
        return []
    coords_lonlat = ";".join([f"{lon:.6f},{lat:.6f}" for (lat, lon) in coords_latlon])
    url = f"{base_url.rstrip('/')}/route/v1/{profile}/{coords_lonlat}"
    params = {"overview": "full", "geometries": "geojson", "steps": "false", "annotations": "false"}
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM error: {str(data)[:200]}")
    line = data["routes"][0]["geometry"]["coordinates"]  # [[lon,lat], ...]
    return [(lat, lon) for lon, lat in line]