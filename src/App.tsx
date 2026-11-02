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

  const sectorsRef =
    useRef<Sector[]>([])

  const [sectors, setSectors] =
    useState<Sector[]>([])
  const [surfaceFilter, setSurfaceFilter] = useState<'all' | 'sand' | 'pebble'>('all')
  const [statusFilters, setStatusFilters] = useState<Array<'green' | 'yellow' | 'red' | 'gray'>>(['green','yellow','red','gray'])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [expandedConditions, setExpandedConditions] = useState<string[]>([])
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
  const [saving, setSaving] = useState(false)
  const [reportAlgae, setReportAlgae] = useState('none')
  const [reportWaves, setReportWaves] = useState('none')
  const [reportJellyfish, setReportJellyfish] = useState('none')
  const [reportBusy, setReportBusy] = useState(false)
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
    if (selectedSector.latitude && selectedSector.longitude) {
      const height = map.getCanvas().clientHeight
      map.flyTo({ center: [selectedSector.longitude, selectedSector.latitude], zoom: Math.max(map.getZoom(), 13.8), duration: 850, padding: { top: 24, bottom: Math.min(300, Math.round(height * 0.36)), left: 12, right: 12 } })
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
          .from('sector_current_status')
          .select('*')
          .order('sector_id')

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

        center: [
          37.29,
          44.96,
        ],

        zoom: 12,
      })

    map.addControl(
      new maplibregl.NavigationControl(),
      'top-right'
    )

    map.on('load', () => {
      console.log(
        'Карта MapLibre загружена'
      )

      /*
       * Источник секторов
       */

      if (!map.getSource('sectors')) {
        map.addSource(
          'sectors',
          {
            type: 'geojson',

            data: {
              type: 'FeatureCollection',

              features: [],
            },
          }
        )
      }

      map.addSource('saved-polygons', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
       map.addLayer({
        id: 'saved-polygons-fill',
        type: 'fill',
        source: 'saved-polygons',
        paint: {
          'fill-color': [
            'match', ['get', 'status_color'],
            'green', '#4CAF80',
            'yellow', '#E9B949',
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
        paint: {
          'line-color': [
            'match', ['get', 'status_color'],
            'green', '#287D52',
            'yellow', '#A87916',
            'red', '#B94B50',
            '#737D8A',
          ],
          'line-width': 1.5,
        },
      })


      // Клик по полигону открывает карточку состояния сектора.
      map.on('click', 'saved-polygons-fill', (event) => {
        if (drawingModeRef.current) return
        const feature = event.features?.[0]
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
      })
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

      // Старые точечные маркеры отключены: карта показывает только сектора-полигоны.

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
   * 3. ПЕРЕДАЁМ СЕКТОРА В MAPLIBRE
   * =====================================================
   *
   * Здесь исправлена проблема, из-за которой
   * Supabase уже отдавал сектора, но кружки
   * не появлялись на карте.
   */

  useEffect(() => {
    const map =
      mapRef.current

    if (!map) {
      console.log(
        'Карта ещё не создана'
      )

      return
    }

    const updateSource = () => {
      const source =
        map.getSource(
          'sectors'
        ) as
          | maplibregl.GeoJSONSource
          | undefined

      if (!source) {
        console.log(
          'Источник sectors ещё не создан'
        )

        return
      }

      const geojson = {
        type:
          'FeatureCollection' as const,

        features:
          sectors.map(
            (sector) => ({
              type:
                'Feature' as const,

              geometry: {
                type:
                  'Point' as const,

                coordinates: [
                  sector.longitude,
                  sector.latitude,
                ],
              },

              properties: {
                sector_id:
                  sector.sector_id,

                name:
                  sector.name,

                status_color:
                  sector.status_color,

                main_icon:
                  sector.main_icon,
              },
            })
          ),
      }

      console.log(
        'Обновляем точки на карте:',
        geojson.features.length
      )

      source.setData(
        geojson
      )
    }

    /*
     * Если источник уже существует,
     * обновляем сразу.
     */

    if (
      map.getSource(
        'sectors'
      )
    ) {
      updateSource()

      return
    }

    /*
     * Если карта ещё не успела
     * создать источник — ждём load.
     */

    const handleLoad =
      () => {
        updateSource()
      }

    map.once(
      'load',
      handleLoad
    )

    return () => {
      map.off(
        'load',
        handleLoad
      )
    }
  }, [sectors])

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
            latitude: status?.latitude ?? sector.latitude,
            longitude: status?.longitude ?? sector.longitude,
            beach_type: status?.beach_type ?? sector.beach_type ?? 'sand',
          },
          geometry,
        } as Feature<Polygon>]
      })
      source.setData({ type: 'FeatureCollection', features })
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
      .from('sector_current_status')
      .select('*')
      .order('sector_id')
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
    if (!userId) { setMyReport(null); setMyConfirmedReportId(null); setCooldownUntil(null); return }
    const { data: ownReports, error: ownError } = await supabase.from('reports')
      .select('id, algae, waves, jellyfish, created_at').eq('sector_id', sectorId).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1)
    if (ownError) throw ownError
    const own = ownReports?.[0] ?? null
    setMyReport(own ? { id: Number(own.id), algae: own.algae, waves: own.waves, jellyfish: own.jellyfish, created_at: own.created_at } : null)
    const until = own ? new Date(own.created_at).getTime() + 5 * 60 * 1000 : 0
    setCooldownUntil(until > Date.now() ? until : null)
    const currentReportId = sectorsRef.current.find(s => s.sector_id === sectorId)?.report_id
    if (currentReportId) {
      const { data, error } = await supabase.from('confirmations').select('id')
        .eq('report_id', currentReportId).eq('user_id', userId).limit(1)
      if (error) throw error
      setMyConfirmedReportId(data?.length ? currentReportId : null)
    } else setMyConfirmedReportId(null)
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
      setReportMode('view'); setReportMessage('Спасибо за ваш отчёт!')
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

      <header className="header">

        <h1>
          Куда купаться?
        </h1>

        <div className="sector-count">
          Секторов: {sectors.length}
        </div>

      </header>
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
      <main
        className="map-container"
        ref={mapContainer}
      />

      {selectedSector && (
        <div className="sector-panel" role="dialog" aria-label={'Состояние пляжа: ' + selectedSector.name}>
          {reportMode === 'view' ? <>
            <div className="beach-photo" role="img" aria-label="Иллюстрация морского пляжа">
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
                    <div className="condition-detail-title">{active.title}</div>
                    <p className="condition-detail-hint">Вы можете изменить данные о состоянии пляжа и отправить нам обновление.</p>
                    <div className="condition-detail-options">{active.options.map(option => <button type="button" key={option.value} className={'condition-detail-option tone-' + option.tone + (active.draft === option.value ? ' selected' : '')} aria-pressed={active.draft === option.value} onClick={() => active.set(option.value)}><span>{option.label}</span><b>{option.count}</b></button>)}</div>
                  </div>
                </div>}
              </div>
            })()}
            <button className="report-confirm primary-action" onClick={() => void handleConfirmReport()} disabled={reportBusy || hasDraftChanges || !!cooldownUntil}>{reportBusy ? 'Отправляем…' : 'Подтвердить состояние'}</button>
            <button className={'report-edit-action' + (hasDraftChanges ? ' changed' : '')} onClick={() => void handleSubmitReport()} disabled={reportBusy || !hasDraftChanges || !!cooldownUntil}>{reportBusy ? 'Сохраняем…' : 'Отправить изменения'}</button>
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
      )}
      {!selectedSector && <footer className={filtersOpen ? 'footer filters-open' : 'footer'}>
        {filtersOpen && <div className="footer-legend">
          {([{value:'green',label:'Отличные'},{value:'yellow',label:'Средние'},{value:'red',label:'Плохие'},{value:'gray',label:'Нет данных'}] as const).map(item => <button key={item.value} type="button" aria-pressed={statusFilters.includes(item.value)} className={statusFilters.includes(item.value) ? 'footer-filter active' : 'footer-filter'} onClick={() => setStatusFilters(current => current.includes(item.value) ? current.filter(value => value !== item.value) : [...current,item.value])}><span>{item.value==='green'?'🟢':item.value==='yellow'?'🟡':item.value==='red'?'🔴':'⚪'}</span>{item.label}</button>)}
          <div className="footer-surfaces">{([{value:'all',label:'Все пляжи'},{value:'sand',label:'Песок'},{value:'pebble',label:'Галька'}] as const).map(item => <button key={item.value} type="button" className={surfaceFilter===item.value?'active':''} onClick={() => setSurfaceFilter(item.value)}>{item.label}</button>)}</div>
          <small>{visibleSectors.length} из {sectors.length} секторов</small>
        </div>}
        <button type="button" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{filtersOpen ? 'Скрыть фильтры ⌄' : '☷ Фильтр'}</button>
      </footer>}

    </div>
  )
}

export default App
