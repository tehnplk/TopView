import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  BackupDatabaseResult,
  DeleteGisFeatureResult,
  GisDataRecord,
  GisFeatureInfo,
  GisGeometry,
  GistdaWmsConfig,
  RestoreDatabaseProgress,
  RestoreDatabaseResult,
  SaveAppSettingsResult,
  SaveGisGeometryResult,
  UpdateGisFeatureInfoResult
} from '../shared/gis'

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  saveGisGeometry: (
    geometry: GisGeometry,
    info: GisFeatureInfo = {}
  ): Promise<SaveGisGeometryResult> => ipcRenderer.invoke('gis-data:save', geometry, info),
  listGisGeometry: (): Promise<GisDataRecord[]> => ipcRenderer.invoke('gis-data:list'),
  updateGisFeatureInfo: (
    id: number,
    info: GisFeatureInfo
  ): Promise<UpdateGisFeatureInfoResult> => ipcRenderer.invoke('gis-data:update-info', id, info),
  deleteGisFeature: (id: number): Promise<DeleteGisFeatureResult> =>
    ipcRenderer.invoke('gis-data:delete', id),
  backupDatabase: (): Promise<BackupDatabaseResult> => ipcRenderer.invoke('database:backup'),
  browse43FilesArchive: (): Promise<string | null> =>
    ipcRenderer.invoke('import:browse-43-files'),
  browseBackupFile: (): Promise<string | null> => ipcRenderer.invoke('import:browse-backup'),
  restoreDatabase: (backupPath: string): Promise<RestoreDatabaseResult> =>
    ipcRenderer.invoke('database:restore', backupPath),
  onRestoreDatabaseProgress: (
    callback: (progress: RestoreDatabaseProgress) => void
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: RestoreDatabaseProgress): void => {
      callback(progress)
    }

    ipcRenderer.on('database:restore-progress', listener)
    return () => ipcRenderer.removeListener('database:restore-progress', listener)
  },
  getGistdaWmsConfig: (): Promise<GistdaWmsConfig> => ipcRenderer.invoke('gistda-wms:get-config'),
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveAppSettings: (settings: AppSettings): Promise<SaveAppSettingsResult> =>
    ipcRenderer.invoke('settings:save', settings)
}

contextBridge.exposeInMainWorld('api', api)

export type DesktopApi = typeof api
