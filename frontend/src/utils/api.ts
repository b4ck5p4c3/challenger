async function getData<T>(path: string, query?: Record<string, string>): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_PUBLIC_API_URL}${path}${query ? `?${new URLSearchParams(query)}` : ''}`)
  return response.json()
}

export interface Item {
  id: string
  ean13: string
  brand: string
  name: string
  volume: number
  caffeine: number
  alcohol: number
  filled: boolean
  edadealData: unknown | null
  crptEanData: unknown | null
}

export function getItems(): Promise<Item[]> {
  return getData('/items')
}

export const ITEMS_QUERY_KEY = 'items'

export interface ScannedItem {
  id: string
  createdAt: string
  crptLabelId: string | null
  crptLabelData: unknown | null
  item: Item
}

export interface HistoryPage {
  scannedItems: ScannedItem[]
  total: number
}

export function getHistory(page: number): Promise<HistoryPage> {
  return getData('/history', { page: page.toString() })
}

export const HISTORY_QUERY_KEY = 'history'

export function getItem(id: string): Promise<Item> {
  return getData(`/items/${id}`)
}

export async function updateItem(id: string, data: Partial<Item>): Promise<void> {
  await fetch(`${import.meta.env.VITE_PUBLIC_API_URL}/items/${id}`, {
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'PATCH'
  })
}

export interface ItemData {
  brand?: string
  name?: string
  volume?: number
  caffeine?: number
  alcohol?: number
  caffeineConcentration?: number
  alcoholPercent?: number
}

export async function doAiMagicOnItem(id: string): Promise<ItemData> {
  const response = await fetch(`${import.meta.env.VITE_PUBLIC_API_URL}/items/${id}/ai`, {
    method: 'POST'
  })
  if (response.status == 200) {
    return await response.json()
  }
  return {}
}