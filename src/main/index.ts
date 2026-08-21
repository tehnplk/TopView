import { app, BrowserWindow, dialog, ipcMain, Menu, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import {
  backupDatabase,
  deleteGisFeature,
  createGisLayer,
  getAppSettings,
  getDatabase,
  listGisGeometry,
  listGisLayers,
  restoreDatabase,
  saveAppSettings,
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
  ipcMain.handle('gis-data:save', (_event, geometry: unknown, layerId: unknown, info: unknown) => {
    return saveGisGeometry(geometry, layerId, info)
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
  ipcMain.handle('gis-layer:list', () => {
    return listGisLayers()
  })
  ipcMain.handle('gis-layer:create', (_event, name: unknown, geometryType: unknown) => {
    return createGisLayer(name, geometryType)
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
  ipcMain.handle('database:restore', async (event, backupPath: unknown) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const confirmOptions = {
      type: 'warning' as const,
      title: 'นำเข้าข้อมูลสำรอง',
      message: 'ต้องการแทนที่ฐานข้อมูลปัจจุบันหรือไม่',
      detail:
        'แอปจะสำรองฐานข้อมูลปัจจุบันให้อัตโนมัติก่อนเริ่ม และจะกู้คืนฐานเดิมหากนำเข้าไม่สำเร็จ',
      buttons: ['ยกเลิก', 'นำเข้าข้อมูล'],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    }
    const confirmation = parentWindow
      ? await dialog.showMessageBox(parentWindow, confirmOptions)
      : await dialog.showMessageBox(confirmOptions)

    if (confirmation.response !== 1) {
      return { restored: false } as const
    }

    try {
      const result = await restoreDatabase(backupPath, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('database:restore-progress', progress)
        }
      })

      if (!result.restored) {
        throw new Error('Database restore did not complete')
      }

      const successOptions = {
        type: 'info' as const,
        title: 'นำเข้าข้อมูลสำรอง',
        message: 'นำเข้าข้อมูลสำรองเรียบร้อยแล้ว',
        detail: `ฐานข้อมูลเดิมถูกสำรองไว้ที่:\n${result.safetyBackupPath}`,
        buttons: ['ตกลง']
      }

      if (parentWindow) {
        await dialog.showMessageBox(parentWindow, successOptions)
      } else {
        await dialog.showMessageBox(successOptions)
      }

      return result
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
      const errorOptions = {
        type: 'error' as const,
        title: 'นำเข้าข้อมูลสำรอง',
        message: 'ไม่สามารถนำเข้าข้อมูลสำรองได้',
        detail,
        buttons: ['ตกลง']
      }

      if (parentWindow) {
        await dialog.showMessageBox(parentWindow, errorOptions)
      } else {
        await dialog.showMessageBox(errorOptions)
      }

      throw error
    }
  })
  ipcMain.handle('gistda-wms:get-config', () => {
    return getGistdaWmsConfig()
  })
  ipcMain.handle('settings:get', () => {
    return getAppSettings()
  })
  ipcMain.handle('settings:save', async (_event, settings: unknown) => {
    const result = await saveAppSettings(settings)
    stopGistdaWmsProxy()
    return result
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
