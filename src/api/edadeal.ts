export interface EdadealFacet {
  descriptionData?: unknown
  images: {
    filter: string
  }
  recordId: string
  request: string
  shortDescription: string
  title: string
}

export interface EdadealResult {
  blocks: {
    component: string
    params: Record<string, unknown>
  }[]
  brand: {
    name: string
    uuid: string
  }
  facets: Record<string, EdadealFacet>
  features: Record<string, boolean>
  imageList: string[]
  imageMain: string
  itemType: 'sku'
  segmentUuids: string[]
  title: string
  type: {
    id: string
    name: string
  }
  uuid: string
}

const EDADEAL_HOST = 'https://api.edadeal.ru'

export class EdadealNotFoundError extends Error {}

export class EdadealAPI {
  async search (sku: string): Promise<EdadealResult> {
    const response = await fetch(`${EDADEAL_HOST}/api/search/api/v4/item/${sku}?adultContent=true&type=sku`)
    if (response.status === 404) {
      throw new EdadealNotFoundError(await response.text())
    }
    if (response.status !== 200) {
      throw new Error(`request failed: ${await response.text()}`)
    }
    return await response.json()
  }
}
