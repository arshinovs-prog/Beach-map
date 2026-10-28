"""
Предварительная генерация секторов пляжа Анапа—Витязево.

Вход: beach-osm.geojson
Выход: beach-sectors.geojson, beach-sectors.sql

Параметры: 240 м по прямой между концами участка; базовая глубина 80 м.
Внутри секторов могут находиться парковки, дороги и другие объекты.

ВАЖНО: береговая линия автоматически приближается по границе OSM-полигона.
Перед применением SQL обязательно откройте beach-sectors.geojson на карте
и проверьте, что выбрана именно морская сторона полигона и сектора выглядят
правильно. Автоматическая эвристика не заменяет визуальную проверку.
"""
import json
import math
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape, Point, LineString, Polygon, box, mapping
from shapely.ops import transform, unary_union, nearest_points
from shapely.validation import make_valid

INPUT = Path("beach-osm.geojson")
OUT_GEOJSON = Path("beach-sectors.geojson")
OUT_SQL = Path("beach-sectors.sql")

START = (37.318223, 44.905925)  # Устье Анапки
END = (37.237053, 44.990127)    # Славная
SECTOR_LENGTH = 240.0
BASE_DEPTH = 80.0
MIN_DEPTH = 40.0
MAX_DEPTH = 160.0
CROP = box(37.230, 44.900, 37.321, 44.995)

TO_M = Transformer.from_crs("EPSG:4326", "EPSG:32637", always_xy=True).transform
TO_LL = Transformer.from_crs("EPSG:32637", "EPSG:4326", always_xy=True).transform


