import { app, BrowserWindow, dialog, ipcMain, Menu, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import {
  backupDatabase,
  deleteGisFeature,
  getDatabase,
  listGisGeometry,
  saveGisGeometry,
  updateGisFeatureInfo
} from './database'
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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#4658df',
      symbolColor: '#ffffff',
      height: 35
    },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
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
  ipcMain.handle('gis-data:delete', (_event, id: unknown) => {
    return deleteGisFeature(id)
  })
  ipcMain.handle('database:backup', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)

    try {
      const result = await backupDatabase()
      const options = {
        type: 'info' as const,
        title: 'สำรองข้อมูล',
        message: 'สำรองฐานข้อมูลเรียบร้อยแล้ว',
        detail: result.path,
        buttons: ['ตกลง']
      }

      if (parentWindow) {
        await dialog.showMessageBox(parentWindow, options)
      } else {
        await dialog.showMessageBox(options)
      }

      return result
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
      const options = {
        type: 'error' as const,
        title: 'สำรองข้อมูล',
        message: 'ไม่สามารถสำรองฐานข้อมูลได้',
        detail,
        buttons: ['ตกลง']
      }

      if (parentWindow) {
        await dialog.showMessageBox(parentWindow, options)
      } else {
        await dialog.showMessageBox(options)
      }

      throw error
    }
  })
  ipcMain.handle('import:browse-43-files', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'เลือกไฟล์ ZIP ข้อมูล 43 แฟ้ม',
      properties: ['openFile'],
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('import:browse-backup', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'เลือกไฟล์สำรอง TopView',
      properties: ['openFile'],
      filters: [{ name: 'TopView Backup (*.tar.gz)', extensions: ['gz'] }]
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
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
