import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { GistdaWmsConfig, GistdaWmsLayerId } from '../shared/gis'
import { getConfigValue } from './database'

const GISTDA_BASE_URL = 'https://api-gateway.gistda.or.th/api/2.0/resources'
const WMS_DEFINITIONS: Record<GistdaWmsLayerId, { label: string; path: string }> = {
  'flood-1day': { label: 'น้ำท่วม 1 วัน', path: '/maps/flood/1day/wms' },
  'flood-3days': { label: 'น้ำท่วม 3 วัน', path: '/maps/flood/3days/wms' },
  'flood-7days': { label: 'น้ำท่วม 7 วัน', path: '/maps/flood/7days/wms' },
  'flood-30days': { label: 'น้ำท่วม 30 วัน', path: '/maps/flood/30days/wms' },
  'fire-3days': { label: 'ไฟป่า 3 วัน', path: '/maps/viirs/3days/wms' }
}

let proxyServer: Server | null = null
let proxyConfigPromise: Promise<GistdaWmsConfig> | null = null

function extractFirstLayerName(capabilities: string): string | null {
  const names = [...capabilities.matchAll(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/gi)]
    .map((match) => match[1].trim())
    .filter((name) => name !== 'OGC:WMS' && name !== 'Vallaris Maps WMS Root')

  return names[0] || null
}

async function fetchCapabilities(path: string, apiKey: string): Promise<string> {
  const url = new URL(`${GISTDA_BASE_URL}${path}`)
  url.searchParams.set('service', 'WMS')
  url.searchParams.set('request', 'GetCapabilities')
  url.searchParams.set('version', '1.3.0')

  const response = await fetch(url, {
    headers: { 'API-Key': apiKey }
  })

  if (!response.ok) {
    throw new Error(`GISTDA returned HTTP ${response.status}`)
  }

  return response.text()
}

function startProxyServer(apiKey: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    proxyServer = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*')

      try {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        const prefix = `/${token}/`

        if (!requestUrl.pathname.startsWith(prefix)) {
          response.writeHead(404).end()
          return
        }

        const layerId = requestUrl.pathname.slice(prefix.length) as GistdaWmsLayerId
        const definition = WMS_DEFINITIONS[layerId]

        if (!definition) {
          response.writeHead(404).end()
          return
        }

        const upstreamUrl = new URL(`${GISTDA_BASE_URL}${definition.path}`)
        requestUrl.searchParams.forEach((value, key) => {
          upstreamUrl.searchParams.append(key, value)
        })

        const upstreamResponse = await fetch(upstreamUrl, {
          headers: { 'API-Key': apiKey }
        })
        const contentType = upstreamResponse.headers.get('content-type')
        const cacheControl = upstreamResponse.headers.get('cache-control')

        if (contentType) {
          response.setHeader('Content-Type', contentType)
        }

        if (cacheControl) {
          response.setHeader('Cache-Control', cacheControl)
        }

        response.writeHead(upstreamResponse.status)
        response.end(Buffer.from(await upstreamResponse.arrayBuffer()))
      } catch (error) {
        console.error('Unable to proxy a GISTDA WMS request', error)
        response.writeHead(502).end()
      }
    })

    proxyServer.once('error', reject)
    proxyServer.listen(0, '127.0.0.1', () => {
      proxyServer?.off('error', reject)
      resolve((proxyServer?.address() as AddressInfo).port)
    })
  })
}

export function getGistdaWmsConfig(): Promise<GistdaWmsConfig> {
  if (!proxyConfigPromise) {
    proxyConfigPromise = (async () => {
      const databaseApiKey = await getConfigValue('GISTDA_API_KEY')
      const apiKey = databaseApiKey?.trim() || process.env.GISTDA_API_KEY?.trim()

      if (!apiKey) {
        return {
          layers: Object.entries(WMS_DEFINITIONS).map(([id, definition]) => ({
            id: id as GistdaWmsLayerId,
            label: definition.label,
            url: null,
            layers: null,
            error: 'กรุณาตั้งค่า GISTDA_API_KEY'
          }))
        }
      }

      const token = randomBytes(24).toString('hex')
      const port = await startProxyServer(apiKey, token)

      return {
        layers: await Promise.all(
          Object.entries(WMS_DEFINITIONS).map(async ([id, definition]) => {
            try {
              const capabilities = await fetchCapabilities(definition.path, apiKey)
              const layers = extractFirstLayerName(capabilities)

              if (!layers) {
                throw new Error('No WMS layer name was found')
              }

              return {
                id: id as GistdaWmsLayerId,
                label: definition.label,
                url: `http://127.0.0.1:${port}/${token}/${id}`,
                layers,
                error: null
              }
            } catch (error) {
              console.error(`Unable to initialize GISTDA WMS layer ${id}`, error)
              return {
                id: id as GistdaWmsLayerId,
                label: definition.label,
                url: null,
                layers: null,
                error: 'ไม่สามารถเชื่อมต่อ WMS ได้'
              }
            }
          })
        )
      }
    })()
  }

  return proxyConfigPromise
}

export function stopGistdaWmsProxy(): void {
  proxyServer?.close()
  proxyServer = null
  proxyConfigPromise = null
}
