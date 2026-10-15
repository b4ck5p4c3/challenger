import { escapeSpecialCharacters, isChestnyZnak, type ScanInput, type ScanResult } from '../domain/scanning'
import { getLogger } from '../logger'
import { FontSet, Shuttle, ShuttleClient, ShuttleServer, StringAlignment } from './protocol'

type ShuttleEndpoint = ShuttleClient | ShuttleServer
type ScanHandler = (input: ScanInput) => Promise<ScanResult>

function classify (rawCode: string): ScanInput['codeType'] | null {
  if (/^\d{13}$/.test(rawCode)) return 'ean13'
  if (isChestnyZnak(rawCode)) return 'chestny_znak'
  return null
}

export class ShuttleAdapter {
  readonly id = 'shuttle'
  private readonly logger = getLogger<ShuttleAdapter>()

  constructor (private readonly endpoint: ShuttleEndpoint, private readonly handleScan: ScanHandler) {
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
        await this.handleResult(shuttle, { type: 'processing' })
        const rawCode = escapeSpecialCharacters(data.toString('ascii'))
        const codeType = classify(rawCode)
        this.logger.debug(`Shuttle scan received: bytes=${data.length}, characters=${rawCode.length}, text=${JSON.stringify(rawCode)}, hex=${data.toString('hex')}`)
        this.logger.debug(`Shuttle scan classified as: ${codeType ?? 'unsupported'}`)
        const result = codeType
          ? await this.handleScan({
            adapterId: this.id,
            codeType,
            rawCode,
            receivedAt: new Date()
          })
          : {
            code: 'UNSUPPORTED_CODE',
            msg: 'Unsupported scanner input',
            type: 'unsupported'
          } satisfies ScanResult

        if (!codeType) {
          this.logger.warn(`Unsupported Shuttle scan: bytes=${data.length}, characters=${rawCode.length}`)
        }

        await this.handleResult(shuttle, result)
        await shuttle.sendEnableScanning(true)
      }).catch(error => {
        console.error('Shuttle adapter connection disabled:', error)
        shuttle.close()
      })
    })
  }

  private async handleResult (shuttle: Shuttle, result: ScanResult): Promise<void> {
    await shuttle.sendClearDisplayAndMoveToTopLeft()
    await shuttle.sendSelectFontSet(FontSet.NORMAL)
    const value = this.messageFor(result)
    let line = ''
    for (const char of value) {
      if (Buffer.byteLength(line + char, 'utf8') > 75) break
      line += char
    }
    await shuttle.sendPrintAlignedString(StringAlignment.CENTER_CENTER, line)
  }

  private messageFor (result: ScanResult): string {
    switch (result.type) {
      case 'processing': return 'Processing...'
      case 'ean_registered': return 'Сканируйте ЧестныйЗнак'
      case 'chestny_znak_paired': return 'Сохранено'
      case 'chestny_znak_registered_without_ean': return 'Сохранено без EAN'
      case 'duplicate_chestny_znak': return 'Уже добавлено'
      case 'unsupported': return result.msg
      case 'error': return result.msg
    }
  }
}
