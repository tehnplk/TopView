export type GisPointGeometry = {
  type: 'Point'
  coordinates: [number, number]
}

export type GisPolygonGeometry = {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export type GisGeometry = GisPointGeometry | GisPolygonGeometry

export type GisFeatureInfo = Record<string, unknown>

export type SaveGisGeometryResult = {
  id: number
}

export type UpdateGisFeatureInfoResult = {
  id: number
  info: GisFeatureInfo
}

export type GisDataRecord = {
  id: number
  spatial: GisGeometry
  info: GisFeatureInfo
}

export type GistdaWmsLayerId =
  | 'flood-1day'
  | 'flood-3days'
  | 'flood-7days'
  | 'flood-30days'
  | 'fire-3days'

export type GistdaWmsLayerConfig = {
  id: GistdaWmsLayerId
  label: string
  url: string | null
  layers: string | null
  error: string | null
}

export type GistdaWmsConfig = {
  layers: GistdaWmsLayerConfig[]
}
