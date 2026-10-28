import json
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

INPUT = Path("beach-sectors.geojson")

to_m = Transformer.from_crs(
    "EPSG:4326",
    "EPSG:32637",
    always_xy=True
).transform

with INPUT.open("r", encoding="utf-8") as file:
    data = json.load(file)

results = []

for feature in data["features"]:
    geometry = shape(feature["geometry"])
    g = transform(to_m, geometry)

    area = g.area
    perimeter = g.length
    compactness = area / g.convex_hull.area if g.convex_hull.area else 0

    results.append({
        "id": feature["properties"].get("sector_no", "?"),
        "name": feature["properties"].get("name", ""),
        "type": geometry.geom_type,
        "parts": len(geometry.geoms) if geometry.geom_type == "MultiPolygon" else 1,
        "area": area,
        "perimeter": perimeter,
        "compactness": compactness,
        "bounds": geometry.bounds,
    })

results.sort(key=lambda item: item["compactness"])

print(f"Всего секторов: {len(results)}")
print("\n10 секторов с самой необычной формой:")
print("-" * 100)

for item in results[:10]:
    print(
        f"Сектор {item['id']} | {item['name']} | "
        f"тип={item['type']} | частей={item['parts']} | "
        f"площадь={item['area']:.0f} м² | "
        f"периметр={item['perimeter']:.0f} м | "
        f"компактность={item['compactness']:.3f}"
    )

print("\nСектора, состоящие из нескольких частей:")
for item in results:
    if item["type"] == "MultiPolygon":
        print(
            f"Сектор {item['id']} | частей={item['parts']} | "
            f"площадь={item['area']:.0f} м²"
        )
