import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { app } from 'electron'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  AppSettings,
  BackupDatabaseResult,
  DeleteGisFeatureResult,
  GisDataRecord,
  GisFeatureType,
  GisFeatureInfo,
  GisGeometry,
  GisLayer,
  RestoreDatabaseProgress,
  RestoreDatabaseResult,
  SaveAppSettingsResult,
  SaveGisGeometryResult,
  UpdateGisFeatureInfoResult
} from '../shared/gis'

let databasePromise: Promise<PGlite> | null = null

type RestoreProgressCallback = (progress: RestoreDatabaseProgress) => void

function getDatabaseDirectory(): string {
  return join(app.getPath('userData'), 'topview-pglite')
}

async function initializeDatabase(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE EXTENSION IF NOT EXISTS postgis;

    CREATE TABLE IF NOT EXISTS gis_layers (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      geometry_type TEXT NOT NULL CHECK (geometry_type IN ('Point', 'LineString', 'Polygon')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE gis_layers
    ADD COLUMN IF NOT EXISTS geometry_type TEXT;

    CREATE TABLE IF NOT EXISTS gis_data (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      spatial geometry(Geometry, 4326) NOT NULL,
      info JSONB NOT NULL DEFAULT '{}'::jsonb,
      layer_id INTEGER REFERENCES gis_layers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE gis_data
    ADD COLUMN IF NOT EXISTS info JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE gis_data
    ADD COLUMN IF NOT EXISTS layer_id INTEGER REFERENCES gis_layers(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS config (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );
  `)

  await database.exec(`
    UPDATE gis_layers
    SET geometry_type = COALESCE(
      (
        SELECT CASE GeometryType(gis_data.spatial)
          WHEN 'POINT' THEN 'Point'
          WHEN 'LINESTRING' THEN 'LineString'
          WHEN 'POLYGON' THEN 'Polygon'
          ELSE NULL
        END
        FROM gis_data
        WHERE gis_data.layer_id = gis_layers.id
        ORDER BY gis_data.id
        LIMIT 1
      ),
      'Point'
    )
    WHERE geometry_type IS NULL;

    ALTER TABLE gis_layers
    ALTER COLUMN geometry_type SET NOT NULL;
  `)

  const configColumns = await database.query<{ columnName: string }>(`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'config';
  `)
  const configColumnNames = new Set(configColumns.rows.map((column) => column.columnName))

  if (configColumnNames.has('key') && !configColumnNames.has('value')) {
    await database.exec('ALTER TABLE config RENAME COLUMN "key" TO value;')
  }
}

async function validateDatabase(database: PGlite): Promise<void> {
  await database.query('SELECT COUNT(*) FROM gis_data;')
  await database.query('SELECT COUNT(*) FROM gis_layers;')
  await database.query('SELECT COUNT(*) FROM config;')
  await database.query('SELECT PostGIS_Version();')
}

async function validateBackupSchema(database: PGlite): Promise<void> {
  const result = await database.query<{ gisData: string | null; config: string | null }>(`
    SELECT
      to_regclass('public.gis_data')::text AS "gisData",
      to_regclass('public.config')::text AS config;
  `)
  const tables = result.rows[0]

  if (!tables?.gisData || !tables.config) {
    throw new Error('ไฟล์นี้ไม่ใช่ฐานข้อมูลสำรองของ TopView')
  }
}

function assertManagedDatabaseDirectory(directory: string): void {
  const userDataDirectory = resolve(app.getPath('userData'))
  const resolvedDirectory = resolve(directory)
  const directoryName = basename(resolvedDirectory)

  if (
    dirname(resolvedDirectory) !== userDataDirectory ||
    (directoryName !== 'topview-pglite' && !directoryName.startsWith('topview-pglite-'))
  ) {
    throw new Error('Refusing to modify a directory outside the TopView database area')
  }
}

async function removeManagedDatabaseDirectory(directory: string): Promise<void> {
  assertManagedDatabaseDirectory(directory)
  await rm(directory, { recursive: true, force: true })
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  )
}

function coordinatesMatch(first: [number, number], last: [number, number]): boolean {
  return first[0] === last[0] && first[1] === last[1]
}

function isGisGeometry(value: unknown): value is GisGeometry {
  if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value)) {
    return false
  }

  if (value.type === 'Point') {
    return isCoordinate(value.coordinates)
  }

  if (value.type === 'LineString') {
    return (
      Array.isArray(value.coordinates) &&
      value.coordinates.length >= 2 &&
      value.coordinates.every(isCoordinate)
    )
  }

  if (value.type !== 'Polygon' || !Array.isArray(value.coordinates) || value.coordinates.length === 0) {
    return false
  }

  return value.coordinates.every((ring) => {
    return (
      Array.isArray(ring) &&
      ring.length >= 4 &&
      ring.every(isCoordinate) &&
      coordinatesMatch(ring[0], ring[ring.length - 1])
    )
  })
}

function isGisFeatureType(value: unknown): value is GisFeatureType {
  return value === 'Point' || value === 'LineString' || value === 'Polygon'
}

function isGisFeatureInfo(value: unknown): value is GisFeatureInfo {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function serializeGisFeatureInfo(value: unknown): string {
  if (!isGisFeatureInfo(value)) {
    throw new Error('Invalid GIS feature info')
  }

  const serialized = JSON.stringify(value)

  if (serialized.length > 65_536) {
    throw new Error('GIS feature info is too large')
  }

  return serialized
}

function parseGisFeatureInfo(value: unknown): GisFeatureInfo {
  if (isGisFeatureInfo(value)) {
    return value
  }

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return isGisFeatureInfo(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  return {}
}

function formatBangkokTimestamp(date: Date): string {
  const bangkokDate = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  const pad = (value: number): string => value.toString().padStart(2, '0')

  return [
    bangkokDate.getUTCFullYear(),
    pad(bangkokDate.getUTCMonth() + 1),
    pad(bangkokDate.getUTCDate()),
    pad(bangkokDate.getUTCHours()),
    pad(bangkokDate.getUTCMinutes()),
    pad(bangkokDate.getUTCSeconds())
  ].join('')
}

export async function getDatabase(): Promise<PGlite> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = new PGlite({
        dataDir: getDatabaseDirectory(),
        extensions: { postgis }
      })

      await database.waitReady
      await initializeDatabase(database)

      return database
    })()
  }

  return databasePromise
}

export async function saveGisGeometry(
  value: unknown,
  layerIdValue: unknown,
  infoValue: unknown = {}
): Promise<SaveGisGeometryResult> {
  if (!isGisGeometry(value)) {
    throw new Error('Invalid GIS geometry')
  }

  if (!Number.isInteger(layerIdValue) || (layerIdValue as number) <= 0) {
    throw new Error('Invalid GIS layer id')
  }

  const info = serializeGisFeatureInfo(infoValue)
  const database = await getDatabase()
  const result = await database.query<{ id: number }>(
    `
      INSERT INTO gis_data (spatial, info, layer_id)
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2::jsonb, id
      FROM gis_layers
      WHERE id = $3 AND geometry_type = $4
      RETURNING id;
    `,
    [JSON.stringify(value), info, layerIdValue, value.type]
  )
  const savedRow = result.rows[0]

  if (!savedRow) {
    throw new Error('GIS geometry type does not match the selected layer')
  }

  return { id: savedRow.id }
}

export async function listGisGeometry(): Promise<GisDataRecord[]> {
  const database = await getDatabase()
  const result = await database.query<{
    id: number
    spatial: string
    info: unknown
    layerId: number | null
    layerName: string | null
  }>(`
    SELECT
      gis_data.id,
      ST_AsGeoJSON(gis_data.spatial) AS spatial,
      gis_data.info,
      gis_data.layer_id AS "layerId",
      gis_layers.name AS "layerName"
    FROM gis_data
    LEFT JOIN gis_layers ON gis_layers.id = gis_data.layer_id
    WHERE gis_data.spatial IS NOT NULL
    ORDER BY gis_data.id;
  `)

  return result.rows.flatMap((row) => {
    try {
      const spatial: unknown = JSON.parse(row.spatial)
      return isGisGeometry(spatial)
        ? [{
            id: row.id,
            spatial,
            info: parseGisFeatureInfo(row.info),
            layerId: row.layerId,
            layerName: row.layerName
          }]
        : []
    } catch {
      return []
    }
  })
}

export async function listGisLayers(): Promise<GisLayer[]> {
  const database = await getDatabase()
  const result = await database.query<GisLayer>(`
    SELECT id, name, geometry_type AS "geometryType"
    FROM gis_layers
    ORDER BY LOWER(name), id;
  `)

  return result.rows
}

export async function createGisLayer(
  nameValue: unknown,
  geometryTypeValue: unknown
): Promise<GisLayer> {
  if (typeof nameValue !== 'string') {
    throw new Error('Invalid GIS layer name')
  }

  const name = nameValue.trim()

  if (!name || name.length > 100) {
    throw new Error('GIS layer name must contain 1 to 100 characters')
  }

  if (!isGisFeatureType(geometryTypeValue)) {
    throw new Error('Invalid GIS layer feature type')
  }

  const database = await getDatabase()
  const result = await database.query<GisLayer>(
    `
      INSERT INTO gis_layers (name, geometry_type)
      SELECT $1, $2
      WHERE NOT EXISTS (
        SELECT 1 FROM gis_layers WHERE LOWER(name) = LOWER($1)
      )
      RETURNING id, name, geometry_type AS "geometryType";
    `,
    [name, geometryTypeValue]
  )
  const layer = result.rows[0]

  if (!layer) {
    throw new Error('GIS layer name already exists')
  }

  return layer
}

export async function updateGisFeatureInfo(
  idValue: unknown,
  infoValue: unknown
): Promise<UpdateGisFeatureInfoResult> {
  if (!Number.isInteger(idValue) || (idValue as number) <= 0) {
    throw new Error('Invalid GIS feature id')
  }

  const info = serializeGisFeatureInfo(infoValue)
  const database = await getDatabase()
  const result = await database.query<{ id: number; info: unknown }>(
    `
      UPDATE gis_data
      SET info = $2::jsonb
      WHERE id = $1
      RETURNING id, info;
    `,
    [idValue, info]
  )
  const updatedRow = result.rows[0]

  if (!updatedRow) {
    throw new Error('GIS feature was not found')
  }

  return {
    id: updatedRow.id,
    info: parseGisFeatureInfo(updatedRow.info)
  }
}

export async function deleteGisFeature(idValue: unknown): Promise<DeleteGisFeatureResult> {
  if (!Number.isInteger(idValue) || (idValue as number) <= 0) {
    throw new Error('Invalid GIS feature id')
  }

  const database = await getDatabase()
  const result = await database.query<{ id: number }>(
    'DELETE FROM gis_data WHERE id = $1 RETURNING id;',
    [idValue]
  )
  const deletedRow = result.rows[0]

  if (!deletedRow) {
    throw new Error('GIS feature was not found')
  }

  return { id: deletedRow.id }
}

export async function backupDatabase(): Promise<BackupDatabaseResult> {
  const database = await getDatabase()
  await database.syncToFs()

  const dump = await database.dumpDataDir('gzip')
  const backupData = Buffer.from(await dump.arrayBuffer())
  const backupDirectory = join(app.getPath('home'), '.topview')
  const timestamp = formatBangkokTimestamp(new Date())
  const backupPath = join(backupDirectory, `topview_${timestamp}.tar.gz`)

  await mkdir(backupDirectory, { recursive: true })
  await writeFile(backupPath, backupData, { flag: 'wx' })

  return {
    path: backupPath,
    size: backupData.byteLength
  }
}

export async function restoreDatabase(
  backupPathValue: unknown,
  onProgress?: RestoreProgressCallback
): Promise<RestoreDatabaseResult> {
  const reportProgress = (percent: number, message: string): void => {
    onProgress?.({ percent, message })
  }

  reportProgress(5, 'กำลังตรวจสอบไฟล์สำรอง')

  if (typeof backupPathValue !== 'string' || !backupPathValue.toLowerCase().endsWith('.tar.gz')) {
    throw new Error('กรุณาเลือกไฟล์สำรองนามสกุล .tar.gz')
  }

  const backupPath = resolve(backupPathValue)
  const backupFile = await stat(backupPath)

  if (!backupFile.isFile() || backupFile.size === 0) {
    throw new Error('ไฟล์สำรองไม่ถูกต้องหรือไม่มีข้อมูล')
  }

  const backupData = await readFile(backupPath)

  if (backupData[0] !== 0x1f || backupData[1] !== 0x8b) {
    throw new Error('ไฟล์สำรองไม่ใช่ไฟล์ gzip ที่ถูกต้อง')
  }

  reportProgress(15, 'กำลังสำรองฐานข้อมูลปัจจุบันเพื่อความปลอดภัย')
  const safetyBackup = await backupDatabase()
  const operationId = `${Date.now()}-${process.pid}`
  const databaseDirectory = getDatabaseDirectory()
  const stagingDirectory = join(
    app.getPath('userData'),
    `topview-pglite-restore-${operationId}`
  )
  const recoveryDirectory = join(
    app.getPath('userData'),
    `topview-pglite-recovery-${operationId}`
  )
  let stagingDatabase: PGlite | null = null
  let activeDatabaseClosed = false
  let currentDatabaseMoved = false
  let restoredDatabaseMoved = false

  try {
    reportProgress(30, 'กำลังทดสอบไฟล์สำรอง')
    const loadDataDir = new Blob([Uint8Array.from(backupData)])
    stagingDatabase = new PGlite({
      dataDir: stagingDirectory,
      loadDataDir,
      extensions: { postgis }
    })

    await stagingDatabase.waitReady
    await validateBackupSchema(stagingDatabase)
    await initializeDatabase(stagingDatabase)
    await validateDatabase(stagingDatabase)
    await stagingDatabase.close()
    stagingDatabase = null

    reportProgress(55, 'กำลังปิดฐานข้อมูลปัจจุบัน')
    const activeDatabase = await getDatabase()
    await activeDatabase.close()
    databasePromise = null
    activeDatabaseClosed = true

    reportProgress(70, 'กำลังติดตั้งฐานข้อมูลจากไฟล์สำรอง')
    await rename(databaseDirectory, recoveryDirectory)
    currentDatabaseMoved = true
    await rename(stagingDirectory, databaseDirectory)
    restoredDatabaseMoved = true

    reportProgress(88, 'กำลังเปิดและตรวจสอบฐานข้อมูลที่นำเข้า')
    const restoredDatabase = await getDatabase()
    await validateDatabase(restoredDatabase)

    try {
      await removeManagedDatabaseDirectory(recoveryDirectory)
    } catch (cleanupError) {
      console.error('Unable to remove the temporary recovery database', cleanupError)
    }

    currentDatabaseMoved = false
    reportProgress(100, 'นำเข้าข้อมูลสำรองเรียบร้อยแล้ว')

    return {
      restored: true,
      path: backupPath,
      safetyBackupPath: safetyBackup.path
    }
  } catch (error) {
    if (stagingDatabase) {
      await stagingDatabase.close().catch(() => undefined)
    }

    if (currentDatabaseMoved) {
      try {
        if (databasePromise) {
          const failedRestoredDatabase = await databasePromise.catch(() => null)

          if (failedRestoredDatabase && !failedRestoredDatabase.closed) {
            await failedRestoredDatabase.close()
          }
        }

        databasePromise = null

        if (restoredDatabaseMoved) {
          await removeManagedDatabaseDirectory(databaseDirectory)
        }

        await rename(recoveryDirectory, databaseDirectory)
        currentDatabaseMoved = false
        await getDatabase()
      } catch (rollbackError) {
        const restoreMessage = error instanceof Error ? error.message : String(error)
        const rollbackMessage =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)

        throw new Error(
          `Restore failed: ${restoreMessage}. Automatic rollback also failed: ${rollbackMessage}`
        )
      }
    } else if (activeDatabaseClosed) {
      databasePromise = null
      await getDatabase()
    }

    await removeManagedDatabaseDirectory(stagingDirectory).catch(() => undefined)
    throw error
  }
}

export async function getConfigValue(name: string): Promise<string | null> {
  const database = await getDatabase()
  const result = await database.query<{ value: string }>(
    'SELECT value FROM config WHERE name = $1 LIMIT 1;',
    [name]
  )

  return result.rows[0]?.value ?? null
}

export async function getAppSettings(): Promise<AppSettings> {
  return {
    gistdaApiKey: (await getConfigValue('GISTDA_API_KEY')) ?? ''
  }
}

export async function saveAppSettings(value: unknown): Promise<SaveAppSettingsResult> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('gistdaApiKey' in value) ||
    typeof value.gistdaApiKey !== 'string'
  ) {
    throw new Error('Invalid application settings')
  }

  const gistdaApiKey = value.gistdaApiKey.trim()

  if (gistdaApiKey.length > 2_048) {
    throw new Error('GISTDA API key is too long')
  }

  const database = await getDatabase()
  await database.query(
    `
      INSERT INTO config (name, value)
      VALUES ($1, $2)
      ON CONFLICT (name)
      DO UPDATE SET value = EXCLUDED.value;
    `,
    ['GISTDA_API_KEY', gistdaApiKey]
  )

  return { saved: true }
}
