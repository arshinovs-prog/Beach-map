import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import { supabase } from './lib/supabase'
import { isBeachMapAdmin, loadActiveSectorGeometries, saveBeachSector, deactivateBeachSector, signInBeachMapAdmin, signOutBeachMapAdmin, type SavedSector } from './lib/beachSectorGeometry'
import type { Feature, Polygon, Position } from 'geojson'

import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

maplibregl.setWorkerUrl(workerUrl)

type Sector = {
  sector_id: number
  name: string
  access_name: string | null

  latitude: number
  longitude: number

  report_id: number | null

  algae: string | null
  waves: string | null
  jellyfish: string | null

  status_color:
    | 'green'
    | 'yellow'
    | 'red'
    | 'gray'

  main_icon: string | null

  last_updated: string | null
  confirmation_count: number
  algae_none_count: number
  algae_low_count: number
  algae_high_count: number
  waves_none_count: number
  waves_medium_count: number
  waves_high_count: number
  jellyfish_none_count: number
  jellyfish_low_count: number
  jellyfish_high_count: number
  beach_type: 'sand' | 'pebble'
}

function getBeachPhotoPath(sector: Sector) {
  const surface = sector.beach_type === 'pebble' ? 'pebble' : 'sand'

  // Серый статус означает, что отчёт отсутствует или устарел.
  // В этом случае показываем только море, без пляжа.
  if (sector.status_color === 'gray' || !sector.report_id) {
    return '/images/beach/sea-no-data.webp'
  }

  // Приоритет совпадает с логикой статуса сектора:
  // водоросли → волны → медузы.
  let condition = 'clear'
  if (sector.algae === 'high') condition = 'algae-high'
  else if (sector.algae === 'low') condition = 'algae-low'
  else if (sector.waves === 'high') condition = 'waves-high'
  else if (sector.waves === 'medium') condition = 'waves-medium'
  else if (sector.jellyfish === 'high') condition = 'jellyfish-high'
  else if (sector.jellyfish === 'low') condition = 'jellyfish-low'

  return `/images/beach/${surface}-${condition}.webp`
}

function getStatusText(status: string) {
  switch (status) {
    case 'green':
      return 'Отличные условия'

    case 'yellow':
      return 'Средние условия'

    case 'red':
      return 'Плохие условия'

    default:
      return 'Нет актуальных данных'
  }
}

function ConditionIcon({ kind }: { kind: 'algae' | 'waves' | 'jellyfish' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" {...common}>
      {kind === 'algae' && <><path d="M24 39V10M24 25c-9 0-13-6-12-13 8 0 13 5 12 13ZM24 31c9 0 13-6 12-13-8 0-13 5-12 13ZM24 19c-5-2-7-6-6-11 5 1 7 5 6 11Z" /><path d="M17 40h14" /></>}
      {kind === 'waves' && <><path d="M5 17c5 0 5-5 10-5s5 5 10 5 5-5 10-5 5 5 8 5" /><path d="M5 27c5 0 5-5 10-5s5 5 10 5 5-5 10-5 5 5 8 5" /><path d="M5 37c5 0 5-5 10-5s5 5 10 5 5-5 10-5 5 5 8 5" /></>}
      {kind === 'jellyfish' && <><path d="M8 23a16 16 0 0 1 32 0c0 6-7 9-16 9S8 29 8 23Z" /><path d="M15 32c1 4-2 6-1 10M23 32v9M31 32c-1 4 2 6 1 10M12 22c2-2 4-2 6 0M30 22c2-2 4-2 6 0" /></>}
    </svg>
  )
}

