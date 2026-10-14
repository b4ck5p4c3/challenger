import { CrptAPI } from '../api/crpt'
import { EdadealAPI } from '../api/edadeal'
import { Prisma, type PrismaClient } from '../generated/prisma/client'
import {
  normalizeGtin,
  parseChestnyZnak,
  parseEan13,
  type ScanInput,
  type ScanResult
} from '../domain/scanning'

function asJson (value: unknown) {
  return value == null ? Prisma.DbNull : JSON.parse(JSON.stringify(value)) as never
}

export class ScanService {
  private queue: Promise<unknown> = Promise.resolve()
  constructor (
    private readonly prisma: PrismaClient,
    private readonly crpt: CrptAPI,
    private readonly edadeal: EdadealAPI
  ) {}

  process (input: ScanInput): Promise<ScanResult> {
    // Serialize registration and pairing so two scans cannot claim the same unit.
    const result = this.queue.then(() => this.processInput(input))
    this.queue = result.catch(() => {})
    return result
  }

  private async processInput (input: ScanInput): Promise<ScanResult> {
    try {
      if (input.codeType === 'ean13') {
        return await this.processEan(input.rawCode)
      }
      return await this.processChestnyZnak(input.rawCode)
    } catch (error) {
      return {
        cause: error,
        code: 'SCAN_FAILED',
        msg: error instanceof Error ? error.message : String(error),
        type: 'error'
      }
    }
  }

  private async processEan (rawCode: string): Promise<ScanResult> {
    const gtin = parseEan13(rawCode)
    const productCode = await this.getOrCreateProductCode(gtin)
    const scanUnit = await this.prisma.scanUnit.create({
      data: {
        productCodeId: productCode.id
      }
    })

    return {
      message: 'scan_chestny_znak',
      scanUnitId: scanUnit.id,
      type: 'ean_registered'
    }
  }

  private async processChestnyZnak (rawCode: string): Promise<ScanResult> {
    const parsed = parseChestnyZnak(rawCode)
    const existing = await this.prisma.scanUnit.findUnique({
      where: { chestnyZnakCode: parsed.code }
    })
    if (existing) {
      return { message: 'already_added', type: 'duplicate_chestny_znak' }
    }

    const productCode = await this.getOrCreateProductCode(parsed.gtin)
    let labelData: unknown
    try {
      labelData = await this.crpt.checkDataMatrix(parsed.code)
    } catch (error) {
      console.warn('Chestny Znak enrichment failed:', error)
    }
    const pairingCutoff = new Date(Date.now() - 5 * 60 * 1000)
    const pending = await this.prisma.scanUnit.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        chestnyZnakCode: null,
        createdAt: { gte: pairingCutoff },
        productCodeId: productCode.id
      }
    })

    if (pending) {
      await this.prisma.scanUnit.update({
        data: {
          chestnyZnakCode: parsed.code,
          chestnyZnakData: asJson(labelData)
        },
        where: { id: pending.id }
      })
      return { message: 'saved', scanUnitId: pending.id, type: 'chestny_znak_paired' }
    }

    const scanUnit = await this.prisma.scanUnit.create({
      data: {
        chestnyZnakCode: parsed.code,
        chestnyZnakData: asJson(labelData),
        productCodeId: productCode.id
      }
    })
    return {
      message: 'saved_without_ean',
      scanUnitId: scanUnit.id,
      type: 'chestny_znak_registered_without_ean'
    }
  }

  private async getOrCreateProductCode (gtinValue: string) {
    const gtin = normalizeGtin(gtinValue)
    const existing = await this.prisma.productCode.findUnique({ where: { gtin } })
    if (existing) {
      return existing
    }

    const [crptData, edadealData] = await Promise.all([
      this.fetchCrpt(gtin),
      this.fetchEdadeal(gtin)
    ])
    return await this.prisma.productCode.create({
      data: {
        crptData: asJson(crptData),
        edadealData: asJson(edadealData),
        gtin
      }
    })
  }

  private async fetchCrpt (gtin: string): Promise<unknown> {
    try {
      return await this.crpt.checkEan(gtin)
    } catch (error) {
      console.warn('CRPT product enrichment failed:', error)
      return undefined
    }
  }

  private async fetchEdadeal (gtin: string): Promise<unknown> {
    try {
      return await this.edadeal.search(gtin)
    } catch (error) {
      console.warn('Edadeal enrichment failed:', error)
      return undefined
    }
  }
}
