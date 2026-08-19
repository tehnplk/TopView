import { contextBridge, ipcRenderer } from 'electron'
import type {
  BackupDatabaseResult,
  DeleteGisFeatureResult,
  GisDataRecord,
  GisFeatureInfo,
  GisGeometry,
  GistdaWmsConfig,
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
  getGistdaWmsConfig: (): Promise<GistdaWmsConfig> => ipcRenderer.invoke('gistda-wms:get-config')
}

contextBridge.exposeInMainWorld('api', api)

export type DesktopApi = typeof api
