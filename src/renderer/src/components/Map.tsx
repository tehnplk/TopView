import { useEffect, useRef, useState } from 'react'
import {
  Circle as LeafletCircle,
  LatLng,
  Polyline,
  map,
  tileLayer,
  type Layer,
  type Map as LeafletMap,
  type TileLayer
} from 'leaflet'
import { Circle, MapPin, Pentagon, Ruler, Trash2 } from 'lucide-react'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import 'leaflet/dist/leaflet.css'

const PHITSANULOK_CENTER: [number, number] = [16.8211, 100.2659]
const FEATURE_COLOR = '#2563eb'
const TILE_MODES = [
  { id: 'map', label: 'แผนที่' },
  { id: 'satellite', label: 'ดาวเทียม' },
  { id: 'dark', label: 'โหมดมืด' }
] as const
const MAP_TOOLS = [
  { id: 'measure', label: 'วัดระยะทาง', Icon: Ruler },
  { id: 'circle', label: 'สร้างรัศมีวงกลม', Icon: Circle },
  { id: 'polygon', label: 'วาดรูปร่าง', Icon: Pentagon },
  { id: 'point', label: 'จุด', Icon: MapPin },
  { id: 'clear', label: 'ล้าง', Icon: Trash2 }
] as const

type TileMode = (typeof TILE_MODES)[number]['id']
type MapTool = (typeof MAP_TOOLS)[number]['id']

function formatDistance(distanceInMeters: number): string {
  if (distanceInMeters >= 1000) {
    return `${(distanceInMeters / 1000).toFixed(2)} กม.`
  }

  return `${Math.round(distanceInMeters)} เมตร`
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
  const activeToolRef = useRef<MapTool | null>(null)
  const [activeMode, setActiveMode] = useState<TileMode>('map')
  const [activeTool, setActiveTool] = useState<MapTool | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

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

    const stopLiveRadiusTracking = (): void => {
      if (updateLiveRadius) {
        leafletMap.off('mousemove', updateLiveRadius)
        liveCircle?.off('pm:change', updateLiveRadius)
      }

      liveCircle = null
      updateLiveRadius = null
    }

    const finishDrawing = (): void => {
      activeToolRef.current = null
      setActiveTool(null)
    }

    const handleDrawStart = (event: { shape: string; workingLayer: Layer }): void => {
      stopLiveRadiusTracking()

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
      finishDrawing()
    }

    const handleCreate = (event: { shape: string; layer: Layer }): void => {
      if (activeToolRef.current === 'measure' && event.shape === 'Line' && event.layer instanceof Polyline) {
        const points = event.layer.getLatLngs()

        if (points.length > 1 && points.every((point) => point instanceof LatLng)) {
          const linePoints = points as LatLng[]
          const distance = linePoints.slice(1).reduce((total, point, index) => {
            return total + linePoints[index].distanceTo(point)
          }, 0)

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

      leafletMap.pm.disableDraw()
      finishDrawing()
    }

    leafletMap.on('pm:drawstart', handleDrawStart)
    leafletMap.on('pm:create', handleCreate)
    leafletMap.on('pm:drawend', handleDrawEnd)

    const resizeObserver = new ResizeObserver(() => {
      leafletMap.invalidateSize({ animate: false })
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      stopLiveRadiusTracking()
      leafletMap.off('pm:drawstart', handleDrawStart)
      leafletMap.off('pm:create', handleCreate)
      leafletMap.off('pm:drawend', handleDrawEnd)
      leafletMap.remove()
      mapRef.current = null
      layersRef.current = null
      activeToolRef.current = null
    }
  }, [])

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
      leafletMap.pm.enableDraw('CircleMarker', {
        continueDrawing: false,
        pathOptions: {
          color: FEATURE_COLOR,
          fillColor: FEATURE_COLOR,
          fillOpacity: 0.9,
          radius: 7,
          weight: 2
        },
        resizeableCircleMarker: false,
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

      <div className="map-toolbox" role="group" aria-label="เครื่องมือแผนที่">
        {MAP_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="map-tool-button"
            data-tooltip={tool.label}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.id}
            onClick={() => selectMapTool(tool.id)}
          >
            <tool.Icon size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}

export default Map
