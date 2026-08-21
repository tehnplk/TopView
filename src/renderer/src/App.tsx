import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { GisFeatureType, GisLayer, RestoreDatabaseProgress } from '../../shared/gis'
import Map from './components/Map'

const RIGHT_PANEL_COLLAPSED_WIDTH = 42
const RIGHT_PANEL_COLLAPSE_THRESHOLD = 120
const RIGHT_PANEL_MIN_WIDTH = 220
const RIGHT_PANEL_MAX_WIDTH = 480
const RIGHT_PANEL_MIN_MAP_WIDTH = 320
const RIGHT_PANEL_KEYBOARD_STEP = 24
const GIS_FEATURE_TYPES: Array<{ value: GisFeatureType; label: string }> = [
  { value: 'Point', label: 'Point' },
  { value: 'LineString', label: 'Line' },
  { value: 'Polygon', label: 'Polygon' }
]

function getFeatureTypeLabel(type: GisFeatureType): string {
  return GIS_FEATURE_TYPES.find((option) => option.value === type)?.label ?? type
}

function App(): React.JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isLoadingSettings, setIsLoadingSettings] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [settingsGistdaApiKey, setSettingsGistdaApiKey] = useState('')
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [mapRevision, setMapRevision] = useState(0)
  const [layerCatalogRevision, setLayerCatalogRevision] = useState(0)
  const [gisLayers, setGisLayers] = useState<GisLayer[]>([])
  const [activeGisLayerIds, setActiveGisLayerIds] = useState<number[]>([])
  const [newLayerName, setNewLayerName] = useState('')
  const [newLayerGeometryType, setNewLayerGeometryType] = useState<GisFeatureType | ''>('')
  const [isLoadingLayers, setIsLoadingLayers] = useState(false)
  const [isCreatingLayer, setIsCreatingLayer] = useState(false)
  const [layerManagerError, setLayerManagerError] = useState<string | null>(null)
  const [isRightPanelExpanded, setIsRightPanelExpanded] = useState(true)
  const [isRightPanelResizing, setIsRightPanelResizing] = useState(false)
  const [rightPanelWidth, setRightPanelWidth] = useState(292)
  const [selected43Archive, setSelected43Archive] = useState<string | null>(null)
  const [selectedBackupFile, setSelectedBackupFile] = useState<string | null>(null)
  const [restoreProgress, setRestoreProgress] = useState<RestoreDatabaseProgress | null>(null)
  const rightPanelRef = useRef<HTMLElement>(null)
  const rightPanelDragAnchorRef = useRef(0)
  const hasInitializedActiveLayersRef = useRef(false)

  const getRightPanelMaxWidth = (): number => {
    const workspaceWidth = rightPanelRef.current?.parentElement?.getBoundingClientRect().width

    if (!workspaceWidth) {
      return RIGHT_PANEL_MAX_WIDTH
    }

    return Math.max(
      RIGHT_PANEL_MIN_WIDTH,
      Math.min(RIGHT_PANEL_MAX_WIDTH, workspaceWidth - RIGHT_PANEL_MIN_MAP_WIDTH)
    )
  }

  const toggleRightPanel = (): void => {
    setIsRightPanelExpanded((current) => !current)
  }

  const resizeRightPanel = (clientX: number): void => {
    const requestedWidth = rightPanelDragAnchorRef.current - clientX

    if (requestedWidth < RIGHT_PANEL_COLLAPSE_THRESHOLD) {
      setIsRightPanelExpanded(false)
      return
    }

    setRightPanelWidth(
      Math.min(getRightPanelMaxWidth(), Math.max(RIGHT_PANEL_MIN_WIDTH, requestedWidth))
    )
    setIsRightPanelExpanded(true)
  }

  const startRightPanelResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !rightPanelRef.current) {
      return
    }

    rightPanelDragAnchorRef.current = rightPanelRef.current.getBoundingClientRect().right
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsRightPanelResizing(true)
    event.preventDefault()
  }

  const moveRightPanelResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }

    resizeRightPanel(event.clientX)
  }

  const finishRightPanelResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setIsRightPanelResizing(false)
  }

  const resizeRightPanelWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Home') {
      event.preventDefault()
      setIsRightPanelExpanded(false)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setRightPanelWidth(getRightPanelMaxWidth())
      setIsRightPanelExpanded(true)
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setRightPanelWidth((current) =>
        Math.min(getRightPanelMaxWidth(), Math.max(RIGHT_PANEL_MIN_WIDTH, current + RIGHT_PANEL_KEYBOARD_STEP))
      )
      setIsRightPanelExpanded(true)
      return
    }

    if (event.key === 'ArrowRight' && isRightPanelExpanded) {
      event.preventDefault()

      if (rightPanelWidth - RIGHT_PANEL_KEYBOARD_STEP < RIGHT_PANEL_MIN_WIDTH) {
        setIsRightPanelExpanded(false)
      } else {
        setRightPanelWidth((current) => current - RIGHT_PANEL_KEYBOARD_STEP)
      }
    }
  }

  const openImportDialog = (): void => {
    setSelected43Archive(null)
    setSelectedBackupFile(null)
    setIsImportOpen(true)
  }

  const openLayerManagerDialog = async (): Promise<void> => {
    setIsLayerManagerOpen(true)
    setIsLoadingLayers(true)
    setLayerManagerError(null)

    try {
      if (!window.api) {
        throw new Error('Desktop API is unavailable')
      }

      setGisLayers(await window.api.listGisLayers())
    } catch (error) {
      console.error('Unable to load GIS layers', error)
      setLayerManagerError('ไม่สามารถโหลดชื่อชั้นข้อมูลได้')
    } finally {
      setIsLoadingLayers(false)
    }
  }

  const toggleGisLayer = (layerId: number): void => {
    setActiveGisLayerIds((current) =>
      current.includes(layerId)
        ? current.filter((id) => id !== layerId)
        : [...current, layerId]
    )
  }

  const createLayerName = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const name = newLayerName.trim()
    if (!name || !newLayerGeometryType || isCreatingLayer || !window.api) {
      if (!name || !newLayerGeometryType) {
        setLayerManagerError('กรุณากรอกชื่อชั้นข้อมูลและเลือก Feature Type')
      }
      return
    }

    setIsCreatingLayer(true)
    setLayerManagerError(null)

    try {
      const layer = await window.api.createGisLayer(name, newLayerGeometryType)
      setGisLayers((current) => [...current, layer].sort((first, second) =>
        first.name.localeCompare(second.name, 'th')
      ))
      setActiveGisLayerIds((current) =>
        current.includes(layer.id) ? current : [...current, layer.id]
      )
      setNewLayerName('')
      setNewLayerGeometryType('')
      setLayerCatalogRevision((current) => current + 1)
    } catch (error) {
      console.error('Unable to create GIS layer', error)
      const message = error instanceof Error ? error.message : ''
      setLayerManagerError(
        message.includes('already exists')
          ? 'ชื่อชั้นข้อมูลนี้มีอยู่แล้ว'
          : 'ไม่สามารถเพิ่มชื่อชั้นข้อมูลได้'
      )
    } finally {
      setIsCreatingLayer(false)
    }
  }

  const openSettingsDialog = async (): Promise<void> => {
    setIsSettingsOpen(true)
    setIsLoadingSettings(true)
    setSettingsError(null)

    try {
      if (!window.api) {
        throw new Error('Desktop API is unavailable')
      }

      const settings = await window.api.getAppSettings()
      setSettingsGistdaApiKey(settings.gistdaApiKey)
    } catch (error) {
      console.error('Unable to load application settings', error)
      setSettingsError('ไม่สามารถโหลดการตั้งค่าได้')
    } finally {
      setIsLoadingSettings(false)
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (isSavingSettings || !window.api) {
      return
    }

    setIsSavingSettings(true)
    setSettingsError(null)

    try {
      await window.api.saveAppSettings({ gistdaApiKey: settingsGistdaApiKey })
      setIsSettingsOpen(false)
      setMapRevision((current) => current + 1)
    } catch (error) {
      console.error('Unable to save application settings', error)
      setSettingsError('ไม่สามารถบันทึกการตั้งค่าได้')
    } finally {
      setIsSavingSettings(false)
    }
  }

  const browse43FilesArchive = async (): Promise<void> => {
    const selectedFile = await window.api?.browse43FilesArchive()

    if (selectedFile) {
      setSelected43Archive(selectedFile)
    }
  }

  const browseBackupFile = async (): Promise<void> => {
    if (!window.api) {
      return
    }

    const selectedFile = await window.api.browseBackupFile()

    if (selectedFile) {
      setSelectedBackupFile(selectedFile)

      try {
        const result = await window.api.restoreDatabase(selectedFile)

        if (result.restored) {
          window.location.reload()
        }
      } catch (error) {
        console.error('Unable to restore the database', error)
        setRestoreProgress(null)
      }
    }
  }

  const handleBackup = async (): Promise<void> => {
    if (isBackingUp || !window.api) {
      return
    }

    setIsBackingUp(true)

    try {
      await window.api.backupDatabase()
    } catch (error) {
      console.error('Unable to back up the database', error)
    } finally {
      setIsBackingUp(false)
    }
  }

  useEffect(() => {
    void window.api?.getAppVersion().then(setVersion)
  }, [])

  useEffect(() => {
    let isDisposed = false

    const loadInitialGisLayers = async (): Promise<void> => {
      if (!window.api) {
        setLayerManagerError('ไม่สามารถเชื่อมต่อฐานข้อมูลได้')
        return
      }

      setIsLoadingLayers(true)

      try {
        const layers = await window.api.listGisLayers()

        if (isDisposed) {
          return
        }

        setGisLayers(layers)
        if (!hasInitializedActiveLayersRef.current) {
          setActiveGisLayerIds(layers.map((layer) => layer.id))
          hasInitializedActiveLayersRef.current = true
        }
      } catch (error) {
        console.error('Unable to load GIS layers', error)
        if (!isDisposed) {
          setLayerManagerError('ไม่สามารถโหลดชื่อชั้นข้อมูลได้')
        }
      } finally {
        if (!isDisposed) {
          setIsLoadingLayers(false)
        }
      }
    }

    void loadInitialGisLayers()
    return () => {
      isDisposed = true
    }
  }, [])

  useEffect(() => {
    return window.api?.onRestoreDatabaseProgress((progress) => {
      setIsImportOpen(false)
      setIsAboutOpen(false)
      setIsLayerManagerOpen(false)
      setIsSettingsOpen(false)
      setRestoreProgress(progress)
    })
  }, [])

  useEffect(() => {
    if (!isAboutOpen && !isImportOpen && !isLayerManagerOpen && !isSettingsOpen) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsAboutOpen(false)
        setIsImportOpen(false)
        if (!isCreatingLayer) {
          setIsLayerManagerOpen(false)
        }
        if (!isSavingSettings) {
          setIsSettingsOpen(false)
        }
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isAboutOpen, isCreatingLayer, isImportOpen, isLayerManagerOpen, isSavingSettings, isSettingsOpen])

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="brand-mark" aria-hidden="true">T</span>
        <nav className="app-nav" aria-label="เมนูหลัก">
          <button type="button" onClick={openImportDialog}>นำเข้า</button>
          <button type="button" onClick={() => void openLayerManagerDialog()}>
            จัดการชั้นข้อมูล
          </button>
          <button type="button" disabled={isBackingUp} onClick={() => void handleBackup()}>
            {isBackingUp ? 'กำลังสำรอง...' : 'สำรองข้อมูล'}
          </button>
          <button type="button" onClick={() => void openSettingsDialog()}>ตั้งค่า</button>
          <button type="button" onClick={() => setIsAboutOpen(true)}>เกี่ยวกับ</button>
        </nav>
      </header>

      <section
        className={`workspace ${isRightPanelExpanded ? 'right-panel-expanded' : 'right-panel-collapsed'} ${isRightPanelResizing ? 'right-panel-resizing' : ''}`}
        aria-label="Map workspace"
        style={{ '--right-panel-width': `${rightPanelWidth}px` } as CSSProperties}
      >
        <Map
          key={mapRevision}
          activeGisLayerIds={activeGisLayerIds}
          layerCatalogRevision={layerCatalogRevision}
          onActivateGisLayer={(layerId) => {
            setActiveGisLayerIds((current) =>
              current.includes(layerId) ? current : [...current, layerId]
            )
          }}
          onManageLayers={() => void openLayerManagerDialog()}
        />
        <aside
          className="right-panel"
          aria-label="กลุ่มชั้นข้อมูล"
          data-expanded={isRightPanelExpanded}
          ref={rightPanelRef}
        >
          <div
            className="right-panel-resize-handle"
            role="separator"
            aria-label="ปรับขนาดแผงข้อมูลด้านขวา"
            aria-orientation="vertical"
            aria-valuemin={RIGHT_PANEL_COLLAPSED_WIDTH}
            aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
            aria-valuenow={isRightPanelExpanded ? Math.round(rightPanelWidth) : RIGHT_PANEL_COLLAPSED_WIDTH}
            tabIndex={0}
            onKeyDown={resizeRightPanelWithKeyboard}
            onPointerDown={startRightPanelResize}
            onPointerMove={moveRightPanelResize}
            onPointerUp={finishRightPanelResize}
            onPointerCancel={finishRightPanelResize}
          />
          <header className="right-panel-header">
            {isRightPanelExpanded && <h2>กลุ่มชั้นข้อมูล</h2>}
            <button
              type="button"
              aria-label={isRightPanelExpanded ? 'ย่อแผงข้อมูลด้านขวา' : 'ขยายแผงข้อมูลด้านขวา'}
              aria-expanded={isRightPanelExpanded}
              onClick={toggleRightPanel}
            >
              {isRightPanelExpanded ? (
                <ChevronRight size={18} aria-hidden="true" />
              ) : (
                <ChevronLeft size={18} aria-hidden="true" />
              )}
            </button>
          </header>
          {isRightPanelExpanded && (
            <div id="right-panel-content" className="right-panel-body">
              {isLoadingLayers ? (
                <p className="right-panel-status" role="status">กำลังโหลด...</p>
              ) : gisLayers.length > 0 ? (
                <ul className="right-panel-layer-list">
                  {gisLayers.map((layer) => {
                    const isActive = activeGisLayerIds.includes(layer.id)

                    return (
                      <li key={layer.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={isActive}
                            aria-label={`แสดงชั้นข้อมูล ${layer.name}`}
                            onChange={() => toggleGisLayer(layer.id)}
                          />
                          <span>
                            <strong title={layer.name}>{layer.name}</strong>
                            <small>{getFeatureTypeLabel(layer.geometryType)}</small>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="right-panel-status">
                  {layerManagerError ?? 'ยังไม่มีชื่อชั้นข้อมูล'}
                </p>
              )}
            </div>
          )}
        </aside>
      </section>

      {restoreProgress && (
        <div className="about-overlay restore-overlay">
          <section
            className="restore-progress-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-progress-title"
            aria-describedby="restore-progress-message"
          >
            <h2 id="restore-progress-title">กำลังนำเข้าข้อมูลสำรอง</h2>
            <p id="restore-progress-message">{restoreProgress.message}</p>
            <progress value={restoreProgress.percent} max="100">
              {restoreProgress.percent}%
            </progress>
            <span>{restoreProgress.percent}%</span>
          </section>
        </div>
      )}

      {isLayerManagerOpen && (
        <div
          className="about-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isCreatingLayer) {
              setIsLayerManagerOpen(false)
            }
          }}
        >
          <section
            className="settings-dialog layer-manager-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="layer-manager-title"
          >
            <header className="settings-dialog-header">
              <h2 id="layer-manager-title">จัดการชั้นข้อมูล</h2>
              <button
                type="button"
                aria-label="ปิดหน้าต่างจัดการชั้นข้อมูล"
                disabled={isCreatingLayer}
                onClick={() => setIsLayerManagerOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={(event) => void createLayerName(event)}>
              <div className="settings-dialog-body layer-manager-body">
                <span className="layer-manager-form-title">เพิ่มชื่อชั้นข้อมูล</span>
                <div className="layer-manager-create-fields">
                  <label htmlFor="new-layer-name">
                    ชื่อชั้นข้อมูล
                    <input
                      id="new-layer-name"
                      type="text"
                      autoFocus
                      maxLength={100}
                      value={newLayerName}
                      disabled={isCreatingLayer}
                      placeholder="ชื่อชั้นข้อมูล"
                      onChange={(event) => setNewLayerName(event.target.value)}
                    />
                  </label>
                  <label htmlFor="new-layer-geometry-type">
                    Feature Type
                    <select
                      id="new-layer-geometry-type"
                      value={newLayerGeometryType}
                      disabled={isCreatingLayer}
                      onChange={(event) =>
                        setNewLayerGeometryType(event.target.value as GisFeatureType | '')
                      }
                    >
                      <option value="">เลือก Feature Type</option>
                      {GIS_FEATURE_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="submit"
                  className="layer-manager-add-button"
                  disabled={isCreatingLayer || !newLayerName.trim() || !newLayerGeometryType}
                >
                  {isCreatingLayer ? 'กำลังเพิ่ม...' : 'เพิ่มชั้นข้อมูล'}
                </button>

                {layerManagerError && (
                  <p className="settings-error" role="alert">{layerManagerError}</p>
                )}
              </div>

              <footer className="settings-dialog-footer">
                <button
                  type="button"
                  className="settings-cancel-button"
                  disabled={isCreatingLayer}
                  onClick={() => setIsLayerManagerOpen(false)}
                >
                  ปิด
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {isImportOpen && (
        <div
          className="about-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsImportOpen(false)
            }
          }}
        >
          <section
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <header className="import-dialog-header">
              <h2 id="import-title">นำเข้าข้อมูล</h2>
              <button
                type="button"
                aria-label="ปิดหน้าต่างนำเข้าข้อมูล"
                onClick={() => setIsImportOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="import-dialog-body">
              <button
                type="button"
                className="import-option-button"
                autoFocus
                onClick={() => void browse43FilesArchive()}
              >
                นำเข้า 43 แฟ้ม
              </button>
              {selected43Archive && (
                <p className="import-selected-file" title={selected43Archive} aria-live="polite">
                  {selected43Archive}
                </p>
              )}
              <button
                type="button"
                className="import-option-button"
                onClick={() => void browseBackupFile()}
              >
                นำเข้าข้อมูลสำรอง
              </button>
              {selectedBackupFile && (
                <p className="import-selected-file" title={selectedBackupFile} aria-live="polite">
                  {selectedBackupFile}
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {isSettingsOpen && (
        <div
          className="about-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingSettings) {
              setIsSettingsOpen(false)
            }
          }}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header className="settings-dialog-header">
              <h2 id="settings-title">ตั้งค่า</h2>
              <button
                type="button"
                aria-label="ปิดหน้าต่างตั้งค่า"
                disabled={isSavingSettings}
                onClick={() => setIsSettingsOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={(event) => void saveSettings(event)}>
              <div className="settings-dialog-body">
                <label htmlFor="settings-gistda-api-key">GISTDA API Key</label>
                {isLoadingSettings ? (
                  <p className="settings-loading" role="status">กำลังโหลด...</p>
                ) : (
                  <input
                    id="settings-gistda-api-key"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={settingsGistdaApiKey}
                    disabled={isSavingSettings}
                    onChange={(event) => setSettingsGistdaApiKey(event.target.value)}
                  />
                )}
                {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
              </div>

              <footer className="settings-dialog-footer">
                <button
                  type="button"
                  className="settings-cancel-button"
                  disabled={isSavingSettings}
                  onClick={() => setIsSettingsOpen(false)}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="settings-save-button"
                  disabled={isLoadingSettings || isSavingSettings}
                >
                  {isSavingSettings ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {isAboutOpen && (
        <div
          className="about-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsAboutOpen(false)
            }
          }}
        >
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            aria-describedby="about-description"
          >
            <header className="about-dialog-header">
              <span className="about-brand-mark" aria-hidden="true">T</span>
              <div>
                <h2 id="about-title">TopView</h2>
                <span>Desktop GIS Application</span>
              </div>
              <button
                type="button"
                aria-label="ปิดหน้าต่างเกี่ยวกับ"
                onClick={() => setIsAboutOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="about-dialog-body">
              <p id="about-description">
                แอปพลิเคชันแผนที่สำหรับจัดการและแสดงข้อมูลเชิงพื้นที่
              </p>
              <dl>
                <div>
                  <dt>เวอร์ชัน</dt>
                  <dd>{version ? `v${version}` : '—'}</dd>
                </div>
                <div>
                  <dt>แพลตฟอร์ม</dt>
                  <dd>Windows Desktop</dd>
                </div>
              </dl>

              <section className="about-developer" aria-labelledby="about-developer-title">
                <h3 id="about-developer-title">เกี่ยวกับผู้พัฒนา</h3>
                <p className="about-developer-name">นายอุเทน จาดยางโทน</p>
                <p>นักสาธารณสุขชำนาญการ</p>
                <p>กลุ่มงานสุขภาพดิจิทัล</p>
                <p>สำนักงานสาธารณสุขจังหวัดพิษณุโลก</p>
                <p>โทรศัพท์ 055xxxxxx</p>
              </section>
            </div>

            <footer className="about-dialog-footer">
              <button type="button" autoFocus onClick={() => setIsAboutOpen(false)}>
                ปิด
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