def polygon_parts(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type == "MultiPolygon" or hasattr(g, "geoms"):
        out = []
        for p in g.geoms:
            out.extend(polygon_parts(p))
        return out
    return []


def load_beach():
    with INPUT.open("r", encoding="utf-8") as f:
        data = json.load(f)
    candidates = []
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        osm_id = str(props.get("@id", props.get("id", "")))
        if osm_id and osm_id not in {
            "relation/3058474", "way/73372180", "3058474", "73372180"
        }:
            continue
        if not feature.get("geometry"):
            continue
        geom = make_valid(shape(feature["geometry"]))
        candidates.extend(polygon_parts(geom.intersection(CROP)))
    if not candidates:
        raise RuntimeError(
            "Не найдены полигоны OSM в рабочей области. "
            "Проверь beach-osm.geojson и значения @id/id."
        )
    merged = unary_union(candidates)
    parts = polygon_parts(make_valid(merged))
    if not parts:
        raise RuntimeError("После объединения OSM-объектов полигон не найден.")
    return transform(TO_M, max(parts, key=lambda p: p.area))


def unit(dx, dy):
    length = math.hypot(dx, dy)
    if length == 0:
        return 0.0, 0.0
    return dx / length, dy / length


def approximate_shore(beach, axis):
    """
    Приближённо выбирает одну сторону границы пляжного полигона.
    На каждом шаге вдоль START–END берётся ближайшая к оси точка границы.
    Это требует визуальной проверки на карте.
    """
    boundary = beach.boundary
    lines = [boundary] if boundary.geom_type == "LineString" else [
        g for g in getattr(boundary, "geoms", [])
        if g.geom_type == "LineString"
    ]
    if not lines:
        raise RuntimeError("Не удалось получить линию границы OSM-полигона.")
    coords = []
    for line in lines:
        coords.extend(list(line.coords))
    step = 10.0
    count = int(axis.length / step) + 1
    selected = []
    for i in range(count + 1):
        d = min(axis.length, i * axis.length / count)
        axis_point = axis.interpolate(d)
        nearby = []
        for xy in coords:
            p = Point(xy)
            if abs(axis.project(p) - d) <= 60:
                nearby.append(p)
        if nearby:
            chosen = min(nearby, key=lambda p: p.distance(axis_point))
        else:
            chosen = nearest_points(boundary, axis_point)[0]
        if not selected or chosen.distance(selected[-1]) >= 2:
            selected.append(chosen)
    line = LineString([(p.x, p.y) for p in selected])
    if line.length < 1000:
        raise RuntimeError(
            "Автоматически найденная береговая линия слишком короткая. "
            "Не используйте созданный SQL; нужно уточнить исходную геометрию."
        )
    return line


def make_quad(p0, p1, depth, normal_sign):
    dx, dy = unit(p1.x - p0.x, p1.y - p0.y)
    nx, ny = -dy * normal_sign, dx * normal_sign
    q0 = (p0.x + nx * depth, p0.y + ny * depth)
    q1 = (p1.x + nx * depth, p1.y + ny * depth)
    return Polygon([(p0.x, p0.y), (p1.x, p1.y), q1, q0])


def main():
    if not INPUT.exists():
        raise FileNotFoundError(f"Не найден файл {INPUT.resolve()}")

    beach = load_beach()
    start = transform(TO_M, Point(START))
    end = transform(TO_M, Point(END))
    axis = LineString([start, end])
    shore = approximate_shore(beach, axis)

    # Береговая линия ориентируется от START к END. Проверяем обе нормали:
    # выбираем сторону, направленную дальше от оси START—END (в сторону суши).
    coords = list(shore.coords)
    sectors = []
    sql = [
        "-- Предварительная геометрия секторов Анапа—Витязево",
        "-- Сначала проверь beach-sectors.geojson на карте; затем выполняй SQL."
    ]

    # Используем фиксированные интервалы по прямой между последовательными
    # точками линии берега. Шаг по самой линии нужен для определения концов;
    # геометрическая длина сектора контролируется по хорде.
    distance = 0.0
    while distance < shore.length - 1:
        p0 = shore.interpolate(distance)
        target = min(shore.length, distance + SECTOR_LENGTH)
        p1 = shore.interpolate(target)
        chord = p0.distance(p1)
        if chord < 5:
            break

        depth = BASE_DEPTH
        # Оцениваем обе стороны и выбираем сторону дальше от продольной оси.
        a = make_quad(p0, p1, depth, 1)
        b = make_quad(p0, p1, depth, -1)
        sector = a if a.representative_point().distance(axis) > b.representative_point().distance(axis) else b

        # Увеличиваем глубину, если хорда/контур схлопывается из-за резкого
        # поворота. Геометрически корректируем глубину до MAX_DEPTH.
        while depth < MAX_DEPTH and (sector.is_empty or sector.area < chord * MIN_DEPTH * 0.5):
            depth += 10
            a = make_quad(p0, p1, depth, 1)
            b = make_quad(p0, p1, depth, -1)
            sector = a if a.representative_point().distance(axis) > b.representative_point().distance(axis) else b

        sector = make_valid(sector)
        parts = [p for p in polygon_parts(sector) if p.area > 1]
        if not parts:
            distance += SECTOR_LENGTH
            continue
        sector = unary_union(parts)
        sector_ll = transform(TO_LL, sector)
        rep = transform(TO_LL, sector.representative_point())
        number = len(sectors) + 1
        name = f"Сектор {number:02d}"
        feature = {
            "type": "Feature",
            "properties": {
                "sector_no": number,
                "name": name,
                "access_name": "",
                "latitude": rep.y,
                "longitude": rep.x,
                "length_m": round(chord, 1),
                "depth_m": depth
            },
            "geometry": mapping(sector_ll)
        }
        sectors.append(feature)
        sql.append(
            "INSERT INTO public.beach_sectors "
            "(sector_no, name, access_name, latitude, longitude, geom) VALUES "
            f"({number}, '{name}', '', {rep.y:.8f}, {rep.x:.8f}, "
            f"ST_GeomFromText('{sector_ll.wkt}', 4326));"
        )
        distance += SECTOR_LENGTH

    if not sectors:
        raise RuntimeError("Сектора не сформированы; проверь исходную геометрию.")

    with OUT_GEOJSON.open("w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "name": "beach-sectors",
            "features": sectors
        }, f, ensure_ascii=False, indent=2)

    with OUT_SQL.open("w", encoding="utf-8") as f:
        f.write("\n".join(sql) + "\n")

    print(f"Создано секторов: {len(sectors)}")
    print(f"Приближённая длина выбранной линии: {shore.length:.0f} м")
    print(f"GeoJSON: {OUT_GEOJSON.resolve()}")
    print(f"SQL: {OUT_SQL.resolve()}")
    print("ПЕРЕД SQL обязательно проверь геометрию GeoJSON на карте.")


if __name__ == "__main__":
    main()
