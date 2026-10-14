export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_PUBLIC_API_URL ?? '/api'}${path}`, init)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `${response.status} ${response.statusText}`)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export interface Item {
  id: string
  brand: string
  name: string
  volume: number
  caffeine: number
  alcohol: number
  productCodes?: ProductCode[]
}

export interface ProductCode {
  id: string
  gtin: string
  productId: string | null
  product?: Item | null
  crptData: unknown | null
  edadealData: unknown | null
}

export function getItems(): Promise<Item[]> {
  return request('/products')
}

export const ITEMS_QUERY_KEY = 'items'

export interface ProductInput {
  brand: string
  name: string
  volume: number
  caffeine: number
  alcohol: number
}

export function createItem(data: ProductInput, productCodeId?: string): Promise<Item> {
  return request('/products', {
    body: JSON.stringify(productCodeId === undefined ? data : { ...data, productCodeId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
}

export function attachProductCode(productCodeId: string, productId: string): Promise<ProductCode> {
  return request(`/product-codes/${productCodeId}`, {
    body: JSON.stringify({ productId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH'
  })
}

export interface ScannedItem {
  id: string
  createdAt: string
  chestnyZnakCode: string | null
  chestnyZnakData: unknown | null
  productCode: ProductCode
}

export interface HistoryPage {
  scanUnits: ScannedItem[]
  total: number
}

export function getHistory(page: number): Promise<HistoryPage> {
  return request(`/scan-units?page=${page}`)
}

export const HISTORY_QUERY_KEY = 'history'

export interface Stats {
  day: StatsPeriod
  month: StatsPeriod
  total: StatsPeriod
}

export interface StatsPeriod {
  alcohol: number
  caffeine: number
  volume: number
}

export function getStats(): Promise<Stats> {
  return request('/stats')
}

export const STATS_QUERY_KEY = 'stats'

export function getItem(id: string): Promise<Item> {
  return request(`/products/${id}`)
}

export async function updateItem(id: string, data: Partial<Item>): Promise<void> {
  await request(`/products/${id}`, {
    body: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'PATCH'
  })
}

export type ProductDeleteMode = 'product' | 'product_with_history'

export async function deleteItem(id: string, mode: ProductDeleteMode): Promise<void> {
  await request(`/products/${id}`, {
    body: JSON.stringify({ mode }),
    headers: { 'Content-Type': 'application/json' },
    method: 'DELETE'
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
  throw new Error(`AI enrichment is disabled (${id})`)
}

export type ScanResult =
  | { type: 'ean_registered' | 'chestny_znak_paired' | 'chestny_znak_registered_without_ean'; scanUnitId: string }
  | { type: 'duplicate_chestny_znak' }
  | { type: 'unsupported' | 'error'; msg: string }

export function submitScan(rawCode: string, codeType: 'ean13' | 'chestny_znak'): Promise<ScanResult> {
  return request('/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawCode, codeType, adapterId: 'web-camera', correlationId: crypto.randomUUID() })
  })
}
