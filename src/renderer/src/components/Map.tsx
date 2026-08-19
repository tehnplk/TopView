import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Circle as LeafletCircle,
  LatLng,
  Marker as LeafletMarker,
  Polygon as LeafletPolygon,
  Polyline,
  divIcon,
  map,
  tileLayer,
  type Layer,
  type LeafletMouseEvent,
  type Map as LeafletMap,
  type TileLayer
} from 'leaflet'
import {
  ChevronUp,
  Circle,
  Layers,
  MapPin,
  Pencil,
  Pentagon,
  Plus,
  Ruler,
  Spline,
  Trash2
} from 'lucide-react'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import 'leaflet/dist/leaflet.css'
import type {
  GisDataRecord,
  GisFeatureInfo,
  GisGeometry,
  GistdaWmsConfig,
  GistdaWmsLayerId
} from '../../../shared/gis'

const PHITSANULOK_CENTER: [number, number] = [16.8211, 100.2659]
const FEATURE_COLOR = '#2563eb'
const RED_PIN_ICON = divIcon({
  className: 'map-red-pin-icon',
  html: '<span class="map-red-pin" aria-hidden="true"></span>',
  iconAnchor: [15, 42],
  iconSize: [30, 42]
})
const TARGET_ICON = divIcon({
  className: 'map-target-icon',
  html: '<span class="map-target" aria-hidden="true"></span>',
  iconAnchor: [16, 16],
  iconSize: [32, 32]
})
const TILE_MODES = [
  { id: 'map', label: 'แผนที่' },
  { id: 'satellite', label: 'ดาวเทียม' },
  { id: 'dark', label: 'โหมดมืด' }
] as const
const MAP_TOOLS = [
  { id: 'measure', label: 'วัดระยะทาง', Icon: Ruler },
  { id: 'line', label: 'วาดเส้น', Icon: Spline },
  { id: 'circle', label: 'สร้างรัศมีวงกลม', Icon: Circle },
  { id: 'polygon', label: 'วาดรูปร่าง', Icon: Pentagon },
  { id: 'point', label: 'จุด', Icon: MapPin },
  { id: 'clear', label: 'ล้าง', Icon: Trash2 }
] as const

type TileMode = (typeof TILE_MODES)[number]['id']
type MapTool = (typeof MAP_TOOLS)[number]['id']
type InfoFieldDraft = {
  id: number
  key: string
  value: string
}

let nextInfoFieldId = 1

function createInfoField(key = '', value = ''): InfoFieldDraft {
  return { id: nextInfoFieldId++, key, value }
}

function formatInfoValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

function createInfoFields(info: GisFeatureInfo): InfoFieldDraft[] {
  return Object.entries(info).map(([key, value]) => createInfoField(key, formatInfoValue(value)))
}

function parseInfoValue(value: string): unknown {
  const trimmedValue = value.trim()

  if (
    !trimmedValue ||
    (!trimmedValue.startsWith('{') &&
      !trimmedValue.startsWith('[') &&
      !['true', 'false', 'null'].includes(trimmedValue) &&
      !/^-?\d+(\.\d+)?$/.test(trimmedValue))
  ) {
    return value
  }

  try {
    return JSON.parse(trimmedValue)
  } catch {
    return value
  }
}

function formatDistance(distanceInMeters: number): string {
  if (distanceInMeters >= 1000) {
    return `${(distanceInMeters / 1000).toFixed(2)} กม.`
  }

  return `${Math.round(distanceInMeters)} เมตร`
}

function getLinePoints(line: Polyline): LatLng[] {
  const points = line.getLatLngs()
  return points.every((point) => point instanceof LatLng) ? (points as LatLng[]) : []
}

function calculateLineDistance(points: LatLng[]): number {
  return points.slice(1).reduce((total, point, index) => {
    return total + points[index].distanceTo(point)
  }, 0)
}

