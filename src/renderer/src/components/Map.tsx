import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Circle as LeafletCircle,
  LatLng,
  Marker as LeafletMarker,
  Polygon as LeafletPolygon,
  Polyline,
  divIcon,
  layerGroup,
  map,
  tileLayer,
  type Layer,
  type LayerGroup,
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
  GisLayer,
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
const EXTERNAL_GIS_LAYERS = [
  { id: 'district-boundary', label: 'ขอบเขตอำเภอ' },
  { id: 'subdistrict-boundary', label: 'ขอบเขตตำบล' }
] as const

type TileMode = (typeof TILE_MODES)[number]['id']
type MapTool = (typeof MAP_TOOLS)[number]['id']
type ExternalGisLayerId = (typeof EXTERNAL_GIS_LAYERS)[number]['id']
type InfoFieldDraft = {
  id: number
  key: string
  value: string
}

type MapProps = {
  activeGisLayerIds: number[]
  layerCatalogRevision: number
  onActivateGisLayer: (layerId: number) => void
  onManageLayers: () => void
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

function getGeometryLabel(geometry: GisGeometry): string {
  if (geometry.type === 'Point') {
    return 'จุด'
  }

  if (geometry.type === 'LineString') {
    return 'เส้น'
  }

  return 'รูปหลายเหลี่ยม'
}

function getExternalGisLayerId(info: GisFeatureInfo): ExternalGisLayerId | null {
  if ('ADM3_PCODE' in info) {
    return 'subdistrict-boundary'
  }

  if ('ADM2_PCODE' in info && 'ADM1_PCODE' in info) {
    return 'district-boundary'
  }

  return null
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

function Map({
  activeGisLayerIds,
  layerCatalogRevision,
  onActivateGisLayer,
  onManageLayers
}: MapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layersRef = useRef<Record<TileMode, TileLayer> | null>(null)
  const wmsLayersRef = useRef<Partial<Record<GistdaWmsLayerId, TileLayer>>>({})
  const externalGisLayersRef = useRef<Partial<Record<ExternalGisLayerId, LayerGroup>>>({})
  const namedGisLayersRef = useRef<globalThis.Map<number, LayerGroup>>(new globalThis.Map())
  const namedGisFeatureLayersRef = useRef<globalThis.Map<number, number>>(new globalThis.Map())
  const activeGisLayerIdsRef = useRef(activeGisLayerIds)
  const externalGisFeatureLayersRef = useRef<globalThis.Map<number, ExternalGisLayerId>>(
    new globalThis.Map()
  )
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
  const [availableExternalGisLayers, setAvailableExternalGisLayers] = useState<
    ExternalGisLayerId[]
  >([])
  const [activeExternalGisLayers, setActiveExternalGisLayers] = useState<
    ExternalGisLayerId[]
  >([])
  const [isWmsExpanded, setIsWmsExpanded] = useState(false)
  const [gisLayers, setGisLayers] = useState<GisLayer[]>([])
  const [isLoadingGisLayers, setIsLoadingGisLayers] = useState(true)
  const [gisLayerError, setGisLayerError] = useState<string | null>(null)
  const [pendingGeometry, setPendingGeometry] = useState<GisGeometry | null>(null)
  const [pendingGisLayerId, setPendingGisLayerId] = useState('')
  const [pendingInfoFields, setPendingInfoFields] = useState<InfoFieldDraft[]>([])
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

  function preparePendingFeature(layer: Layer, geometry: GisGeometry): void {
    pendingLayerRef.current = layer
    setPendingGeometry(geometry)
    setPendingGisLayerId('')
    setPendingInfoFields([createInfoField()])
    setSaveError(null)
  }

  useEffect(() => {
    let isDisposed = false

    const loadGisLayers = async (): Promise<void> => {
      if (!window.api) {
        setIsLoadingGisLayers(false)
        setGisLayerError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้')
        return
      }

      setIsLoadingGisLayers(true)
      setGisLayerError(null)

      try {
        const layers = await window.api.listGisLayers()

        if (!isDisposed) {
          setGisLayers(layers)
        }
      } catch (error) {
        console.error('Unable to load GIS layers', error)
        if (!isDisposed) {
          setGisLayerError('ไม่สามารถโหลดชื่อชั้นข้อมูลได้')
        }
      } finally {
        if (!isDisposed) {
          setIsLoadingGisLayers(false)
        }
      }
    }

    void loadGisLayers()
    return () => {
      isDisposed = true
    }
  }, [layerCatalogRevision])

  useEffect(() => {
    activeGisLayerIdsRef.current = activeGisLayerIds
    const leafletMap = mapRef.current

    if (!leafletMap) {
      return
    }

    namedGisLayersRef.current.forEach((layer, layerId) => {
      const shouldBeActive = activeGisLayerIds.includes(layerId)
      const isActive = leafletMap.hasLayer(layer)

      if (shouldBeActive && !isActive) {
        layer.addTo(leafletMap)
      } else if (!shouldBeActive && isActive) {
        leafletMap.removeLayer(layer)
      }
    })
  }, [activeGisLayerIds])

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
  }, [selectedFeature?.id, infoFields.length, isEditingInfo, isInfoSaving, infoError])

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

      if (activeToolRef.current === 'line' && event.shape === 'Line' && event.layer instanceof Polyline) {
        const points = getLinePoints(event.layer)

        if (points.length >= 2) {
          preparePendingFeature(event.layer, {
            type: 'LineString',
            coordinates: points.map((point) => [point.lng, point.lat])
          })
        }
      }

      if (activeToolRef.current === 'point' && event.shape === 'Marker' && event.layer instanceof LeafletMarker) {
        event.layer.setIcon(RED_PIN_ICON)

        const point = event.layer.getLatLng()
        preparePendingFeature(event.layer, {
          type: 'Point',
          coordinates: [point.lng, point.lat]
        })
      }

      if (activeToolRef.current === 'polygon' && event.shape === 'Polygon' && event.layer instanceof LeafletPolygon) {
        const geometry = event.layer.toGeoJSON().geometry

        if (geometry.type === 'Polygon') {
          preparePendingFeature(event.layer, {
            type: 'Polygon',
            coordinates: geometry.coordinates.map((ring) => {
              return ring.map((position) => [position[0], position[1]])
            })
          })
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

        const externalFeatureLayers: Record<ExternalGisLayerId, Layer[]> = {
          'district-boundary': [],
          'subdistrict-boundary': []
        }
        const namedFeatureLayers = new globalThis.Map<number, Layer[]>()

        records.forEach((record) => {
          const { spatial } = record
          const externalLayerId = getExternalGisLayerId(record.info)
          let layer: Layer

          if (spatial.type === 'Point') {
            const [longitude, latitude] = spatial.coordinates
            layer = new LeafletMarker([latitude, longitude], {
              icon: RED_PIN_ICON,
              title: 'คลิกเพื่อดู Feature Info'
            })
          } else if (spatial.type === 'LineString') {
            const latLngs = spatial.coordinates.map(([longitude, latitude]) => {
              return [latitude, longitude] as [number, number]
            })
            layer = new Polyline(latLngs, {
              color: FEATURE_COLOR,
              weight: 3
            })
          } else {
            const latLngs = spatial.coordinates.map((ring) => {
              return ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number])
            })

            layer = new LeafletPolygon(latLngs, {
              color: FEATURE_COLOR,
              fillColor: FEATURE_COLOR,
              fillOpacity: 0.18,
              weight: 2
            })
          }

          registerSavedFeatureLayer(layer, record)

          if (record.layerId !== null) {
            const featureLayers = namedFeatureLayers.get(record.layerId) ?? []
            featureLayers.push(layer)
            namedFeatureLayers.set(record.layerId, featureLayers)
            namedGisFeatureLayersRef.current.set(record.id, record.layerId)
            return
          }

          if (externalLayerId) {
            externalFeatureLayers[externalLayerId].push(layer)
            externalGisFeatureLayersRef.current.set(record.id, externalLayerId)
            return
          }

          layer.addTo(leafletMap)
        })

        namedFeatureLayers.forEach((featureLayers, layerId) => {
          const namedLayer = layerGroup(featureLayers)
          namedGisLayersRef.current.set(layerId, namedLayer)

          if (activeGisLayerIdsRef.current.includes(layerId)) {
            namedLayer.addTo(leafletMap)
          }
        })

        const availableLayers = EXTERNAL_GIS_LAYERS.flatMap(({ id }) => {
          const featureLayers = externalFeatureLayers[id]

          if (featureLayers.length === 0) {
            return []
          }

          externalGisLayersRef.current[id] = layerGroup(featureLayers)
          return [id]
        })

        setAvailableExternalGisLayers(availableLayers)
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
      externalGisLayersRef.current = {}
      namedGisLayersRef.current.clear()
      namedGisFeatureLayersRef.current.clear()
      externalGisFeatureLayersRef.current.clear()
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
    setPendingGisLayerId('')
    setPendingInfoFields([])
    setSaveError(null)
  }

  function updatePendingInfoField(
    fieldId: number,
    property: 'key' | 'value',
    value: string
  ): void {
    setPendingInfoFields((current) =>
      current.map((field) => (field.id === fieldId ? { ...field, [property]: value } : field))
    )
    setSaveError(null)
  }

  function removePendingInfoField(fieldId: number): void {
    setPendingInfoFields((current) => current.filter((field) => field.id !== fieldId))
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

    const selectedLayerId = Number(pendingGisLayerId)
    const selectedLayer = gisLayers.find(
      (layer) => layer.id === selectedLayerId && layer.geometryType === pendingGeometry.type
    )

    if (!selectedLayer) {
      setSaveError(`กรุณาเลือกชื่อชั้นข้อมูลสำหรับ ${getGeometryLabel(pendingGeometry)}`)
      return
    }

    const normalizedFields = pendingInfoFields
      .map((field) => ({ key: field.key.trim(), value: field.value }))
      .filter((field) => field.key || field.value.trim())

    if (normalizedFields.some((field) => !field.key)) {
      setSaveError('กรุณาระบุชื่อ Attribute ให้ครบทุกรายการ')
      return
    }

    const keys = normalizedFields.map((field) => field.key)

    if (new Set(keys).size !== keys.length) {
      setSaveError('ชื่อ Attribute ห้ามซ้ำกัน')
      return
    }

    const info = Object.fromEntries(
      normalizedFields.map((field) => [field.key, parseInfoValue(field.value)])
    )

    setIsSaving(true)
    setSaveError(null)

    try {
      const result = await window.api.saveGisGeometry(pendingGeometry, selectedLayer.id, info)
      const savedLayer = pendingLayerRef.current

      if (savedLayer) {
        registerSavedFeatureLayer(savedLayer, {
          id: result.id,
          spatial: pendingGeometry,
          info,
          layerId: selectedLayer.id,
          layerName: selectedLayer.name
        })

        let namedLayer = namedGisLayersRef.current.get(selectedLayer.id)
        if (!namedLayer) {
          namedLayer = layerGroup()
          namedGisLayersRef.current.set(selectedLayer.id, namedLayer)
        }
        namedLayer.addLayer(savedLayer)
        namedGisFeatureLayersRef.current.set(result.id, selectedLayer.id)
        if (
          activeGisLayerIdsRef.current.includes(selectedLayer.id) &&
          mapRef.current &&
          !mapRef.current.hasLayer(namedLayer)
        ) {
          namedLayer.addTo(mapRef.current)
        }
        onActivateGisLayer(selectedLayer.id)
      }

      pendingLayerRef.current = null
      setPendingGeometry(null)
      setPendingGisLayerId('')
      setPendingInfoFields([])
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

      const externalLayerId = externalGisFeatureLayersRef.current.get(featureId)
      if (externalLayerId && featureLayer) {
        externalGisLayersRef.current[externalLayerId]?.removeLayer(featureLayer)
        externalGisFeatureLayersRef.current.delete(featureId)
      }

      const namedLayerId = namedGisFeatureLayersRef.current.get(featureId)
      if (namedLayerId && featureLayer) {
        namedGisLayersRef.current.get(namedLayerId)?.removeLayer(featureLayer)
        namedGisFeatureLayersRef.current.delete(featureId)
      }

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

  function toggleExternalGisLayer(layerId: ExternalGisLayerId): void {
    const leafletMap = mapRef.current
    const externalLayer = externalGisLayersRef.current[layerId]

    if (!leafletMap || !externalLayer) {
      return
    }

    if (leafletMap.hasLayer(externalLayer)) {
      leafletMap.removeLayer(externalLayer)
      setActiveExternalGisLayers((current) => current.filter((id) => id !== layerId))
      return
    }

    externalLayer.addTo(leafletMap)
    setActiveExternalGisLayers((current) => [...current, layerId])
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

  const compatiblePendingLayers = pendingGeometry
    ? gisLayers.filter((layer) => layer.geometryType === pendingGeometry.type)
    : []

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
              <span>ชั้นข้อมูลกายภาพ</span>
              <ChevronUp className="map-wms-chevron" size={16} aria-hidden="true" />
            </>
          )}
        </button>

        {isWmsExpanded && (
          <div id="gistda-wms-options" className="map-wms-options" role="group" aria-label="ชั้นข้อมูลกายภาพ">
            {availableExternalGisLayers.length > 0 && (
              <div className="map-wms-section" role="group" aria-labelledby="administrative-boundary-layers">
                <div id="administrative-boundary-layers" className="map-wms-section-title">
                  ขอบเขตปกครอง
                </div>
                {EXTERNAL_GIS_LAYERS.filter((layer) =>
                  availableExternalGisLayers.includes(layer.id)
                ).map((layer) => (
                  <label key={layer.id} className="map-wms-option">
                    <input
                      type="checkbox"
                      checked={activeExternalGisLayers.includes(layer.id)}
                      onChange={() => toggleExternalGisLayer(layer.id)}
                    />
                    <span>{layer.label}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="map-wms-section" role="group" aria-labelledby="disaster-layers">
              <div id="disaster-layers" className="map-wms-section-title">
                ภัยพิบัติ
              </div>
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
                  {getGeometryLabel(selectedFeature.spatial)}
                </span>
                {selectedFeature.layerName && (
                  <span className="map-feature-layer-name">{selectedFeature.layerName}</span>
                )}
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
            className="map-save-dialog map-feature-save-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="map-save-title"
            aria-describedby="map-save-description"
          >
            <form onSubmit={(event) => {
              event.preventDefault()
              void savePendingGeometry()
            }}>
              <h2 id="map-save-title">บันทึก Feature</h2>
              <p id="map-save-description">
                {getGeometryLabel(pendingGeometry)}จะถูกบันทึกลงฐานข้อมูลหลังเลือกชื่อชั้นข้อมูลและกรอก Attribute
              </p>

              <div className="map-feature-save-body">
                <label className="map-feature-layer-select" htmlFor="pending-gis-layer">
                  <span>ชื่อชั้นข้อมูล</span>
                  <select
                    id="pending-gis-layer"
                    autoFocus
                    value={pendingGisLayerId}
                    disabled={isSaving || isLoadingGisLayers}
                    onChange={(event) => {
                      setPendingGisLayerId(event.target.value)
                      setSaveError(null)
                    }}
                  >
                    <option value="">เลือกชื่อชั้นข้อมูล</option>
                    {compatiblePendingLayers.map((layer) => (
                      <option key={layer.id} value={layer.id}>{layer.name}</option>
                    ))}
                  </select>
                </label>

                {isLoadingGisLayers && <p className="map-feature-save-status">กำลังโหลดชื่อชั้นข้อมูล...</p>}
                {gisLayerError && <p className="map-save-error" role="alert">{gisLayerError}</p>}
                {!isLoadingGisLayers && compatiblePendingLayers.length === 0 && (
                  <>
                    <p className="map-feature-save-status">
                      ยังไม่มีชื่อชั้นข้อมูลสำหรับ {getGeometryLabel(pendingGeometry)}
                    </p>
                    <button type="button" className="map-manage-layers-button" onClick={onManageLayers}>
                      เพิ่มชื่อชั้นข้อมูล
                    </button>
                  </>
                )}

                <div className="map-pending-attribute-heading">
                  <span>Attribute</span>
                </div>

                <div className="map-feature-info-fields">
                  {pendingInfoFields.map((field, index) => (
                    <div key={field.id} className="map-feature-info-field">
                      <div className="map-feature-info-field-heading">
                        <span>Attribute {index + 1}</span>
                        <button
                          type="button"
                          aria-label={`ลบ Attribute ${index + 1}`}
                          disabled={isSaving}
                          onClick={() => removePendingInfoField(field.id)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                      <label>
                        <span>ชื่อ Attribute</span>
                        <input
                          type="text"
                          value={field.key}
                          maxLength={80}
                          disabled={isSaving}
                          placeholder="เช่น name"
                          onChange={(event) => updatePendingInfoField(field.id, 'key', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>ค่า</span>
                        <textarea
                          rows={2}
                          value={field.value}
                          maxLength={4000}
                          disabled={isSaving}
                          placeholder="กรอกข้อมูล"
                          onChange={(event) => updatePendingInfoField(field.id, 'value', event.target.value)}
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="map-feature-info-add"
                  disabled={isSaving}
                  onClick={() => setPendingInfoFields((current) => [...current, createInfoField()])}
                >
                  <Plus size={16} aria-hidden="true" />
                  เพิ่ม Attribute
                </button>

                {saveError && <p className="map-save-error" role="alert">{saveError}</p>}
              </div>

              <div className="map-save-actions">
                <button type="button" className="map-save-button secondary" disabled={isSaving} onClick={discardPendingGeometry}>
                  ไม่บันทึก
                </button>
                <button
                  type="submit"
                  className="map-save-button primary"
                  disabled={isSaving || isLoadingGisLayers}
                >
                  {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default Map
