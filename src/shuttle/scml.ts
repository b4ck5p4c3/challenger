import { FontSet, Shuttle, StringAlignment } from './protocol'

export type ScmlErrorCode =
  | 'ERR_UNCLOSED_TAG'
  | 'ERR_UNKNOWN_CMD'
  | 'ERR_ARG_COUNT'
  | 'ERR_OUT_OF_RANGE'
  | 'ERR_ALIGN_OVERFLOW'

export class ScmlError extends Error {
  constructor (
    readonly code: ScmlErrorCode,
    message: string,
    readonly position?: number
  ) {
    super(`${code}${position === undefined ? '' : ` at ${position}`}: ${message}`)
    this.name = 'ScmlError'
  }
}

export type ScmlInstruction =
  | { type: 'bytes'; data: Buffer }
  | { type: 'delay'; milliseconds: number }

export interface ScmlProgram {
  instructions: ScmlInstruction[]
}

const alignmentAliases: Record<string, StringAlignment> = {
  BCX: StringAlignment.BOTTOM_WITH_CURRENT_X,
  CB: StringAlignment.CENTER_BOTTOM,
  CC: StringAlignment.CENTER_CENTER,
  CCX: StringAlignment.CENTER_WITH_CURRENT_X,
  CCY: StringAlignment.CENTER_WITH_CURRENT_Y,
  CT: StringAlignment.CENTER_TOP,
  LB: StringAlignment.LEFT_BOTTOM,
  LC: StringAlignment.LEFT_CENTER,
  LCY: StringAlignment.LEFT_WITH_CURRENT_Y,
  LT: StringAlignment.LEFT_TOP,
  RB: StringAlignment.RIGHT_BOTTOM,
  RC: StringAlignment.RIGHT_CENTER,
  RCY: StringAlignment.RIGHT_WITH_CURRENT_Y,
  RT: StringAlignment.RIGHT_TOP,
  TCX: StringAlignment.TOP_WITH_CURRENT_X
}

const alignmentNames: Record<string, StringAlignment> = {
  BOTTOM_WITH_CURRENT_X: StringAlignment.BOTTOM_WITH_CURRENT_X,
  CENTER_BOTTOM: StringAlignment.CENTER_BOTTOM,
  CENTER_CENTER: StringAlignment.CENTER_CENTER,
  CENTER_TOP: StringAlignment.CENTER_TOP,
  CENTER_WITH_CURRENT_X: StringAlignment.CENTER_WITH_CURRENT_X,
  CENTER_WITH_CURRENT_Y: StringAlignment.CENTER_WITH_CURRENT_Y,
  LEFT_BOTTOM: StringAlignment.LEFT_BOTTOM,
  LEFT_CENTER: StringAlignment.LEFT_CENTER,
  LEFT_TOP: StringAlignment.LEFT_TOP,
  LEFT_WITH_CURRENT_Y: StringAlignment.LEFT_WITH_CURRENT_Y,
  RIGHT_BOTTOM: StringAlignment.RIGHT_BOTTOM,
  RIGHT_CENTER: StringAlignment.RIGHT_CENTER,
  RIGHT_TOP: StringAlignment.RIGHT_TOP,
  RIGHT_WITH_CURRENT_Y: StringAlignment.RIGHT_WITH_CURRENT_Y,
  TOP_WITH_CURRENT_X: StringAlignment.TOP_WITH_CURRENT_X
}

const commandNames = new Set([
  'ACK',
  'ALIGN',
  'BEEP',
  'BL',
  'CLEAR',
  'CR',
  'ETX',
  'ESC',
  'FONT',
  'GIF',
  'LF',
  'POS',
  'PX',
  'RESET',
  'SCAN',
  'SLEEP',
  'WAKE'
])

class ScmlCompiler {
  private readonly instructions: ScmlInstruction[] = []
  private cursor = 0

  constructor (private readonly source: string) {}

  compile (): ScmlProgram {
    while (this.cursor < this.source.length) {
      if (this.source[this.cursor] === '<') {
        this.compileTag()
      } else {
        this.compilePlainText()
      }
    }
    return { instructions: this.instructions }
  }

