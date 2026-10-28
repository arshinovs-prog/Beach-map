import json
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union

p = Path("beach-osm.geojson")
data = json.loads(p.read_text(encoding="utf-8"))

for f in data.get("features", []):
    fid = f.get("id")
    if fid in ("relation/3058474", "way/73372180"):
        g = shape(f["geometry"])
        print(f"\nОбъект: {fid}")
        print("Тип:", g.geom_type)
        print("Площадь:", round(g.area, 8))
        print("Границы:", tuple(round(x, 6) for x in g.bounds))
        print("Валидность:", g.is_valid)
        print("Частей:", len(g.geoms) if hasattr(g, "geoms") else 1)

geometries = [
    shape(f["geometry"])
    for f in data.get("features", [])
    if f.get("id") in ("relation/3058474", "way/73372180")
    and f.get("geometry")
]
if geometries:
    g = unary_union(geometries)
    print("\nОбъединённая геометрия:")
    print("Тип:", g.geom_type)
    print("Границы:", tuple(round(x, 6) for x in g.bounds))
    print("Валидность:", g.is_valid)
    print("Частей:", len(g.geoms) if hasattr(g, "geoms") else 1)
