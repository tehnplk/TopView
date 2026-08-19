import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { app } from 'electron'
import { join } from 'node:path'
import type {
  DeleteGisFeatureResult,
  GisDataRecord,
  GisFeatureInfo,
  GisGeometry,
  SaveGisGeometryResult,
  UpdateGisFeatureInfoResult
} from '../shared/gis'

let databasePromise: Promise<PGlite> | null = null

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

export async function getDatabase(): Promise<PGlite> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = new PGlite({
        dataDir: join(app.getPath('userData'), 'topview-pglite'),
        extensions: { postgis }
      })

      await database.waitReady
      await database.exec(`
        CREATE EXTENSION IF NOT EXISTS postgis;

        CREATE TABLE IF NOT EXISTS gis_data (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          spatial geometry(Geometry, 4326) NOT NULL,
          info JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE gis_data
        ADD COLUMN IF NOT EXISTS info JSONB NOT NULL DEFAULT '{}'::jsonb;

        CREATE TABLE IF NOT EXISTS config (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          "key" TEXT NOT NULL
        );
      `)

      return database
    })()
  }

  return databasePromise
}

export async function saveGisGeometry(
  value: unknown,
  infoValue: unknown = {}
): Promise<SaveGisGeometryResult> {
  if (!isGisGeometry(value)) {
    throw new Error('Invalid GIS geometry')
  }

  const info = serializeGisFeatureInfo(infoValue)
  const database = await getDatabase()
  const result = await database.query<{ id: number }>(
    `
      INSERT INTO gis_data (spatial, info)
      VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2::jsonb)
      RETURNING id;
    `,
    [JSON.stringify(value), info]
  )
  const savedRow = result.rows[0]

  if (!savedRow) {
    throw new Error('GIS geometry was not saved')
  }

  return { id: savedRow.id }
}

export async function listGisGeometry(): Promise<GisDataRecord[]> {
  const database = await getDatabase()
  const result = await database.query<{ id: number; spatial: string; info: unknown }>(`
    SELECT id, ST_AsGeoJSON(spatial) AS spatial, info
    FROM gis_data
    WHERE spatial IS NOT NULL
    ORDER BY id;
  `)

  return result.rows.flatMap((row) => {
    try {
      const spatial: unknown = JSON.parse(row.spatial)
      return isGisGeometry(spatial)
        ? [{ id: row.id, spatial, info: parseGisFeatureInfo(row.info) }]
        : []
    } catch {
      return []
    }
  })
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

export async function getConfigValue(name: string): Promise<string | null> {
  const database = await getDatabase()
  const result = await database.query<{ key: string }>(
    'SELECT "key" FROM config WHERE name = $1 LIMIT 1;',
    [name]
  )

  return result.rows[0]?.key ?? null
}