  private compileTag (): void {
    const tagStart = this.cursor
    const closingBracket = this.findClosingBracket(this.cursor + 1)
    if (closingBracket === -1) {
      throw new ScmlError('ERR_UNCLOSED_TAG', 'opening bracket has no closing bracket', tagStart)
    }

    const rawTag = this.source.slice(this.cursor + 1, closingBracket)
    this.cursor = closingBracket + 1
    if (rawTag.startsWith('/')) {
      throw new ScmlError('ERR_UNKNOWN_CMD', `unknown command: ${rawTag}`, tagStart)
    }

    const separator = rawTag.indexOf(':')
    const rawName = separator === -1 ? rawTag : rawTag.slice(0, separator)
    const name = rawName.trim().toUpperCase()
    const rawArguments = separator === -1 ? null : rawTag.slice(separator + 1)
    const args = rawArguments === null
      ? []
      : rawArguments.split(',').map(argument => argument.trim())

    if (/^0X[0-9A-F]{2}$/i.test(name)) {
      this.requireArgumentCount(name, args, 0, tagStart)
      this.addBytes(Buffer.from([Number.parseInt(name.slice(2), 16)]))
      return
    }

    if (!commandNames.has(name)) {
      throw new ScmlError('ERR_UNKNOWN_CMD', `unknown command: ${rawName.trim()}`, tagStart)
    }

    switch (name) {
      case 'ACK':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x06]))
        return
      case 'BEEP':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x1B, 0x5E]))
        return
      case 'CLEAR':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x1B, 0x24]))
        return
      case 'CR':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x0D]))
        return
      case 'ESC':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x1B]))
        return
      case 'ETX':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x03]))
        return
      case 'FONT':
        this.compileFont(args, tagStart)
        return
      case 'GIF':
        this.compileGif(args, tagStart)
        return
      case 'LF':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x0A]))
        return
      case 'POS':
        this.compilePosition(args, tagStart, 15, 4, 0x27)
        return
      case 'PX':
        this.compilePosition(args, tagStart, 127, 63, 0x2C)
        return
      case 'RESET':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x1B, 0x5A]))
        return
      case 'SCAN':
        this.compileToggle(name, args, tagStart, [0x1B, 0x5B])
        return
      case 'SLEEP':
        this.compileSleep(args, tagStart)
        return
      case 'WAKE':
        this.requireArgumentCount(name, args, 0, tagStart)
        this.addBytes(Buffer.from([0x1B, 0x41]))
        return
      case 'BL':
        this.compileToggle(name, args, tagStart, [0x1B, 0x5C])
        return
      case 'ALIGN':
        this.compileAlign(args, tagStart)
        return
    }
  }

  private compileAlign (args: string[], tagStart: number): void {
    this.requireArgumentCount('ALIGN', args, 1, tagStart)
    const alignment = this.parseAlignment(args[0] ?? '', tagStart)
    const contentStart = this.cursor
    const close = this.findAlignClose(contentStart)
    if (!close) {
      throw new ScmlError('ERR_UNCLOSED_TAG', 'ALIGN block has no </ALIGN>', tagStart)
    }

    const content = decodePlainText(this.source.slice(contentStart, close.start))
    const bytes = Buffer.from(content, 'utf8')
    if (bytes.length > 75) {
      throw new ScmlError('ERR_ALIGN_OVERFLOW', 'ALIGN text must be at most 75 UTF-8 bytes', tagStart)
    }
    this.addBytes(Buffer.concat([
      Buffer.from([0x1B, 0x2E, alignment]),
      bytes,
      bytes.length === 75 ? Buffer.alloc(0) : Buffer.from([0x03])
    ]))
    this.cursor = close.end
  }

  private compileFont (args: string[], tagStart: number): void {
    this.requireArgumentCount('FONT', args, 1, tagStart)
    const value = (args[0] ?? '').toUpperCase()
    const font = value === 'NORM' || value === 'NORMAL'
      ? FontSet.NORMAL
      : value === 'LARGE'
        ? FontSet.LARGE
        : undefined
    if (font === undefined) {
      throw new ScmlError('ERR_UNKNOWN_CMD', `unknown FONT value: ${args[0] ?? ''}`, tagStart)
    }
    this.addBytes(Buffer.from([0x1B, 0x42, font]))
  }

  private compileGif (args: string[], tagStart: number): void {
    this.requireArgumentCount('GIF', args, 1, tagStart)
    const id = this.parseInteger(args[0] ?? '', tagStart)
    this.requireRange('GIF id', id, 1, 4, tagStart)
    this.addBytes(Buffer.from([0x1B, 0x58, id + 0x30]))
  }

  private compilePosition (args: string[], tagStart: number, maxPosition: number, maxLine: number, command: number): void {
    this.requireArgumentCount('position', args, 2, tagStart)
    const position = this.parseInteger(args[0] ?? '', tagStart)
    const line = this.parseInteger(args[1] ?? '', tagStart)
    this.requireRange('position', position, 0, maxPosition, tagStart)
    this.requireRange('line', line, 0, maxLine, tagStart)
    this.addBytes(Buffer.from([0x1B, command, position + 0x30, line + 0x30]))
  }

  private compileSleep (args: string[], tagStart: number): void {
    if (args.length === 0) {
      this.addBytes(Buffer.from([0x1B, 0x40]))
      return
    }
    this.requireArgumentCount('SLEEP', args, 1, tagStart)
    const milliseconds = this.parseInteger(args[0] ?? '', tagStart)
    this.requireRange('sleep milliseconds', milliseconds, 0, 2_147_483_647, tagStart)
    this.instructions.push({ milliseconds, type: 'delay' })
  }

  private compileToggle (name: string, args: string[], tagStart: number, prefix: [number, number]): void {
    this.requireArgumentCount(name, args, 1, tagStart)
    const value = (args[0] ?? '').toUpperCase()
    const enabled = value === 'ON' || value === '1'
    const disabled = value === 'OFF' || value === '0'
    if (!enabled && !disabled) {
      throw new ScmlError('ERR_UNKNOWN_CMD', `unknown ${name} value: ${args[0] ?? ''}`, tagStart)
    }
    this.addBytes(Buffer.from([...prefix, enabled ? 0x31 : 0x30]))
  }

  private findAlignClose (start: number): { end: number; start: number } | null {
    let index = start
    while (index < this.source.length) {
      const character = this.source[index]
      if (character === '\\') {
        index += 2
        continue
      }
      if (character !== '<') {
        index += 1
        continue
      }
      const closingBracket = this.findClosingBracket(index + 1)
      if (closingBracket === -1) return null
      const tag = this.source.slice(index + 1, closingBracket).trim().toUpperCase()
      if (tag === '/ALIGN') return { end: closingBracket + 1, start: index }
      throw new ScmlError('ERR_UNKNOWN_CMD', `ALIGN block contains command: ${tag}`, index)
    }
    return null
  }

  private findClosingBracket (start: number): number {
    let escaped = false
    for (let index = start; index < this.source.length; index += 1) {
      const character = this.source[index]
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '>') {
        return index
      }
    }
    return -1
  }

  private compilePlainText (): void {
    const start = this.cursor
    while (this.cursor < this.source.length) {
      if (this.source[this.cursor] === '<') break
      if (this.source[this.cursor] === '\\') this.cursor += 1
      this.cursor += 1
    }
    const text = decodePlainText(this.source.slice(start, this.cursor))
    if (text.length > 0) this.addBytes(Buffer.from(text, 'utf8'))
  }

  private parseAlignment (value: string, position: number): StringAlignment {
    const normalized = value.trim().toUpperCase()
    const alignment = alignmentAliases[normalized] ?? alignmentNames[normalized]
    if (alignment === undefined) {
      throw new ScmlError('ERR_UNKNOWN_CMD', `unknown alignment: ${value}`, position)
    }
    return alignment
  }

  private parseInteger (value: string, position: number): number {
    if (!/^[+-]?\d+$/.test(value)) {
      throw new ScmlError('ERR_OUT_OF_RANGE', `expected integer, got: ${value}`, position)
    }
    const number = Number(value)
    if (!Number.isSafeInteger(number)) {
      throw new ScmlError('ERR_OUT_OF_RANGE', `integer is out of range: ${value}`, position)
    }
    return number
  }

  private requireArgumentCount (name: string, args: string[], expected: number, position: number): void {
    if (args.length !== expected) {
      throw new ScmlError('ERR_ARG_COUNT', `${name} expects ${expected} argument${expected === 1 ? '' : 's'}, got ${args.length}`, position)
    }
  }

  private requireRange (name: string, value: number, minimum: number, maximum: number, position: number): void {
    if (value < minimum || value > maximum) {
      throw new ScmlError('ERR_OUT_OF_RANGE', `${name} must be in [${minimum}; ${maximum}], got ${value}`, position)
    }
  }

  private addBytes (data: Buffer): void {
    if (data.length === 0) return
    const previous = this.instructions.at(-1)
    if (previous?.type === 'bytes') {
      previous.data = Buffer.concat([previous.data, data])
    } else {
      this.instructions.push({ data, type: 'bytes' })
    }
  }
}

function decodePlainText (source: string): string {
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character !== '\\') {
      result += character
      continue
    }
    const escaped = source[index + 1]
    if (escaped === '<' || escaped === '>' || escaped === '\\') {
      result += escaped
      index += 1
    } else {
      result += '\\'
    }
  }
  return result
}

export function compileScml (source: string): ScmlProgram {
  return new ScmlCompiler(source).compile()
}

export async function executeScml (program: ScmlProgram, shuttle: Shuttle, signal?: AbortSignal): Promise<void> {
  for (const instruction of program.instructions) {
    if (signal?.aborted) throw new Error('SCML execution aborted')
    if (instruction.type === 'delay') {
      await waitWithAbort(instruction.milliseconds, signal)
    } else {
      await shuttle.sendBytes(instruction.data)
    }
  }
}

function waitWithAbort (milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('SCML execution aborted'))
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new Error('SCML execution aborted'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
