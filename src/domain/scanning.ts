export type ScanCodeType = 'ean13' | 'chestny_znak'

export const scanSituations = [
  'processing',
  'ean_registered',
  'chestny_znak_paired',
  'chestny_znak_registered',
  'duplicate_chestny_znak',
  'unsupported',
  'error'
] as const

export type ScanSituation = typeof scanSituations[number]

export type ScanInput = {
  adapterId: string
  codeType: ScanCodeType
  rawCode: string
  receivedAt: Date
  correlationId?: string
}

export type ScanResult =
  | { type: 'processing' }
  | { type: 'ean_registered'; scanUnitId: string; message: 'scan_chestny_znak' }
  | { type: 'chestny_znak_paired'; scanUnitId: string; message: 'saved' }
  | { type: 'chestny_znak_registered'; scanUnitId: string; message: 'saved' }
  | { type: 'duplicate_chestny_znak'; scanUnitId: string; message: 'already_added' }
  | { type: 'unsupported'; code: 'UNSUPPORTED_CODE'; msg?: string }
  | { type: 'error'; code: string; msg: string; cause?: unknown }

export type StatsPeriod = {
  alcohol: number
  caffeine: number
  volume: number
}

export type ScanStats = {
  day: StatsPeriod
  month: StatsPeriod
  total: StatsPeriod
}

export type ScanTemplateProduct = {
  id: string
  brand: string
  name: string
  volume: number
  caffeine: number
  alcohol: number
  createdAt: string
  updatedAt: string
}

export type ScanTemplateProductCode = {
  id: string
  gtin: string
  productId: string | null
  crptData: unknown
  edadealData: unknown
  createdAt: string
  updatedAt: string
  product: ScanTemplateProduct | null
}

export type ScanTemplateScanUnit = {
  id: string
  productCodeId: string
  chestnyZnakCode: string | null
  chestnyZnakData: unknown
  createdAt: string
  updatedAt: string
  productCode: ScanTemplateProductCode
}

export type ScanTemplateContext = {
  situation: ScanSituation
  scan: {
    adapterId: string
    codeType: ScanCodeType | null
    rawCode: string
    receivedAt: string
    correlationId?: string
  }
  result: Record<string, unknown>
  scanUnit: ScanTemplateScanUnit | null
  stats: {
    before: ScanStats | null
    after: ScanStats | null
  }
}

export type ParsedChestnyZnak = {
  code: string
  gtin: string
  serial: string
  verificationCode: string
}

export const FNC1_ESCAPE = '\\u001D'

const controlCharacterPattern = /[\u0000-\u001F\u007F-\u009F]/g

export function escapeSpecialCharacters (value: string): string {
  return value.replace(controlCharacterPattern, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`)
}

function findFnc1 (value: string, fromIndex: number): number {
  const match = /\\u001[dD]/.exec(value.slice(fromIndex))
  return match ? fromIndex + match.index : -1
}

export function normalizeGtin (value: string): string {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) {
    throw new Error('GTIN must contain 8, 12, 13 or 14 digits')
  }
  return value.length === 14 && value.startsWith('0') ? value.slice(1) : value
}

export function parseEan13 (value: string): string {
  if (!/^\d{13}$/.test(value)) {
    throw new Error('EAN13 must contain exactly 13 digits')
  }
  return value
}

export function isChestnyZnak (value: string): boolean {
  if (!value.startsWith('01')) return false
  if (!/^\d{14}$/.test(value.slice(2, 16))) return false
  if (value.slice(16, 18) !== '21') return false
  return findFnc1(value, 18) > 18
}

export function parseChestnyZnak (value: string): ParsedChestnyZnak {
  if (!isChestnyZnak(value)) {
    throw new Error('Chestny Znak must contain a GTIN, serial number and FNC1 separator')
  }

  const gtin = value.slice(2, 16)
  const separatorIndex = findFnc1(value, 18)
  const serial = value.slice(18, separatorIndex)
  const verificationCode = value.slice(separatorIndex + FNC1_ESCAPE.length)

  return {
    code: value,
    gtin: normalizeGtin(gtin),
    serial,
    verificationCode
  }
}

