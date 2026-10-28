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
  confirmations_count: number
}

function getStatusText(status: string) {
  switch (status) {
    case 'green':
      return 'Хорошие условия'

    case 'yellow':
      return 'Есть нюансы'

    case 'red':
      return 'Неблагоприятные условия'

    default:
      return 'Нет актуальных данных'
  }
}

function getLevelText(value: string | null) {
  switch (value) {
    case 'none':
      return 'нет'

    case 'low':
      return 'мало'

    case 'medium':
      return 'средние'

    case 'high':
      return 'много'

    default:
      return 'нет данных'
  }
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

  const [selectedSector, setSelectedSector] =
    useState<Sector | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
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
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savedGeometry, setSavedGeometry] = useState<SavedSector[]>([])
  const [saving, setSaving] = useState(false)

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

          confirmations_count:
            Number(
              row.confirmations_count ?? 0
            ),
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
            confirmations_count: 0,
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
        const raw: any = sector.geometry
        if (!raw) return []
        let geometry = raw
        if (typeof geometry === 'string') {
          try { geometry = JSON.parse(geometry) } catch { return [] }
        }
        if (geometry?.type === 'Feature') geometry = geometry.geometry
        if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return []
        const status = sectorsRef.current.find((item) => item.sector_id === Number(sector.id))
        return [{
          type: 'Feature',
          properties: {
            sector_id: sector.id,
            name: sector.name,
            status_color: status?.status_color ?? 'gray',
            latitude: status?.latitude ?? sector.latitude,
            longitude: status?.longitude ?? sector.longitude,
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
  }, [savedGeometry, sectors])

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
      const id = await saveBeachSector({ id: editorMode === 'editing' ? editingId : null, name: sectorName.trim(), accessName: accessName.trim() || null, polygon })
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
              <p>Точек: {draftVertices.length}. Перетаскивайте белые вершины для изменения границ.</p>
              <button onClick={() => void handleSaveSector()} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
              <button onClick={() => handleDeleteSector()} disabled={saving}>Удалить сектор</button>
              <button onClick={() => selectSavedSector(selectedSavedSector!)} disabled={saving}>Отмена редактирования</button>
            </>}
          </>}
          {adminMessage && <p className="editor-message" role="status">{adminMessage}</p>}
        </div>}
      </div>

      <main
        className="map-container"
        ref={mapContainer}
      />

      {selectedSector && (
        <div className="sector-panel">

          <button
            className="close-button"
            onClick={() =>
              setSelectedSector(
                null
              )
            }
          >
            ×
          </button>

          <h2>
            {selectedSector.name}
          </h2>

          {selectedSector.access_name && (
            <div className="sector-access">
              📍{' '}
              {
                selectedSector.access_name
              }
            </div>
          )}

          <div
            className={`status status-${selectedSector.status_color}`}
          >

            {selectedSector.status_color ===
              'green' && '🟢 '}

            {selectedSector.status_color ===
              'yellow' && '🟡 '}

            {selectedSector.status_color ===
              'red' && '🔴 '}

            {selectedSector.status_color ===
              'gray' && '⚪ '}

            {getStatusText(
              selectedSector.status_color
            )}

          </div>

          <div className="conditions">

            <div className="condition">

              <span>
                🌿 Водоросли
              </span>

              <strong>
                {getLevelText(
                  selectedSector.algae
                )}
              </strong>

            </div>

            <div className="condition">

              <span>
                🌊 Волны
              </span>

              <strong>
                {getLevelText(
                  selectedSector.waves
                )}
              </strong>

            </div>

            <div className="condition">

              <span>
                🪼 Медузы
              </span>

              <strong>
                {getLevelText(
                  selectedSector.jellyfish
                )}
              </strong>

            </div>

          </div>

          <div className="sector-info">

            <div>
              Подтверждений:{' '}
              {
                selectedSector.confirmations_count
              }
            </div>

            {selectedSector.last_updated && (
              <div>
                Обновлено:{' '}
                {new Date(
                  selectedSector.last_updated
                ).toLocaleString(
                  'ru-RU'
                )}
              </div>
            )}

          </div>

        </div>
      )}

      <footer className="footer">

        <span>
          🟢 Хорошо
        </span>

        <span>
          🟡 Есть нюансы
        </span>

        <span>
          🔴 Плохие условия
        </span>

        <span>
          ⚪ Нет данных
        </span>

      </footer>

    </div>
  )
}

export default App