function App() {
  const mapContainer =
    useRef<HTMLDivElement>(null)

  const mapRef =
    useRef<maplibregl.Map | null>(null)
  const initialMapViewSetRef = useRef(false)

  const sectorsRef =
    useRef<Sector[]>([])

  const [sectors, setSectors] =
    useState<Sector[]>([])
  const [surfaceFilter, setSurfaceFilter] = useState<'all' | 'sand' | 'pebble'>('all')
  const [statusFilters, setStatusFilters] = useState<Array<'green' | 'yellow' | 'red' | 'gray'>>(['green','yellow','red','gray'])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [expandedConditions, setExpandedConditions] = useState<string[]>([])
  const hasActiveFilters = surfaceFilter !== 'all' || statusFilters.length !== 4
  const resetFilters = () => {
    setSurfaceFilter('all')
    setStatusFilters(['green', 'yellow', 'red', 'gray'])
  }
  const visibleSectors = sectors.filter(sector => (surfaceFilter === 'all' || sector.beach_type === surfaceFilter) && statusFilters.includes(sector.status_color))


  const [selectedSector, setSelectedSector] =
    useState<Sector | null>(null)

  const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin'
  const [editorOpen, setEditorOpen] = useState(isAdminRoute)
  const [drawingMode, setDrawingMode] = useState(false)
  const [editorMode, setEditorMode] = useState<'idle' | 'new' | 'selected' | 'editing'>('idle')
  const [selectedSavedSector, setSelectedSavedSector] = useState<SavedSector | null>(null)
  const [draftVertices, setDraftVertices] = useState<[number, number][]>([])
  const drawingModeRef = useRef(false)
  const draftVerticesRef = useRef<[number, number][]>([])
  const draggingVertexRef = useRef<number | null>(null)
  const [admin, setAdmin] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [adminMessage, setAdminMessage] = useState('')
  const [sectorName, setSectorName] = useState('')
  const [accessName, setAccessName] = useState('')
  const [beachType, setBeachType] = useState<'sand' | 'pebble'>('sand')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savedGeometry, setSavedGeometry] = useState<SavedSector[]>([])

  // При изменении фильтра автоматически показываем все найденные сектора.
  // Если результатов нет, сохраняем текущий ракурс — искать нечего.
  const previousFilterKeyRef = useRef('')
  useEffect(() => {
    const filterKey = `${surfaceFilter}|${[...statusFilters].sort().join(',')}`
    if (!previousFilterKeyRef.current) {
      previousFilterKeyRef.current = filterKey
      return
    }
    if (previousFilterKeyRef.current === filterKey) return
    previousFilterKeyRef.current = filterKey
    if (visibleSectors.length === 0) return

    const matchingIds = new Set(visibleSectors.map(sector => sector.sector_id))
    const bounds = new maplibregl.LngLatBounds()
    const extendCoordinates = (value: unknown): void => {
      if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
        bounds.extend([value[0], value[1]])
      } else if (Array.isArray(value)) {
        value.forEach(extendCoordinates)
      }
    }
    savedGeometry.forEach(item => {
      if (!matchingIds.has(Number(item.id))) return
      let geometry: any = item.geometry
      if (typeof geometry === 'string') {
        try { geometry = JSON.parse(geometry) } catch { return }
      }
      if (geometry?.type === 'Feature') geometry = geometry.geometry
      if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
        extendCoordinates(geometry.coordinates)
      }
    })
    const map = mapRef.current
    if (map && !bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 105, left: 55, right: 55 },
        maxZoom: 11.5,
        duration: 700,
      })
    }
  }, [surfaceFilter, statusFilters, sectors, savedGeometry])
  const [saving, setSaving] = useState(false)
  const [reportAlgae, setReportAlgae] = useState('none')
  const [reportWaves, setReportWaves] = useState('none')
  const [reportJellyfish, setReportJellyfish] = useState('none')
  const [reportBusy, setReportBusy] = useState(false)
  const [reviewReportOpen, setReviewReportOpen] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const [reportMode, setReportMode] = useState<'view' | 'edit'>('view')
  const [myReport, setMyReport] = useState<{ id: number; algae: string; waves: string; jellyfish: string; created_at: string } | null>(null)
  const [, setMyConfirmedReportId] = useState<number | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [cooldownText, setCooldownText] = useState('')
  useEffect(() => {
    const map = mapRef.current
    if (!selectedSector || !map) { setExpandedConditions([]); return }
    setFiltersOpen(false)
    // Подбираем масштаб по границам самого сектора, чтобы он целиком
    // помещался в свободной области карты над карточкой.
    const features = map.querySourceFeatures('saved-polygons')
    const feature = features.find(item => Number(item.properties?.sector_id) === selectedSector.sector_id)
    if (feature?.geometry) {
      const bounds = new maplibregl.LngLatBounds()
      const addCoordinates = (value: unknown): void => {
        if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
          bounds.extend([value[0], value[1]])
        } else if (Array.isArray(value)) {
          value.forEach(addCoordinates)
        }
      }
      addCoordinates((feature.geometry as any).coordinates)
      if (!bounds.isEmpty()) {
        const panelHeight = document.querySelector('.sector-panel')?.getBoundingClientRect().height ?? 0
        map.fitBounds(bounds, {
          padding: { top: 32, bottom: Math.round(panelHeight + 28), left: 36, right: 36 },
          maxZoom: 14,
          duration: 850,
        })
      }
    } else if (selectedSector.latitude && selectedSector.longitude) {
      map.flyTo({ center: [selectedSector.longitude, selectedSector.latitude], zoom: 12.8, duration: 850 })
    }
  }, [selectedSector?.sector_id])

  const hasDraftChanges = !!selectedSector && (
    reportAlgae !== (selectedSector.algae ?? 'none') ||
    reportWaves !== (selectedSector.waves ?? 'none') ||
    reportJellyfish !== (selectedSector.jellyfish ?? 'none')
  )


  /*
   * =====================================================
   * 1. ЗАГРУЗКА СЕКТОРОВ ИЗ SUPABASE
   * =====================================================
   */

  useEffect(() => {
    async function loadSectors() {
      console.log(
        'Загружаем сектора из Supabase...'
      )

      const { data, error } =
        await supabase
          .rpc('get_sector_current_status')

      if (error) {
        console.error(
          'Ошибка загрузки секторов:',
          error
        )

        return
      }

      console.log(
        'Сектора из Supabase:',
        data
      )

      const normalizedSectors: Sector[] =
        (data ?? []).map((row: any) => ({
          sector_id:
            Number(row.sector_id),

          name:
            row['Имя'] ??
            row.name ??
            'Без названия',

          access_name:
            row.access_name ?? null,

          latitude:
            Number(row.latitude),

          longitude:
            Number(row.longitude),

          report_id:
            row.report_id !== null &&
            row.report_id !== undefined
              ? Number(row.report_id)
              : null,

          algae:
            row.algae ?? null,

          waves:
            row.waves ?? null,

          jellyfish:
            row.jellyfish ?? null,

          status_color:
            row.status_color ?? 'gray',

          main_icon:
            row.main_icon ?? null,

          last_updated:
            row.last_updated ?? null,

          confirmation_count:
            Number(
              row.confirmation_count ?? 0
            ),
          algae_none_count: Number(row.algae_none_count ?? 0),
          algae_low_count: Number(row.algae_low_count ?? 0),
          algae_high_count: Number(row.algae_high_count ?? 0),
          waves_none_count: Number(row.waves_none_count ?? 0),
          waves_medium_count: Number(row.waves_medium_count ?? 0),
          waves_high_count: Number(row.waves_high_count ?? 0),
          jellyfish_none_count: Number(row.jellyfish_none_count ?? 0),
          jellyfish_low_count: Number(row.jellyfish_low_count ?? 0),
          jellyfish_high_count: Number(row.jellyfish_high_count ?? 0),
          beach_type: row.beach_type === 'pebble' ? 'pebble' : 'sand',
        }))

      console.log(
        'Нормализованные сектора:',
        normalizedSectors
      )

      sectorsRef.current =
        normalizedSectors

      setSectors(
        normalizedSectors
      )
    }

    loadSectors()
  }, [])

  useEffect(() => {
    let alive = true
    async function loadGeometryAndAdmin() {
      try {
        const [geometry, isAdmin] = await Promise.all([loadActiveSectorGeometries(), isBeachMapAdmin().catch(() => false)])
        if (!alive) return
        setSavedGeometry(geometry)
        setAdmin(isAdmin)
      } catch (e) {
        console.error('Не удалось загрузить геометрию секторов:', e)
        if (alive) setAdminMessage('Не удалось загрузить полигоны. Проверьте права SELECT на beach_sectors.')
      }
    }
    void loadGeometryAndAdmin()
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      void isBeachMapAdmin().then(setAdmin).catch(() => setAdmin(false))
    })
    return () => { alive = false; listener.subscription.unsubscribe() }
  }, [])

  /*
   * =====================================================
   * 2. СОЗДАНИЕ КАРТЫ
   * =====================================================
   */

  useEffect(() => {
    if (!mapContainer.current) {
      console.error(
        'Контейнер карты не найден'
      )

      return
    }

    const map =
      new maplibregl.Map({
        container:
          mapContainer.current,

        style: 'https://tiles.openfreemap.org/styles/positron',

        // Стартовый центр — ориентировочная середина пляжей Анапы и Витязево.
        // Точный охват будет рассчитан по геометрии всех секторов после загрузки.
        center: [37.285, 44.945],
        zoom: 10,
      })

    map.addControl(
      new maplibregl.NavigationControl(),
      'top-right'
    )

    map.on('load', () => {
      console.log(
        'Карта MapLibre загружена'
      )

      map.addSource('saved-polygons', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('sector-overview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
       map.addLayer({
        id: 'saved-polygons-fill',
        type: 'fill',
        source: 'saved-polygons',
        minzoom: 11.5,
        paint: {
          'fill-color': [
            'match', ['get', 'status_color'],
            'green', '#4F9B7A',
            'yellow', '#E9A85B',
            'red', '#E76F70',
            '#A8B0BB',
          ],
          'fill-opacity': 0.4,
        },
      })

      map.addLayer({
        id: 'saved-polygons-line',
        type: 'line',
        source: 'saved-polygons',
        minzoom: 11.5,
        paint: {
          'line-color': [
            'match', ['get', 'status_color'],
            'green', '#286B4D',
            'yellow', '#95601C',
            'red', '#B94B50',
            '#737D8A',
          ],
          'line-width': 1.5,
        },
      })

      // На общем плане вместо мелких полигонов показываем цветные точки с белой обводкой.
      map.addLayer({
        id: 'sector-overview-points',
        type: 'circle',
        source: 'sector-overview',
        maxzoom: 11.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 9.5, 11],
          'circle-color': [
            'match', ['get', 'status_color'],
            'green', '#4F9B7A',
            'yellow', '#E9A85B',
            'red', '#E76F70',
            '#A8B0BB',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })

      // Клик по полигону открывает карточку состояния сектора.
      const openSectorFromFeature = (feature: maplibregl.MapGeoJSONFeature | undefined) => {
        if (drawingModeRef.current || !feature) return
        const id = Number(feature?.properties?.sector_id)
        if (!Number.isFinite(id)) return
        const sector = sectorsRef.current.find((item) => item.sector_id === id)
        if (sector) {
          setSelectedSector(sector)
        } else {
          // Даже если строка отсутствует во view статусов, показываем сектор с серым статусом.
          setSelectedSector({
            sector_id: id,
            name: String(feature?.properties?.name ?? 'Пляжный сектор'),
            access_name: null,
            latitude: Number(feature?.properties?.latitude ?? 0),
            longitude: Number(feature?.properties?.longitude ?? 0),
            report_id: null,
            algae: null,
            waves: null,
            jellyfish: null,
            status_color: 'gray',
            main_icon: null,
            last_updated: null,
            confirmation_count: 0,
            algae_none_count: 0, algae_low_count: 0, algae_high_count: 0,
            waves_none_count: 0, waves_medium_count: 0, waves_high_count: 0,
            jellyfish_none_count: 0, jellyfish_low_count: 0, jellyfish_high_count: 0,
            beach_type: feature?.properties?.beach_type === 'pebble' ? 'pebble' : 'sand',
          })
        }
      }
      map.on('click', 'saved-polygons-fill', (event) => openSectorFromFeature(event.features?.[0]))
      map.on('click', 'sector-overview-points', (event) => openSectorFromFeature(event.features?.[0]))
      map.on('mouseenter', 'saved-polygons-fill', () => {
        if (!drawingModeRef.current) map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'saved-polygons-fill', () => {
        map.getCanvas().style.cursor = ''
      })

      map.addSource('editor-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'editor-draft-fill', type: 'fill', source: 'editor-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#087f8c', 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'editor-draft-line', type: 'line', source: 'editor-draft', paint: { 'line-color': '#087f8c', 'line-width': 3 } })
      map.addLayer({ id: 'editor-draft-points', type: 'circle', source: 'editor-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#087f8c', 'circle-stroke-width': 3 } })

      console.log(
        'Источник и слой секторов готовы'
      )
    })

    map.on('click', (event) => {
      if (!drawingModeRef.current) return
      // Не добавляем вершину, если кликнули по уже существующей точке.
      const pointFeatures = map.queryRenderedFeatures(event.point, { layers: ['editor-draft-points'] })
      if (pointFeatures.length > 0) return
      const next: [number, number][] = [...draftVerticesRef.current, [event.lngLat.lng, event.lngLat.lat]]
      draftVerticesRef.current = next
      setDraftVertices(next)
    })

    // Перетаскивание уже созданных вершин чернового полигона.
    map.on('mousedown', 'editor-draft-points', (event) => {
      if (drawingModeRef.current) return
      const feature = map.queryRenderedFeatures(event.point, { layers: ['editor-draft-points'] })[0]
      const index = Number(feature?.properties?.index)
      if (!Number.isInteger(index) || index < 0 || index >= draftVerticesRef.current.length) return
      event.preventDefault()
      draggingVertexRef.current = index
      map.getCanvas().style.cursor = 'grabbing'
      map.dragPan.disable()
    })

    map.on('mousemove', (event) => {
      const index = draggingVertexRef.current
      if (index === null) return
      const next = [...draftVerticesRef.current]
      next[index] = [event.lngLat.lng, event.lngLat.lat]
      draftVerticesRef.current = next
      setDraftVertices(next)
    })

    const stopDraggingVertex = () => {
      if (draggingVertexRef.current === null) return
      draggingVertexRef.current = null
      map.getCanvas().style.cursor = ''
      map.dragPan.enable()
    }
    map.on('mouseup', stopDraggingVertex)
    map.on('mouseout', stopDraggingVertex)
    map.on('mouseenter', 'editor-draft-points', () => {
      if (draggingVertexRef.current === null) map.getCanvas().style.cursor = 'grab'
    })
    map.on('mouseleave', 'editor-draft-points', () => {
      if (draggingVertexRef.current === null) map.getCanvas().style.cursor = ''
    })

    /*
     * Сохраняем карту
     */

    mapRef.current = map

    /*
     * Удаляем карту при размонтировании
     */

    return () => {
      map.remove()

      mapRef.current = null
    }
  }, [])

  /*
   * =====================================================
   * 3. ОБНОВЛЕНИЕ СОХРАНЁННЫХ ПОЛИГОНОВ НА КАРТЕ
   * =====================================================
   */

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setInterval> | undefined

    const update = () => {
      if (cancelled) return false
      const map = mapRef.current
      if (!map) return false
      const source = map.getSource('saved-polygons') as maplibregl.GeoJSONSource | undefined
      if (!source) return false

      const features: Feature<Polygon>[] = savedGeometry.flatMap((sector) => {
        const status = sectorsRef.current.find((item) => item.sector_id === Number(sector.id))
        const beachType = status?.beach_type ?? sector.beach_type ?? 'sand'
        if (surfaceFilter !== 'all' && beachType !== surfaceFilter) return []
        if (status && !statusFilters.includes(status.status_color)) return []
        const raw: any = sector.geometry
        if (!raw) return []
        let geometry = raw
        if (typeof geometry === 'string') {
          try { geometry = JSON.parse(geometry) } catch { return [] }
        }
        if (geometry?.type === 'Feature') geometry = geometry.geometry
        if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return []
        return [{
          type: 'Feature',
          properties: {
            sector_id: sector.id,
            name: sector.name,
            status_color: status?.status_color ?? 'gray',
            algae: status?.algae ?? null,
            waves: status?.waves ?? null,
            jellyfish: status?.jellyfish ?? null,
            latitude: status?.latitude ?? sector.latitude,
            longitude: status?.longitude ?? sector.longitude,
            beach_type: status?.beach_type ?? sector.beach_type ?? 'sand',
          },
          geometry,
        } as Feature<Polygon>]
      })
      source.setData({ type: 'FeatureCollection', features })

      // Для обзорного масштаба создаём ровно одну точку в центре каждого сектора.
      const overviewFeatures = features.map((feature) => {
        const ring = feature.geometry.coordinates[0] ?? []
        const vertices = ring.slice(0, -1)
        let twiceArea = 0
        let centerX = 0
        let centerY = 0
        for (let i = 0; i < vertices.length; i++) {
          const [x1, y1] = vertices[i]
          const [x2, y2] = vertices[(i + 1) % vertices.length]
          const cross = x1 * y2 - x2 * y1
          twiceArea += cross
          centerX += (x1 + x2) * cross
          centerY += (y1 + y2) * cross
        }
        const center = Math.abs(twiceArea) > 1e-12
          ? [centerX / (3 * twiceArea), centerY / (3 * twiceArea)]
          : vertices.reduce((sum, point) => [sum[0] + point[0] / vertices.length, sum[1] + point[1] / vertices.length], [0, 0])
        return {
          type: 'Feature' as const,
          properties: feature.properties,
          geometry: { type: 'Point' as const, coordinates: center },
        }
      })
      const overviewSource = map.getSource('sector-overview') as maplibregl.GeoJSONSource | undefined
      overviewSource?.setData({ type: 'FeatureCollection', features: overviewFeatures })
      console.log(`Загружено полигонов на карту: ${features.length}`)
      return true
    }

    if (!update()) {
      timer = setInterval(() => {
        attempts += 1
        if (update() || attempts >= 100) {
          if (timer) clearInterval(timer)
          if (attempts >= 100) console.warn('Не удалось найти источник saved-polygons на карте.')
        }
      }, 100)
    }

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [savedGeometry, sectors, surfaceFilter, statusFilters])

  // При первом открытии показываем весь пляжный участок по геометрии секторов.
  // Небольшой дополнительный отступ оставляет за краями пляжей часть побережья.
  useEffect(() => {
    if (initialMapViewSetRef.current || savedGeometry.length === 0) return

    const map = mapRef.current
    if (!map) return

    const fitInitialView = () => {
      if (initialMapViewSetRef.current || !mapRef.current) return

      const bounds = new maplibregl.LngLatBounds()
      const extendCoordinates = (value: unknown): void => {
        if (
          Array.isArray(value) &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number'
        ) {
          bounds.extend([value[0], value[1]])
        } else if (Array.isArray(value)) {
          value.forEach(extendCoordinates)
        }
      }

      savedGeometry.forEach((sector) => {
        let geometry: any = sector.geometry
        if (typeof geometry === 'string') {
          try {
            geometry = JSON.parse(geometry)
          } catch {
            return
          }
        }
        if (geometry?.type === 'Feature') geometry = geometry.geometry
        if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
          extendCoordinates(geometry.coordinates)
        }
      })

      if (bounds.isEmpty()) return

      initialMapViewSetRef.current = true
      map.fitBounds(bounds, {
        padding: { top: 70, bottom: 90, left: 70, right: 70 },
        maxZoom: 10.8,
        duration: 0,
      })
    }

    if (map.isStyleLoaded()) {
      fitInitialView()
    } else {
      map.once('load', fitInitialView)
    }

    return () => {
      map.off('load', fitInitialView)
    }
  }, [savedGeometry])

  useEffect(() => {
    drawingModeRef.current = drawingMode
  }, [drawingMode])

  useEffect(() => {
    draftVerticesRef.current = draftVertices
    const map = mapRef.current
    if (!map || !map.getSource('editor-draft')) return
    const canShowEditableDraft = editorMode === 'new' || editorMode === 'editing'
    const features: GeoJSON.Feature[] = []
    if (canShowEditableDraft) {
      draftVertices.forEach((coordinates, index) => {
        features.push({ type: 'Feature', properties: { index }, geometry: { type: 'Point', coordinates } })
      })
      if (draftVertices.length >= 3) {
        const ring = [...draftVertices, draftVertices[0]]
        features.push({ type: 'Feature', properties: { kind: 'polygon' }, geometry: { type: 'Polygon', coordinates: [ring] } })
      } else if (draftVertices.length >= 2) {
        features.push({ type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: draftVertices } })
      }
    }
    ;(map.getSource('editor-draft') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }, [draftVertices, editorMode])

  async function refreshSectorStatuses() {
    const { data, error } = await supabase
      .rpc('get_sector_current_status')
    if (error) throw error
    const normalized: Sector[] = (data ?? []).map((row: any) => ({
      sector_id: Number(row.sector_id),
      name: row['Имя'] ?? row.name ?? 'Без названия',
      access_name: row.access_name ?? null,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      report_id: row.report_id != null ? Number(row.report_id) : null,
      algae: row.algae ?? null,
      waves: row.waves ?? null,
      jellyfish: row.jellyfish ?? null,
      status_color: row.status_color ?? 'gray',
      main_icon: row.main_icon ?? null,
      last_updated: row.last_updated ?? null,
      confirmation_count: Number(row.confirmation_count ?? 0),
      algae_none_count: Number(row.algae_none_count ?? 0),
      algae_low_count: Number(row.algae_low_count ?? 0),
      algae_high_count: Number(row.algae_high_count ?? 0),
      waves_none_count: Number(row.waves_none_count ?? 0),
      waves_medium_count: Number(row.waves_medium_count ?? 0),
      waves_high_count: Number(row.waves_high_count ?? 0),
      jellyfish_none_count: Number(row.jellyfish_none_count ?? 0),
      jellyfish_low_count: Number(row.jellyfish_low_count ?? 0),
      jellyfish_high_count: Number(row.jellyfish_high_count ?? 0),
      beach_type: row.beach_type === 'pebble' ? 'pebble' : 'sand',
    }))
    sectorsRef.current = normalized
    setSectors(normalized)
    setSelectedSector((current) => current
      ? normalized.find((item) => item.sector_id === current.sector_id) ?? current
      : null)
  }

  async function loadMySectorActivity(sectorId: number) {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id
    if (!userId) { setIsAuthenticated(false); setMyReport(null); setMyConfirmedReportId(null); setCooldownUntil(null); return }
    setIsAuthenticated(true)
    const { data, error } = await supabase.rpc('get_my_sector_activity', { p_sector_id: sectorId })
    if (error) throw error
    const own = data?.[0] ?? null
    setMyReport(own?.report_id ? {
      id: Number(own.report_id),
      algae: own.algae,
      waves: own.waves,
      jellyfish: own.jellyfish,
      created_at: own.created_at,
    } : null)
    const until = own?.created_at ? new Date(own.created_at).getTime() + 5 * 60 * 1000 : 0
    setCooldownUntil(until > Date.now() ? until : null)
    setMyConfirmedReportId(own?.has_confirmed_current_report && sectorsRef.current.find(s => s.sector_id === sectorId)?.report_id
      ? sectorsRef.current.find(s => s.sector_id === sectorId)!.report_id
      : null)
  }

  useEffect(() => {
    if (!selectedSector) { setReportMode('view'); setMyReport(null); setMyConfirmedReportId(null); return }
    setReportMode('view'); setReportMessage('')
    setReportAlgae(selectedSector.algae ?? 'none')
    setReportWaves(selectedSector.waves ?? 'none')
    setReportJellyfish(selectedSector.jellyfish ?? 'none')
    void loadMySectorActivity(selectedSector.sector_id).catch(error => console.error('Не удалось загрузить ваши действия:', error))
  }, [selectedSector?.sector_id, selectedSector?.report_id])

  useEffect(() => {
    if (!cooldownUntil) { setCooldownText(''); return }
    const update = () => {
      const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      if (!seconds) { setCooldownUntil(null); setCooldownText(''); return }
      setCooldownText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  async function handleSubmitReport() {
    if (!selectedSector || reportBusy || cooldownUntil) return
    setReviewReportOpen(false)
    setReportBusy(true); setReportMessage('')
    try {
      const { error } = await supabase.rpc('submit_beach_report', { p_sector_id: selectedSector.sector_id, p_algae: reportAlgae, p_waves: reportWaves, p_jellyfish: reportJellyfish })
      if (error) {
        if (error.message.includes('Report cooldown')) throw new Error('Повторно отправить отчёт по этому сектору можно через 5 минут после предыдущего.')
        if (error.message.includes('Report rate limit')) throw new Error('Достигнут лимит: не более 5 отчётов в час.')
        throw error
      }
      await refreshSectorStatuses()
      await loadMySectorActivity(selectedSector.sector_id)
      setReportMode('view'); setReviewReportOpen(false); setReportMessage('Спасибо за ваш отчёт!')
    } catch (e) { setReportMessage(e instanceof Error ? e.message : 'Не удалось отправить отчёт.') }
    finally { setReportBusy(false) }
  }

  async function handleConfirmReport() {
    if (!selectedSector || reportBusy || hasDraftChanges || cooldownUntil) return
    setReportBusy(true); setReportMessage('')
    try {
      const { error } = await supabase.rpc('submit_beach_report', {
        p_sector_id: selectedSector.sector_id,
        p_algae: selectedSector.algae ?? 'none',
        p_waves: selectedSector.waves ?? 'none',
        p_jellyfish: selectedSector.jellyfish ?? 'none',
      })
      if (error) {
        if (error.message.includes('Report cooldown')) throw new Error('Повторно отправить отчёт по этому сектору можно через 5 минут после предыдущего.')
        if (error.message.includes('Report rate limit')) throw new Error('Достигнут лимит: не более 5 отчётов в час.')
        throw error
      }
      await refreshSectorStatuses()
      await loadMySectorActivity(selectedSector.sector_id)
      setReportMessage('Спасибо! Вы подтвердили текущее состояние пляжа.')
    } catch (e) { setReportMessage(e instanceof Error ? e.message : 'Не удалось подтвердить состояние.') }
    finally { setReportBusy(false) }
  }

  async function handleAdminLogin() {
    setAuthBusy(true); setAdminMessage('')
    try { await signInBeachMapAdmin(email, password); setAdmin(true); setPassword(''); setAdminMessage('Вход выполнен. Права администратора подтверждены.') }
    catch (e) { setAdmin(false); setAdminMessage(e instanceof Error ? e.message : 'Не удалось войти') }
    finally { setAuthBusy(false) }
  }

  async function handleAdminLogout() {
    await signOutBeachMapAdmin(); setAdmin(false); setEditorMode('idle'); setSelectedSavedSector(null); setEditingId(null); setDrawingMode(false); setDraftVertices([]); draftVerticesRef.current = []; setAdminMessage('Вы вышли из аккаунта администратора.')
  }

  function resetEditorToList(message = '') {
    setEditorMode('idle')
    setDrawingMode(false)
    setEditingId(null)
    setSelectedSavedSector(null)
    setDraftVertices([])
    draftVerticesRef.current = []
    setSectorName('')
    setAccessName('')
    setAdminMessage(message)
  }

  function beginNewSector() {
    setEditorMode('new')
    setSelectedSavedSector(null)
    setEditingId(null)
    setSectorName('')
    setAccessName('')
    setBeachType('sand')
    setDraftVertices([])
    draftVerticesRef.current = []
    setDrawingMode(true)
    setAdminMessage('Новый сектор: нажимайте на карту, чтобы поставить вершины.')
  }

  function selectSavedSector(sector: SavedSector) {
    setSelectedSavedSector(sector)
    setEditorMode('selected')
    setEditingId(sector.id)
    setSectorName(sector.name)
    setAccessName(sector.access_name ?? '')
    setBeachType(sector.beach_type ?? 'sand')
    setDrawingMode(false)
    setDraftVertices([])
    draftVerticesRef.current = []
    setAdminMessage(`Выбран сектор #${sector.id}. Нажмите «Редактировать», чтобы перемещать вершины.`)
    const raw: any = sector.geometry
    const geometry = raw?.type === 'Feature' ? raw.geometry : raw
    const coords = geometry?.coordinates?.[0] as Position[] | undefined
    const map = mapRef.current
    if (map && coords?.length) {
      const first = coords[0]
      map.flyTo({ center: [Number(first[0]), Number(first[1])], zoom: Math.max(map.getZoom(), 14) })
    }
  }

  function beginEditingSelected() {
    const sector = selectedSavedSector
    if (!sector) return
    const raw: any = sector.geometry
    const geometry = raw?.type === 'Feature' ? raw.geometry : raw
    if (geometry?.type !== 'Polygon' || !geometry.coordinates?.[0]) { setAdminMessage('У этого сектора нет сохранённого полигона.'); return }
    const ring = geometry.coordinates[0] as Position[]
    const openRing = ring.length > 1 ? ring.slice(0, -1) : ring
    const vertices: [number, number][] = openRing.map((pos) => [Number(pos[0]), Number(pos[1])])
    setDraftVertices(vertices)
    draftVerticesRef.current = vertices
    setEditingId(sector.id)
    setEditorMode('editing')
    setDrawingMode(false)
    setAdminMessage(`Редактируется сектор #${sector.id}. Перетаскивайте белые вершины.`)
  }

  async function handleSaveSector() {
    if (!admin) { setAdminMessage('Войдите как администратор.'); return }
    if (!sectorName.trim()) { setAdminMessage('Введите название сектора.'); return }
    if (draftVertices.length < 3) { setAdminMessage('Для полигона нужно минимум 3 точки.'); return }
    const ring: [number, number][] = [...draftVertices, draftVertices[0]]
    setSaving(true); setAdminMessage('Сохраняю полигон в Supabase…')
    try {
      const polygon: Polygon = { type: 'Polygon', coordinates: [ring] }
      const id = await saveBeachSector({ id: editorMode === 'editing' ? editingId : null, name: sectorName.trim(), accessName: accessName.trim() || null, beachType, polygon })
      const geometry = await loadActiveSectorGeometries()
      setSavedGeometry(geometry)
      resetEditorToList(`Сектор #${id} сохранён. Вы вернулись к списку секторов.`)
    } catch (e) { setAdminMessage(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  async function handleDeleteSector() {
    if (editorMode === 'new') {
      resetEditorToList('Создание нового сектора отменено.')
      return
    }
    const sector = selectedSavedSector
    if (!sector || !admin) return
    if (!window.confirm(`Удалить сектор «${sector.name}» (#${sector.id})? Он будет деактивирован и исчезнет с публичной карты.`)) return
    setSaving(true)
    try {
      await deactivateBeachSector(sector.id)
      const geometry = await loadActiveSectorGeometries()
      setSavedGeometry(geometry)
      resetEditorToList(`Сектор #${sector.id} удалён с публичной карты.`)
    } catch (e) { setAdminMessage(e instanceof Error ? e.message : 'Не удалось удалить сектор') }
    finally { setSaving(false) }
  }

  function exportDraftGeoJSON() {
    let features: any[] = []
    if ((editorMode === 'new' || editorMode === 'editing') && draftVertices.length >= 3) {
      const ring = [...draftVertices, draftVertices[0]]
      features = [{ type: 'Feature', properties: { name: sectorName || 'Новый сектор', id: editingId }, geometry: { type: 'Polygon', coordinates: [ring] } }]
    } else {
      features = savedGeometry.map((sector: any) => ({
        type: 'Feature',
        properties: { id: sector.id, name: sector.name, access_name: sector.access_name },
        geometry: typeof sector.geometry === 'string' ? JSON.parse(sector.geometry) : sector.geometry,
      }))
    }
    if (!features.length) { window.alert('Нет полигонов для экспорта.'); return }
    const geojson = { type: 'FeatureCollection', features }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'new-beach-sector.geojson'
    link.click()
    URL.revokeObjectURL(url)
  }

  /*
   * =====================================================
   * 4. ИНТЕРФЕЙС
   * =====================================================
   */

  return (
    <div className="app">

      {isAdminRoute && (
        <div className="editor-toolbar">
          <button onClick={() => { if (editorOpen) resetEditorToList(); setEditorOpen(!editorOpen); setDrawingMode(false) }}> {editorOpen ? 'Закрыть редактор' : 'Редактор секторов'} </button>
          {editorOpen && <div className="editor-panel">
            {!admin ? <>
              <strong>Вход администратора</strong>
              <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
              <label>Пароль<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
              <button onClick={() => void handleAdminLogin()} disabled={authBusy}>{authBusy ? 'Входим…' : 'Войти'}</button>
              <small>Рисование и сохранение доступны только аккаунту, добавленному в beach_map_admins.</small>
            </> : <>
              <div className="editor-admin-row"><strong>Редактор секторов</strong><button onClick={() => void handleAdminLogout()}>Выйти</button></div>
              {editorMode === 'idle' && <>
                <button onClick={beginNewSector}>Новый сектор</button>
                <button onClick={exportDraftGeoJSON}>Скачать GeoJSON</button>
                <strong>Сохранённые секторы</strong>
                {savedGeometry.length === 0 && <small>Пока нет секторов с геометрией.</small>}
                <div className="saved-sector-list">{savedGeometry.map(sector => <button key={sector.id} onClick={() => selectSavedSector(sector)}>#{sector.id} · {sector.name}</button>)}</div>
              </>}
              {editorMode === 'new' && <>
                <strong>Новый сектор</strong>
                <label>Название сектора *<input value={sectorName} onChange={e => setSectorName(e.target.value)} placeholder="Например, Центральный пляж" required /></label>
                <label>Название проезда (необязательно)<input value={accessName} onChange={e => setAccessName(e.target.value)} placeholder="Например, Центральный" /></label>
                <label>Тип пляжа<select value={beachType} onChange={e => setBeachType(e.target.value as 'sand' | 'pebble')}><option value="sand">Песчаный</option><option value="pebble">Галечный</option></select></label>
                <p>Точек: {draftVertices.length}. Нажимайте на карту, чтобы добавлять вершины.</p>
                <button onClick={() => setDrawingMode(!drawingMode)} className={drawingMode ? 'active' : ''}>{drawingMode ? 'Добавление точек включено' : 'Добавлять точки'}</button>
                <button onClick={() => setDraftVertices(v => { const next = v.slice(0, -1); draftVerticesRef.current = next; return next })} disabled={!draftVertices.length}>Убрать последнюю точку</button>
                <button onClick={() => void handleSaveSector()} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить сектор'}</button>
                <button onClick={() => handleDeleteSector()} disabled={saving}>Удалить сектор</button>
              </>}
              {editorMode === 'selected' && selectedSavedSector && <>
                <strong>Выбран сектор #{selectedSavedSector.id}</strong>
                <p>{selectedSavedSector.name}</p>
                <button onClick={beginEditingSelected}>Редактировать</button>
                <button onClick={() => handleDeleteSector()} disabled={saving}>Удалить сектор</button>
                <button onClick={() => resetEditorToList()}>Назад к списку</button>
              </>}
              {editorMode === 'editing' && <>
                <strong>Редактирование сектора #{editingId}</strong>
                <label>Название сектора *<input value={sectorName} onChange={e => setSectorName(e.target.value)} required /></label>
                <label>Название проезда (необязательно)<input value={accessName} onChange={e => setAccessName(e.target.value)} /></label>
                <label>Тип пляжа<select value={beachType} onChange={e => setBeachType(e.target.value as 'sand' | 'pebble')}><option value="sand">Песчаный</option><option value="pebble">Галечный</option></select></label>
                <p>Точек: {draftVertices.length}. Перетаскивайте белые вершины для изменения границ.</p>
                <button onClick={() => void handleSaveSector()} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
                <button onClick={() => handleDeleteSector()} disabled={saving}>Удалить сектор</button>
                <button onClick={() => selectSavedSector(selectedSavedSector!)} disabled={saving}>Отмена редактирования</button>
              </>}
            </>}
            {adminMessage && <p className="editor-message" role="status">{adminMessage}</p>}
          </div>}
        </div>
      )}
      {!isAdminRoute && (
        <div className="map-brand" aria-label="Куда купаться? Пляжи Анапы">
          <h1>Куда купаться?</h1>
          <span>Пляжи Анапы сегодня</span>
        </div>
      )}
      <main
        className="map-container"
        ref={mapContainer}
      />

      {selectedSector && (
        <div className="sector-panel" role="dialog" aria-label={'Состояние пляжа: ' + selectedSector.name}>
          <div className="sector-panel-scroll">
            <div className="sector-panel-content">
          {reportMode === 'view' ? <>
            <div
              className="beach-photo"
              role="img"
              aria-label={selectedSector.status_color === 'gray' ? 'Море, актуальных данных о пляже нет' : 'Фотография пляжа с учётом его типа и текущего состояния'}
              style={{ backgroundImage: `url("${getBeachPhotoPath(selectedSector)}")` }}
            >
              <div className="sector-panel-header">
                <div className="sector-panel-title">
                  <h2>{selectedSector.name}</h2>
                  <div className="sector-access">{selectedSector.beach_type === 'pebble' ? 'Галечный пляж' : 'Песчаный пляж'}</div>
                  {selectedSector.access_name && <div className="sector-access">{selectedSector.access_name}</div>}
                  <div className={'status status-' + selectedSector.status_color}>{getStatusText(selectedSector.status_color)}</div>
                </div>
                <button className="close-button" aria-label="Закрыть карточку" onClick={() => setSelectedSector(null)}>×</button>
              </div>
              <div className="beach-photo-caption"><span>{selectedSector.confirmation_count > 0 ? 'Данные ' + selectedSector.confirmation_count + ' участников' : 'Пока нет отчётов'}{selectedSector.last_updated ? ' · обновлено в ' + new Date(selectedSector.last_updated).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : ''}</span></div>
            </div>
            {(() => {
              const conditions = [
                {key:'algae',icon:<ConditionIcon kind="algae" />,title:'Водоросли',draft:reportAlgae,set:setReportAlgae,options:[{value:'none',label:'Нет водорослей',count:selectedSector.algae_none_count,tone:'green'},{value:'low',label:'Мало водорослей',count:selectedSector.algae_low_count,tone:'yellow'},{value:'high',label:'Много водорослей',count:selectedSector.algae_high_count,tone:'red'}]},
                {key:'waves',icon:<ConditionIcon kind="waves" />,title:'Волны',draft:reportWaves,set:setReportWaves,options:[{value:'none',label:'Нет волн',count:selectedSector.waves_none_count,tone:'green'},{value:'medium',label:'Средние волны',count:selectedSector.waves_medium_count,tone:'yellow'},{value:'high',label:'Большие волны',count:selectedSector.waves_high_count,tone:'red'}]},
                {key:'jellyfish',icon:<ConditionIcon kind="jellyfish" />,title:'Медузы',draft:reportJellyfish,set:setReportJellyfish,options:[{value:'none',label:'Нет медуз',count:selectedSector.jellyfish_none_count,tone:'green'},{value:'low',label:'Мало медуз',count:selectedSector.jellyfish_low_count,tone:'yellow'},{value:'high',label:'Много медуз',count:selectedSector.jellyfish_high_count,tone:'red'}]},
              ]
              const active = conditions.find(item => expandedConditions.includes(item.key))
              const activeTone = active?.options.find(option => option.value === active.draft)?.tone ?? 'green'
              return <div className={'condition-selector' + (active ? ' has-expanded tone-' + activeTone : '')}>
                <div className="condition-circles">
                  {conditions.map(item => {
                    const chosen = item.options.find(option => option.value === item.draft) ?? item.options[0]
                    const expanded = active?.key === item.key
                    return <button type="button" key={item.key} className={'condition-circle condition-' + chosen.tone + (expanded ? ' active' : '')} aria-expanded={!!expanded} onClick={() => setExpandedConditions(current => current.includes(item.key) ? [] : [item.key])}>
                      <span className="condition-circle-icon">{item.icon}</span><strong>{chosen.label}</strong><span className="condition-circle-arrow">{expanded ? '⌃' : '⌄'}</span>
                    </button>
                  })}
                </div>
                {active && <div className="condition-detail condition-detail-attached" >
                  <div className="condition-detail-content">
                    <p className="condition-detail-hint">Вы можете изменить данные о состоянии пляжа и отправить нам обновление.</p>
                    <div className="condition-detail-options">{active.options.map(option => <button type="button" key={option.value} className={'condition-detail-option tone-' + option.tone + (active.draft === option.value ? ' selected' : '')} aria-pressed={active.draft === option.value} onClick={() => active.set(option.value)}><span>{option.label}</span><b>Подтвердили: {option.count}{isAuthenticated && !myReport && active.draft === option.value ? ' · Ваш голос: +1' : ''}</b></button>)}</div>
                  </div>
                </div>}
              </div>
            })()}
            <button className="report-confirm primary-action" onClick={() => void handleConfirmReport()} disabled={reportBusy || hasDraftChanges || !!cooldownUntil}>{reportBusy ? 'Отправляем…' : 'Подтвердить состояние'}</button>
            <button className={'report-edit-action' + (hasDraftChanges ? ' changed' : '')} onClick={() => setReviewReportOpen(true)} disabled={reportBusy || !hasDraftChanges || !!cooldownUntil}>{reportBusy ? 'Сохраняем…' : 'Отправить изменения'}</button>
            {cooldownUntil && <p className="cooldown-message">Новый отчёт можно отправить через {cooldownText || '5:00'}.</p>}
            {reportMessage && <p className="report-message" role="status">{reportMessage}</p>}
          </> : <div className="report-form">
            <div className="edit-mode-heading"><h3>{myReport ? 'Изменить мой отчёт' : 'Сообщить о состоянии'}</h3><button type="button" className="text-action" onClick={() => { setReportMode('view'); setReportMessage('') }}>Назад</button></div>
            <p className="report-hint">Как сейчас выглядит море?</p>
            <div className="report-group"><div className="report-group-title">🌿 Водоросли</div><div className="report-options">{[{value:'none',label:'Нет',icon:'🌊'},{value:'low',label:'Мало',icon:'🌿'},{value:'high',label:'Много',icon:'🌱'}].map(o => <button key={o.value} type="button" className={reportAlgae === o.value ? 'report-option selected' : 'report-option'} aria-pressed={reportAlgae === o.value} onClick={() => setReportAlgae(o.value)}><span className="report-option-image">{o.icon}</span><span>{o.label}</span>{reportAlgae === o.value && <span className="report-option-check">✓</span>}</button>)}</div></div>
            <div className="report-group"><div className="report-group-title">🌊 Волны</div><div className="report-options">{[{value:'none',label:'Нет',icon:'🏖️'},{value:'medium',label:'Средние',icon:'🌊'},{value:'high',label:'Большие',icon:'🌊'}].map(o => <button key={o.value} type="button" className={reportWaves === o.value ? 'report-option selected' : 'report-option'} aria-pressed={reportWaves === o.value} onClick={() => setReportWaves(o.value)}><span className="report-option-image">{o.icon}</span><span>{o.label}</span>{reportWaves === o.value && <span className="report-option-check">✓</span>}</button>)}</div></div>
            <div className="report-group"><div className="report-group-title">🪼 Медузы</div><div className="report-options">{[{value:'none',label:'Нет',icon:'🌊'},{value:'low',label:'Мало',icon:'🪼'},{value:'high',label:'Много',icon:'🪼'}].map(o => <button key={o.value} type="button" className={reportJellyfish === o.value ? 'report-option selected' : 'report-option'} aria-pressed={reportJellyfish === o.value} onClick={() => setReportJellyfish(o.value)}><span className="report-option-image">{o.icon}</span><span>{o.label}</span>{reportJellyfish === o.value && <span className="report-option-check">✓</span>}</button>)}</div></div>
            <button className="report-submit" onClick={() => void handleSubmitReport()} disabled={reportBusy || !!cooldownUntil}>{reportBusy ? 'Сохраняем…' : myReport ? 'Изменить мой отчёт' : 'Отправить отчёт'}</button>
            {cooldownUntil && <p className="cooldown-message">Повторно отправить отчёт можно через {cooldownText || '5:00'}.</p>}
            {reportMessage && <p className="report-message" role="status">{reportMessage}</p>}
          </div>}
            </div>
          </div>
        </div>
      )}
      {reviewReportOpen && selectedSector && (
        <div className="report-review-backdrop" role="presentation" onClick={() => setReviewReportOpen(false)}>
          <section className="report-review-dialog" role="dialog" aria-modal="true" aria-labelledby="report-review-title" onClick={event => event.stopPropagation()}>
            <h3 id="report-review-title">Проверьте ваш отчёт</h3>
            <p>Перед отправкой проверьте все три показателя.</p>
            {([
              { label: 'Водоросли', value: reportAlgae, original: selectedSector.algae ?? 'none', names: { none: 'Нет водорослей', low: 'Мало водорослей', high: 'Много водорослей' } },
              { label: 'Волны', value: reportWaves, original: selectedSector.waves ?? 'none', names: { none: 'Нет волн', medium: 'Средние волны', high: 'Большие волны' } },
              { label: 'Медузы', value: reportJellyfish, original: selectedSector.jellyfish ?? 'none', names: { none: 'Нет медуз', low: 'Мало медуз', high: 'Много медуз' } },
            ] as const).map(item => (
              <div className="report-review-row" key={item.label}>
                <strong>{item.label}</strong>
                <span>{item.names[item.value as keyof typeof item.names]}</span>
                <small className={item.value !== item.original ? 'is-changed' : ''}>{item.value !== item.original ? 'Изменено' : 'Без изменений'}</small>
              </div>
            ))}
            <p className="report-review-note">Все три показателя будут отправлены, включая те, которые вы не меняли.</p>
            <div className="report-review-actions">
              <button type="button" className="report-review-cancel" onClick={() => setReviewReportOpen(false)}>Отменить</button>
              <button type="button" className="report-review-confirm" disabled={reportBusy} onClick={() => void handleSubmitReport()}>{reportBusy ? 'Отправляем…' : 'Подтвердить и отправить'}</button>
            </div>
          </section>
        </div>
      )}
      {!selectedSector && <footer className={filtersOpen ? 'footer filters-open' : 'footer'}>
        {filtersOpen && <div className="footer-legend">
          {([{value:'green',label:'Отличные'},{value:'yellow',label:'Средние'},{value:'red',label:'Плохие'},{value:'gray',label:'Нет данных'}] as const).map(item => <button key={item.value} type="button" aria-pressed={statusFilters.includes(item.value)} className={statusFilters.includes(item.value) ? 'footer-filter active' : 'footer-filter'} onClick={() => setStatusFilters(current => current.includes(item.value) ? current.filter(value => value !== item.value) : [...current,item.value])}><span>{item.value==='green'?'🟢':item.value==='yellow'?'🟡':item.value==='red'?'🔴':'⚪'}</span>{item.label}</button>)}
          <div className="footer-surfaces">{([{value:'all',label:'Все пляжи'},{value:'sand',label:'Песок'},{value:'pebble',label:'Галька'}] as const).map(item => <button key={item.value} type="button" className={surfaceFilter===item.value?'active':''} onClick={() => setSurfaceFilter(item.value)}>{item.label}</button>)}</div>
          <small className={visibleSectors.length === 0 ? 'filter-results empty' : 'filter-results'}>{visibleSectors.length === 0 ? 'Подходящих пляжей нет' : `Найдено пляжей: ${visibleSectors.length}`}</small>
        </div>}
        {!filtersOpen && hasActiveFilters && <div className={visibleSectors.length === 0 ? 'filter-result-banner empty' : 'filter-result-banner'}>{visibleSectors.length === 0 ? 'Подходящих пляжей нет' : `Найдено пляжей: ${visibleSectors.length}`}</div>}
        <div className="filter-actions">
          <button type="button" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{filtersOpen ? 'Скрыть фильтр' : 'Открыть фильтр'}</button>
          {(filtersOpen || hasActiveFilters) && <button type="button" className="filter-reset" onClick={resetFilters} disabled={!hasActiveFilters}>Сбросить фильтр</button>}
        </div>
      </footer>}

    </div>
  )
}

export default App
