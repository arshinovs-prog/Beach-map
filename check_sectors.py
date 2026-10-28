import json
from pathlib import Path
from itertools import combinations
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer
data = json.loads(
    Path("beach-sectors.geojson").read_text(encoding="utf-8")
)
features = data["features"]
to_meters = Transformer.from_crs(
    "EPSG:4326", "EPSG:32637", always_xy=True
).transform
geometries = [
    transform(to_meters, shape(feature["geometry"]))
    for feature in features
]
print("Всего секторов:", len(geometries))
invalid = [
    i + 1 for i, geom in enumerate(geometries)
    if not geom.is_valid
]
print("Некорректная геометрия:", invalid or "нет")
print("\nПересечения между секторами:")
count = 0
for (i, a), (j, b) in combinations(enumerate(geometries), 2):
    overlap = a.intersection(b).area
    if overlap > 1:
        print(
            f"Сектор {i + 1} и сектор {j + 1}: "
            f"{overlap:.1f} м²"
        )
        count += 1
if count == 0:
    print("Значительных пересечений не обнаружено.")
print("\nПлощади секторов:")
for i, geom in enumerate(geometries, 1):
    print(f"{i:02}: {geom.area:.1f} м²")

