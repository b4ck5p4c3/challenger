import {
  escapeSpecialCharacters,
  isChestnyZnak,
  type ScanInput,
  type ScanResult,
  type ScanStats,
  type ScanTemplateContext,
  type ScanTemplateScanUnit
} from '../domain/scanning'
import { getLogger } from '../logger'
import { Shuttle, ShuttleClient, ShuttleServer } from './protocol'

type ShuttleEndpoint = ShuttleClient | ShuttleServer
type ScanHandler = (input: ScanInput) => Promise<ScanResult>
type StatsReader = () => Promise<ScanStats>
type ScanUnitReader = (id: string) => Promise<ScanTemplateScanUnit | null>
type TemplateSender = (shuttle: Shuttle, context: ScanTemplateContext) => Promise<void>

function classify (rawCode: string): ScanInput['codeType'] | null {
  if (/^\d{13}$/.test(rawCode)) return 'ean13'
  if (isChestnyZnak(rawCode)) return 'chestny_znak'
  return null
}

export class ShuttleAdapter {
  readonly id = 'shuttle'
  private readonly logger = getLogger<ShuttleAdapter>()

  constructor (
    private readonly endpoint: ShuttleEndpoint,
    private readonly handleScan: ScanHandler,
    private readonly readStats: StatsReader,
    private readonly readScanUnit: ScanUnitReader,
    private readonly sendTemplate: TemplateSender
  ) {
    endpoint.on('connection', shuttle => this.handleConnection(shuttle))
  }

  start (): Promise<void> {
    return this.endpoint.start()
  }

  async stop (): Promise<void> {
    this.endpoint.close()
  }

  private handleConnection (shuttle: Shuttle): void {
    let queue = Promise.resolve()
    shuttle.on('error', error => console.error('Shuttle connection failed:', error))
    shuttle.on('scan', data => {
      queue = queue.then(async () => {
        await shuttle.sendEnableScanning(false)
        const rawCode = escapeSpecialCharacters(data.toString('ascii'))
        const codeType = classify(rawCode)
        const receivedAt = new Date()
        const scan = {
          adapterId: this.id,
          codeType,
          rawCode,
          receivedAt: receivedAt.toISOString()
        }
        const input = codeType
          ? {
            adapterId: this.id,
            codeType,
            rawCode,
            receivedAt
          }
          : undefined
        const statsBefore = await this.readStatsSafely()
        await this.sendTemplate(shuttle, this.createContext(scan, { type: 'processing' }, null, statsBefore, null))
        this.logger.debug(`Shuttle scan received: bytes=${data.length}, characters=${rawCode.length}, text=${JSON.stringify(rawCode)}, hex=${data.toString('hex')}`)
        this.logger.debug(`Shuttle scan classified as: ${codeType ?? 'unsupported'}`)
        const result: ScanResult = input
          ? await this.handleScan(input)
          : {
            code: 'UNSUPPORTED_CODE',
            type: 'unsupported'
          }

        if (!codeType) {
          this.logger.warn(`Unsupported Shuttle scan: bytes=${data.length}, characters=${rawCode.length}`)
        }

        const statsAfter = await this.readStatsSafely()
        const scanUnitId = 'scanUnitId' in result ? result.scanUnitId : undefined
        const scanUnit = scanUnitId === undefined ? null : await this.readScanUnitSafely(scanUnitId)
        await this.sendTemplate(shuttle, this.createContext(scan, result, scanUnit, statsBefore, statsAfter))
        await shuttle.sendEnableScanning(true)
      }).catch(error => {
        console.error('Shuttle adapter connection disabled:', error)
        shuttle.close()
      })
    })
  }

  private async readStatsSafely (): Promise<ScanStats | null> {
    try {
      return await this.readStats()
    } catch (error) {
      this.logger.warn('failed to read scan statistics for Shuttle template:', error)
      return null
    }
  }

  private async readScanUnitSafely (id: string): Promise<ScanTemplateScanUnit | null> {
    try {
      return await this.readScanUnit(id)
    } catch (error) {
      this.logger.warn('failed to read scan unit for Shuttle template:', error)
      return null
    }
  }

  private createContext (
    scan: ScanTemplateContext['scan'],
    result: ScanResult,
    scanUnit: ScanTemplateScanUnit | null,
    statsBefore: ScanStats | null,
    statsAfter: ScanStats | null
  ): ScanTemplateContext {
    const resultData = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'cause'))
    return {
      result: resultData,
      scan,
      scanUnit,
      situation: result.type,
      stats: {
        after: statsAfter,
        before: statsBefore
      }
    }
  }
}