function updateLiveLengthTooltip(line: Polyline, cursor: LatLng): void {
  const points = getLinePoints(line)

  if (points.length === 0) {
    return
  }

  const lastPoint = points[points.length - 1]
  const distance =
    calculateLineDistance(points) + (lastPoint.equals(cursor) ? 0 : lastPoint.distanceTo(cursor))
  const content = formatDistance(distance)
  const tooltip = line.getTooltip()

  if (tooltip) {
    tooltip.setContent(content)
    tooltip.setLatLng(cursor)
    line.openTooltip(cursor)
    return
  }

  line
    .bindTooltip(content, {
      className: 'map-measurement-label map-measurement-label-live',
      direction: 'top',
      offset: [0, -8],
      permanent: true
    })
    .openTooltip(cursor)
}

function updateRadiusTooltip(circle: LeafletCircle): void {
  const radius = circle.getRadius()

  if (radius <= 0) {
    return
  }

  const content = formatDistance(radius)
  const tooltip = circle.getTooltip()

  if (tooltip) {
    tooltip.setContent(content)
    circle.openTooltip()
    return
  }

  circle
    .bindTooltip(content, {
      className: 'map-measurement-label',
      direction: 'center',
      permanent: true
    })
    .openTooltip()
}

function Map(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layersRef = useRef<Record<TileMode, TileLayer> | null>(null)
  const wmsLayersRef = useRef<Partial<Record<GistdaWmsLayerId, TileLayer>>>({})
  const activeToolRef = useRef<MapTool | null>(null)
  const pendingLayerRef = useRef<Layer | null>(null)
  const activeFeatureLayerRef = useRef<Layer | null>(null)
  const savedFeatureRecordsRef = useRef<globalThis.Map<number, GisDataRecord>>(
    new globalThis.Map()
  )
  const [activeMode, setActiveMode] = useState<TileMode>('map')
  const [activeTool, setActiveTool] = useState<MapTool | null>(null)
  const [wmsConfig, setWmsConfig] = useState<GistdaWmsConfig | null>(null)
  const [activeWmsLayers, setActiveWmsLayers] = useState<GistdaWmsLayerId[]>([])
  const [isWmsExpanded, setIsWmsExpanded] = useState(false)
  const [pendingGeometry, setPendingGeometry] = useState<GisGeometry | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<GisDataRecord | null>(null)
  const [infoFields, setInfoFields] = useState<InfoFieldDraft[]>([])
  const [isEditingInfo, setIsEditingInfo] = useState(false)
  const [isInfoSaving, setIsInfoSaving] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [featureInfoPopupHost, setFeatureInfoPopupHost] = useState<HTMLDivElement | null>(null)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeletingFeature, setIsDeletingFeature] = useState(false)
  const [deleteFeatureError, setDeleteFeatureError] = useState<string | null>(null)

  function openFeatureInfo(featureId: number): void {
    const record = savedFeatureRecordsRef.current.get(featureId)

    if (!record) {
      return
    }

    setSelectedFeature(record)
    setInfoFields(createInfoFields(record.info))
    setIsEditingInfo(false)
    setInfoError(null)
  }

  function registerSavedFeatureLayer(layer: Layer, record: GisDataRecord): void {
    savedFeatureRecordsRef.current.set(record.id, record)

    const popupHost = document.createElement('div')
    popupHost.className = 'map-feature-info-popup-host'
    layer.bindPopup(popupHost, {
      className: 'map-feature-info-popup',
      minWidth: 260,
      maxWidth: 340,
      autoPanPadding: [20, 20]
    })
    layer.on('popupopen', () => {
      activeFeatureLayerRef.current = layer
      setFeatureInfoPopupHost(popupHost)
      openFeatureInfo(record.id)
    })
    layer.on('popupclose', () => {
      if (activeFeatureLayerRef.current !== layer) {
        return
      }

      activeFeatureLayerRef.current = null
      setFeatureInfoPopupHost(null)
      setSelectedFeature(null)
      setIsEditingInfo(false)
      setInfoError(null)
      setIsDeleteConfirmOpen(false)
      setDeleteFeatureError(null)
    })

    const interactiveLayer = layer as Layer & { getElement?: () => HTMLElement | null }
    const markAsInteractive = (): void => {
      interactiveLayer.getElement?.()?.classList.add('map-saved-feature')
    }

    markAsInteractive()
    layer.on('add', markAsInteractive)
  }

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      activeFeatureLayerRef.current?.getPopup()?.update()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedFeature, infoFields, isEditingInfo, isInfoSaving, infoError])

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    let isDisposed = false
    const leafletMap = map(container).setView(PHITSANULOK_CENTER, 13)
    const layers: Record<TileMode, TileLayer> = {
      map: tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      }),
      satellite: tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          maxZoom: 19
        }
      ),
      dark: tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 20,
        subdomains: 'abcd'
      })
    }

    layers.map.addTo(leafletMap)
    mapRef.current = leafletMap
    layersRef.current = layers
    leafletMap.pm.setGlobalOptions({
      exitModeOnEscape: true,
      finishOnEnter: true,
      snappable: false
    })

    let liveCircle: LeafletCircle | null = null
    let updateLiveRadius: (() => void) | null = null
    let liveMeasureLine: Polyline | null = null
    let updateLiveLength: ((event: LeafletMouseEvent) => void) | null = null
    let updateVertexLength: ((event: { latlng: LatLng }) => void) | null = null

    const stopLiveRadiusTracking = (): void => {
      if (updateLiveRadius) {
        leafletMap.off('mousemove', updateLiveRadius)
        liveCircle?.off('pm:change', updateLiveRadius)
      }

      liveCircle = null
      updateLiveRadius = null
    }

    const stopLiveLengthTracking = (): void => {
      if (updateLiveLength) {
        leafletMap.off('mousemove', updateLiveLength)
      }

      if (liveMeasureLine && updateVertexLength) {
        liveMeasureLine.off('pm:vertexadded', updateVertexLength)
      }

      liveMeasureLine = null
      updateLiveLength = null
      updateVertexLength = null
    }

    const finishDrawing = (): void => {
      activeToolRef.current = null
      setActiveTool(null)
    }

    const handleDrawStart = (event: { shape: string; workingLayer: Layer }): void => {
      stopLiveRadiusTracking()
      stopLiveLengthTracking()

      if (
        activeToolRef.current === 'measure' &&
        event.shape === 'Line' &&
        event.workingLayer instanceof Polyline
      ) {
        liveMeasureLine = event.workingLayer
        updateLiveLength = (mouseEvent) => {
          if (liveMeasureLine) {
            updateLiveLengthTooltip(liveMeasureLine, mouseEvent.latlng)
          }
        }
        updateVertexLength = (vertexEvent) => {
          if (liveMeasureLine) {
            updateLiveLengthTooltip(liveMeasureLine, vertexEvent.latlng)
          }
        }

        leafletMap.on('mousemove', updateLiveLength)
        liveMeasureLine.on('pm:vertexadded', updateVertexLength)
        return
      }

      if (event.shape !== 'Circle' || !(event.workingLayer instanceof LeafletCircle)) {
        return
      }

      liveCircle = event.workingLayer
      updateLiveRadius = () => {
        if (liveCircle) {
          updateRadiusTooltip(liveCircle)
        }
      }

      leafletMap.on('mousemove', updateLiveRadius)
      liveCircle.on('pm:change', updateLiveRadius)
    }

    const handleDrawEnd = (): void => {
      stopLiveRadiusTracking()
      stopLiveLengthTracking()
      finishDrawing()
    }

    const handleCreate = (event: { shape: string; layer: Layer }): void => {
      if (activeToolRef.current === 'measure' && event.shape === 'Line' && event.layer instanceof Polyline) {
        const points = event.layer.getLatLngs()

        if (points.length > 1 && points.every((point) => point instanceof LatLng)) {
          const distance = calculateLineDistance(points as LatLng[])

          event.layer
            .bindTooltip(formatDistance(distance), {
              className: 'map-measurement-label',
              direction: 'center',
              permanent: true
            })
            .openTooltip()
        }
      }

      if (activeToolRef.current === 'circle' && event.shape === 'Circle' && event.layer instanceof LeafletCircle) {
        updateRadiusTooltip(event.layer)
      }

      if (activeToolRef.current === 'point' && event.shape === 'Marker' && event.layer instanceof LeafletMarker) {
        event.layer.setIcon(RED_PIN_ICON)

        const point = event.layer.getLatLng()
        pendingLayerRef.current = event.layer
        setPendingGeometry({ type: 'Point', coordinates: [point.lng, point.lat] })
        setSaveError(null)
      }

      if (activeToolRef.current === 'polygon' && event.shape === 'Polygon' && event.layer instanceof LeafletPolygon) {
        const geometry = event.layer.toGeoJSON().geometry

        if (geometry.type === 'Polygon') {
          pendingLayerRef.current = event.layer
          setPendingGeometry({
            type: 'Polygon',
            coordinates: geometry.coordinates.map((ring) => {
              return ring.map((position) => [position[0], position[1]])
            })
          })
          setSaveError(null)
        }
      }

      leafletMap.pm.disableDraw()
      finishDrawing()
    }

    leafletMap.on('pm:drawstart', handleDrawStart)
    leafletMap.on('pm:create', handleCreate)
    leafletMap.on('pm:drawend', handleDrawEnd)

    const loadSavedLayers = async (): Promise<void> => {
      if (!window.api) {
        return
      }

      try {
        const records = await window.api.listGisGeometry()

        if (isDisposed) {
          return
        }

        records.forEach((record) => {
          const { spatial } = record

          if (spatial.type === 'Point') {
            const [longitude, latitude] = spatial.coordinates
            const layer = new LeafletMarker([latitude, longitude], {
              icon: RED_PIN_ICON,
              title: 'คลิกเพื่อดู Feature Info'
            }).addTo(leafletMap)
            registerSavedFeatureLayer(layer, record)
            return
          }

          const latLngs = spatial.coordinates.map((ring) => {
            return ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number])
          })

          const layer = new LeafletPolygon(latLngs, {
            color: FEATURE_COLOR,
            fillColor: FEATURE_COLOR,
            fillOpacity: 0.18,
            weight: 2
          }).addTo(leafletMap)
          registerSavedFeatureLayer(layer, record)
        })
      } catch (error) {
        console.error('Unable to load saved GIS geometry', error)
      }
    }

    void loadSavedLayers()

    const loadWmsLayers = async (): Promise<void> => {
      if (!window.api) {
        return
      }

      try {
        const config = await window.api.getGistdaWmsConfig()

        if (isDisposed) {
          return
        }

        config.layers.forEach((layerConfig) => {
          if (!layerConfig.url || !layerConfig.layers) {
            return
          }

          wmsLayersRef.current[layerConfig.id] = tileLayer.wms(layerConfig.url, {
            layers: layerConfig.layers,
            format: 'image/png',
            transparent: true,
            version: '1.3.0',
            opacity: 0.68,
            attribution: '&copy; GISTDA'
          })
        })
        setWmsConfig(config)
      } catch (error) {
        console.error('Unable to initialize GISTDA WMS layers', error)
      }
    }

    void loadWmsLayers()

    const resizeObserver = new ResizeObserver(() => {
      leafletMap.invalidateSize({ animate: false })
    })

    resizeObserver.observe(container)

    return () => {
      isDisposed = true
      resizeObserver.disconnect()
      stopLiveRadiusTracking()
      stopLiveLengthTracking()
      leafletMap.off('pm:drawstart', handleDrawStart)
      leafletMap.off('pm:create', handleCreate)
      leafletMap.off('pm:drawend', handleDrawEnd)
      leafletMap.remove()
      mapRef.current = null
      layersRef.current = null
      wmsLayersRef.current = {}
      activeToolRef.current = null
      pendingLayerRef.current = null
      activeFeatureLayerRef.current = null
      savedFeatureRecordsRef.current.clear()
    }
  }, [])

  function discardPendingGeometry(): void {
    if (isSaving) {
      return
    }

    const layer = pendingLayerRef.current

    if (layer && mapRef.current?.hasLayer(layer)) {
      mapRef.current.removeLayer(layer)
    }

    pendingLayerRef.current = null
    setPendingGeometry(null)
    setSaveError(null)
  }

  async function savePendingGeometry(): Promise<void> {
    if (!pendingGeometry || isSaving) {
      return
    }

    if (!window.api) {
      setSaveError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้')
      return
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      const result = await window.api.saveGisGeometry(pendingGeometry)
      const savedLayer = pendingLayerRef.current

      if (savedLayer) {
        registerSavedFeatureLayer(savedLayer, {
          id: result.id,
          spatial: pendingGeometry,
          info: {}
        })
      }

      pendingLayerRef.current = null
      setPendingGeometry(null)
    } catch (error) {
      console.error('Unable to save GIS geometry', error)
      setSaveError('บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setIsSaving(false)
    }
  }

  function beginEditingInfo(): void {
    if (!selectedFeature) {
      return
    }

    const fields = createInfoFields(selectedFeature.info)
    setInfoFields(fields.length > 0 ? fields : [createInfoField()])
    setIsEditingInfo(true)
    setInfoError(null)
  }

  function cancelEditingInfo(): void {
    if (!selectedFeature || isInfoSaving) {
      return
    }

    setInfoFields(createInfoFields(selectedFeature.info))
    setIsEditingInfo(false)
    setInfoError(null)
  }

  function updateInfoField(
    fieldId: number,
    property: 'key' | 'value',
    value: string
  ): void {
    setInfoFields((current) =>
      current.map((field) => (field.id === fieldId ? { ...field, [property]: value } : field))
    )
  }

  function removeInfoField(fieldId: number): void {
    setInfoFields((current) => current.filter((field) => field.id !== fieldId))
    setInfoError(null)
  }

  async function saveFeatureInfo(): Promise<void> {
    if (!selectedFeature || isInfoSaving) {
      return
    }

    if (!window.api) {
      setInfoError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้')
      return
    }

    const normalizedFields = infoFields.map((field) => ({
      key: field.key.trim(),
      value: field.value
    }))

    if (normalizedFields.some((field) => !field.key)) {
      setInfoError('กรุณาระบุชื่อข้อมูลให้ครบทุกรายการ')
      return
    }

    const keys = normalizedFields.map((field) => field.key)

    if (new Set(keys).size !== keys.length) {
      setInfoError('ชื่อข้อมูลห้ามซ้ำกัน')
      return
    }

    const nextInfo = Object.fromEntries(
      normalizedFields.map((field) => [field.key, parseInfoValue(field.value)])
    )

    setIsInfoSaving(true)
    setInfoError(null)

    try {
      const result = await window.api.updateGisFeatureInfo(selectedFeature.id, nextInfo)
      const updatedFeature = { ...selectedFeature, info: result.info }
      savedFeatureRecordsRef.current.set(updatedFeature.id, updatedFeature)
      setSelectedFeature(updatedFeature)
      setInfoFields(createInfoFields(result.info))
      setIsEditingInfo(false)
    } catch (error) {
      console.error('Unable to update GIS feature info', error)
      setInfoError('บันทึก Feature Info ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setIsInfoSaving(false)
    }
  }

  async function deleteSelectedFeature(): Promise<void> {
    if (!selectedFeature || isDeletingFeature) {
      return
    }

    if (!window.api) {
      setDeleteFeatureError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้')
      return
    }

    const featureId = selectedFeature.id
    const featureLayer = activeFeatureLayerRef.current
    setIsDeletingFeature(true)
    setDeleteFeatureError(null)

    try {
      await window.api.deleteGisFeature(featureId)
      savedFeatureRecordsRef.current.delete(featureId)

      if (featureLayer && mapRef.current?.hasLayer(featureLayer)) {
        mapRef.current.removeLayer(featureLayer)
      }

      activeFeatureLayerRef.current = null
      setFeatureInfoPopupHost(null)
      setSelectedFeature(null)
      setIsEditingInfo(false)
      setInfoError(null)
      setIsDeleteConfirmOpen(false)
    } catch (error) {
      console.error('Unable to delete GIS feature', error)
      setDeleteFeatureError('ลบ Feature ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      setIsDeletingFeature(false)
    }
  }

  function toggleWmsLayer(layerId: GistdaWmsLayerId): void {
    const leafletMap = mapRef.current
    const wmsLayer = wmsLayersRef.current[layerId]

    if (!leafletMap || !wmsLayer) {
      return
    }

    if (leafletMap.hasLayer(wmsLayer)) {
      leafletMap.removeLayer(wmsLayer)
      setActiveWmsLayers((current) => current.filter((id) => id !== layerId))
      return
    }

    wmsLayer.addTo(leafletMap)
    setActiveWmsLayers((current) => [...current, layerId])
  }

  function selectTileMode(mode: TileMode): void {
    const leafletMap = mapRef.current
    const layers = layersRef.current

    if (!leafletMap || !layers || mode === activeMode) {
      return
    }

    Object.values(layers).forEach((layer) => {
      leafletMap.removeLayer(layer)
    })

    layers[mode].addTo(leafletMap)
    setActiveMode(mode)
  }

  function selectMapTool(tool: MapTool): void {
    const leafletMap = mapRef.current

    if (!leafletMap) {
      return
    }

    leafletMap.pm.disableDraw()

    if (tool === 'clear') {
      leafletMap.pm.getGeomanDrawLayers().forEach((layer) => {
        layer.unbindTooltip()
        leafletMap.removeLayer(layer)
      })
      activeToolRef.current = null
      setActiveTool(null)
      return
    }

    if (activeTool === tool) {
      activeToolRef.current = null
      setActiveTool(null)
      return
    }

    activeToolRef.current = tool
    setActiveTool(tool)

    if (tool === 'measure') {
      leafletMap.pm.enableDraw('Line', {
        finishOn: 'dblclick',
        finishOnEnter: true,
        pathOptions: { color: FEATURE_COLOR, weight: 3 },
        templineStyle: { color: FEATURE_COLOR, weight: 3 },
        tooltips: false
      })
      return
    }

    if (tool === 'line') {
      leafletMap.pm.enableDraw('Line', {
        allowSelfIntersection: true,
        finishOn: 'dblclick',
        finishOnEnter: true,
        pathOptions: { color: FEATURE_COLOR, weight: 3 },
        templineStyle: { color: FEATURE_COLOR, weight: 3 },
        tooltips: true
      })
      return
    }

    if (tool === 'circle') {
      leafletMap.pm.enableDraw('Circle', {
        pathOptions: {
          color: FEATURE_COLOR,
          fillColor: FEATURE_COLOR,
          fillOpacity: 0.14,
          weight: 2
        },
        tooltips: true
      })
      return
    }

    if (tool === 'point') {
      leafletMap.pm.enableDraw('Marker', {
        continueDrawing: false,
        markerStyle: {
          icon: TARGET_ICON
        },
        tooltips: true
      })
      return
    }

    leafletMap.pm.enableDraw('Polygon', {
      allowSelfIntersection: false,
      finishOn: 'dblclick',
      finishOnEnter: true,
      pathOptions: {
        color: FEATURE_COLOR,
        fillColor: FEATURE_COLOR,
        fillOpacity: 0.18,
        weight: 2
      },
      tooltips: true
    })
  }

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map" aria-label="Interactive map of Phitsanulok" />

      <div className="map-layer-switcher" role="group" aria-label="รูปแบบแผนที่">
        {TILE_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="map-layer-button"
            aria-pressed={activeMode === mode.id}
            onClick={() => selectTileMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className={`map-wms-control ${isWmsExpanded ? 'expanded' : 'collapsed'}`}>
        <button
          type="button"
          className="map-wms-toggle"
          aria-label={isWmsExpanded ? 'ย่อชั้นข้อมูล WMS' : 'เปิดชั้นข้อมูล WMS'}
          aria-expanded={isWmsExpanded}
          aria-controls="gistda-wms-options"
          title={isWmsExpanded ? 'ย่อชั้นข้อมูล WMS' : 'เปิดชั้นข้อมูล WMS'}
          onClick={() => setIsWmsExpanded((current) => !current)}
        >
          <Layers size={18} strokeWidth={2} aria-hidden="true" />
          {isWmsExpanded && (
            <>
              <span>GISTDA WMS</span>
              <ChevronUp className="map-wms-chevron" size={16} aria-hidden="true" />
            </>
          )}
        </button>

        {isWmsExpanded && (
          <div id="gistda-wms-options" className="map-wms-options" role="group" aria-label="ชั้นข้อมูล WMS ของ GISTDA">
            {wmsConfig ? (
              wmsConfig.layers.map((layer) => (
                <label key={layer.id} className="map-wms-option" title={layer.error ?? undefined}>
                  <input
                    type="checkbox"
                    checked={activeWmsLayers.includes(layer.id)}
                    disabled={Boolean(layer.error) || !layer.url || !layer.layers}
                    onChange={() => toggleWmsLayer(layer.id)}
                  />
                  <span>{layer.label}</span>
                </label>
              ))
            ) : (
              <div className="map-wms-status">กำลังโหลด...</div>
            )}

            {wmsConfig?.layers.every((layer) => layer.error) && (
              <div className="map-wms-status error">{wmsConfig.layers[0].error}</div>
            )}
          </div>
        )}
      </div>

      <div className="map-toolbox" role="group" aria-label="เครื่องมือแผนที่">
        {MAP_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="map-tool-button"
            data-tooltip={tool.label}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.id}
            disabled={pendingGeometry !== null}
            onClick={() => selectMapTool(tool.id)}
          >
            <tool.Icon size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        ))}
      </div>

      {selectedFeature && featureInfoPopupHost && createPortal(
        <section
          className="map-feature-info-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="map-feature-info-title"
        >
          <header className="map-feature-info-header">
            <div>
              <h2 id="map-feature-info-title">Feature Layer Info</h2>
              <p>
                Feature #{selectedFeature.id}
                <span className="map-feature-type">
                  {selectedFeature.spatial.type === 'Point' ? 'จุด' : 'พื้นที่'}
                </span>
              </p>
            </div>
          </header>

          <div className="map-feature-info-body">
            {isEditingInfo ? (
              <>
                <div className="map-feature-info-fields">
                  {infoFields.length === 0 && (
                    <p className="map-feature-info-empty">ลบข้อมูลทั้งหมดแล้ว กดบันทึกเพื่อยืนยัน</p>
                  )}

                  {infoFields.map((field, index) => (
                    <div key={field.id} className="map-feature-info-field">
                      <div className="map-feature-info-field-heading">
                        <span>รายการ {index + 1}</span>
                        <button
                          type="button"
                          aria-label={`ลบข้อมูลรายการ ${index + 1}`}
                          title="ลบรายการ"
                          disabled={isInfoSaving}
                          onClick={() => removeInfoField(field.id)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                      <label>
                        <span>ชื่อข้อมูล</span>
                        <input
                          type="text"
                          value={field.key}
                          maxLength={80}
                          disabled={isInfoSaving}
                          placeholder="เช่น name"
                          onChange={(event) => updateInfoField(field.id, 'key', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>ค่า</span>
                        <textarea
                          rows={2}
                          value={field.value}
                          maxLength={4000}
                          disabled={isInfoSaving}
                          placeholder="กรอกข้อมูล"
                          onChange={(event) => updateInfoField(field.id, 'value', event.target.value)}
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="map-feature-info-add"
                  disabled={isInfoSaving}
                  onClick={() => setInfoFields((current) => [...current, createInfoField()])}
                >
                  <Plus size={16} aria-hidden="true" />
                  เพิ่มข้อมูล
                </button>
              </>
            ) : Object.keys(selectedFeature.info).length > 0 ? (
              <dl className="map-feature-info-list">
                {Object.entries(selectedFeature.info).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{formatInfoValue(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="map-feature-info-empty-state">
                <span>ยังไม่มีข้อมูล</span>
                <p>เพิ่มรายละเอียดให้ Feature นี้ได้จากปุ่มด้านล่าง</p>
              </div>
            )}

            {infoError && (
              <p className="map-feature-info-error" role="alert">
                {infoError}
              </p>
            )}
          </div>

          <footer className="map-feature-info-actions">
            {isEditingInfo ? (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={isInfoSaving}
                  onClick={cancelEditingInfo}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={isInfoSaving}
                  onClick={() => void saveFeatureInfo()}
                >
                  {isInfoSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setDeleteFeatureError(null)
                    setIsDeleteConfirmOpen(true)
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  ลบ Feature
                </button>
                <button type="button" className="primary" onClick={beginEditingInfo}>
                  {Object.keys(selectedFeature.info).length > 0 ? (
                    <Pencil size={15} aria-hidden="true" />
                  ) : (
                    <Plus size={16} aria-hidden="true" />
                  )}
                  {Object.keys(selectedFeature.info).length > 0 ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}
                </button>
              </>
            )}
          </footer>
        </section>,
        featureInfoPopupHost
      )}

      {selectedFeature && isDeleteConfirmOpen && (
        <div className="map-save-overlay map-feature-delete-overlay">
          <section
            className="map-save-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="map-delete-title"
            aria-describedby="map-delete-description"
          >
            <h2 id="map-delete-title">ลบ Feature หรือไม่?</h2>
            <p id="map-delete-description">
              Feature #{selectedFeature.id} จะถูกลบออกจากแผนที่และฐานข้อมูล ไม่สามารถย้อนกลับได้
            </p>

            {deleteFeatureError && (
              <p className="map-save-error" role="alert">
                {deleteFeatureError}
              </p>
            )}

            <div className="map-save-actions">
              <button
                type="button"
                className="map-save-button secondary"
                disabled={isDeletingFeature}
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="map-save-button danger"
                disabled={isDeletingFeature}
                onClick={() => void deleteSelectedFeature()}
              >
                {isDeletingFeature ? 'กำลังลบ...' : 'ลบ Feature'}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingGeometry && (
        <div className="map-save-overlay">
          <section
            className="map-save-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="map-save-title"
            aria-describedby="map-save-description"
          >
            <h2 id="map-save-title">บันทึกข้อมูลหรือไม่?</h2>
            <p id="map-save-description">
              ต้องการบันทึก{pendingGeometry.type === 'Point' ? 'จุด' : 'รูปหลายเหลี่ยม'}นี้ลงฐานข้อมูลหรือไม่
            </p>

            {saveError && <p className="map-save-error" role="alert">{saveError}</p>}

            <div className="map-save-actions">
              <button type="button" className="map-save-button secondary" disabled={isSaving} onClick={discardPendingGeometry}>
                ไม่บันทึก
              </button>
              <button type="button" className="map-save-button primary" disabled={isSaving} onClick={() => void savePendingGeometry()}>
                {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default Map
