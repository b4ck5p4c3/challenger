export type ScanCodeType = 'ean13' | 'chestny_znak'

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
  | { type: 'chestny_znak_registered_without_ean'; scanUnitId: string; message: 'saved_without_ean' }
  | { type: 'duplicate_chestny_znak'; message: 'already_added' }
  | { type: 'unsupported'; code: 'UNSUPPORTED_CODE'; msg: string }
  | { type: 'error'; code: string; msg: string; cause?: unknown }

export type ParsedChestnyZnak = {
  code: string
  gtin: string
  serial: string
  verificationCode: string
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
  return value.indexOf('\u001d', 18) > 18
}

export function parseChestnyZnak (value: string): ParsedChestnyZnak {
  if (!isChestnyZnak(value)) {
    throw new Error('Chestny Znak must contain a GTIN, serial number and FNC1 separator')
  }

  const gtin = value.slice(2, 16)
  const separatorIndex = value.indexOf('\u001d', 18)
  const serial = value.slice(18, separatorIndex)
  const verificationCode = value.slice(separatorIndex + 1)

  return {
    code: value,
    gtin: normalizeGtin(gtin),
    serial,
    verificationCode
  }
}

