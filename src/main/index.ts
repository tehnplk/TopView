import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { getDatabase, listGisGeometry, saveGisGeometry, updateGisFeatureInfo } from './database'
import { getGistdaWmsConfig, stopGistdaWmsProxy } from './gistdaWms'

app.disableHardwareAcceleration()
Menu.setApplicationMenu(null)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:get-version', () => {
    return app.getVersion()
  })
  ipcMain.handle('gis-data:save', (_event, geometry: unknown, info: unknown) => {
    return saveGisGeometry(geometry, info)
  })
  ipcMain.handle('gis-data:list', () => {
    return listGisGeometry()
  })
  ipcMain.handle('gis-data:update-info', (_event, id: unknown, info: unknown) => {
    return updateGisFeatureInfo(id, info)
  })
  ipcMain.handle('gistda-wms:get-config', () => {
    return getGistdaWmsConfig()
  })

  void getDatabase().catch((error: unknown) => {
    console.error('Unable to initialize the GIS database', error)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopGistdaWmsProxy()
})
