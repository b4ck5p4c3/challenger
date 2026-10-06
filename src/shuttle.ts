import type { Server, Socket } from 'node:net'

import { createConnection, createServer } from 'node:net'

import { getLogger } from './logger'
import { AbstractEmitter } from './mitt'

type ShuttleEvents = {
  close: boolean
  error: Error
  scan: Buffer
}

export enum StringAlignment {
  BOTTOM_WITH_CURRENT_X = 0x3E,
  CENTER_BOTTOM = 0x37,
  CENTER_CENTER = 0x34,
  CENTER_TOP = 0x31,
  CENTER_WITH_CURRENT_X = 0x3D,
  CENTER_WITH_CURRENT_Y = 0x3A,
  LEFT_BOTTOM = 0x36,
  LEFT_CENTER = 0x33,
  LEFT_TOP = 0x30,
  LEFT_WITH_CURRENT_Y = 0x39,
  RIGHT_BOTTOM = 0x38,
  RIGHT_CENTER = 0x35,
  RIGHT_TOP = 0x32,
  RIGHT_WITH_CURRENT_Y = 0x3B,
  TOP_WITH_CURRENT_X = 0x3C
}

export enum FontSet {
  LARGE = 0x31,
  NORMAL = 0x30
}

export class Shuttle extends AbstractEmitter<ShuttleEvents> {
  private buffer: number[] = []
  private currentAwaitedAck: (() => void) | null = null
  private readonly logger = getLogger<Shuttle>()

  constructor (private readonly socket: Socket) {
    super()
    socket.on('data', data => this.handleData(data))
    socket.on('error', error => this.emit('error', error))
    socket.on('close', hadError => this.emit('close', hadError))
  }

  close (): void {
    this.socket.destroy()
  }

  handleByte (byte: number) {
    if (byte === 0x06) {
      this.processAck()
      return
    }
    if (byte === 0x0A) {
      return
    }
    if (byte === 0x0D) {
      this.emit('scan', Buffer.from(this.buffer))
      this.buffer = []
      return
    }
    this.buffer.push(byte)
  }

  handleData (data: Buffer): void {
    for (const byte of data) {
      this.handleByte(byte)
    }
  }

  processAck () {
    if (!this.currentAwaitedAck) {
      this.logger.warn('received ACK without awaited resolver')
      return
    }
    const awaitedAck = this.currentAwaitedAck
    this.currentAwaitedAck = null
    awaitedAck()
  }

  sendBeep (): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x5E]))
  }

  sendBytes (data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => this.socket.write(data, error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }))
  }

  sendClearDisplayAndMoveToTopLeft (): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x24]))
  }

  sendEnableBacklight (enable: boolean): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x5C, enable ? 0x31 : 0x30]))
  }

  sendEnableScanning (enable: boolean): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x5B, enable ? 0x31 : 0x30]))
  }

  sendPrintAlignedString (alignment: StringAlignment, value: string): Promise<void> {
    const bytes = Buffer.from(value, 'utf8')
    if (bytes.length > 75) {
      throw new Error('string length must be <= 75 bytes')
    }
    return this.sendBytes(Buffer.concat([Buffer.from([0x1B, 0x2E, alignment]),
      bytes, Buffer.from(bytes.length === 75 ? [] : [0x03])]))
  }

  sendSelectFontSet (fontSet: FontSet): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x42, fontSet]))
  }

  sendSetCursorPosition (position: number, line: number): Promise<void> {
    if (position < 0 || position > 15) {
      throw new Error('position must be in [0; 15]')
    }
    if (line < 0 || line > 4) {
      throw new Error('line must be in [0; 4]')
    }
    return this.sendBytes(Buffer.from([0x1B, 0x27, position + 0x30, line + 0x30]))
  }

  sendSetPixelPosition (position: number, line: number): Promise<void> {
    if (position < 0 || position > 127) {
      throw new Error('position must be in [0; 127]')
    }
    if (line < 0 || line > 63) {
      throw new Error('line must be in [0; 63]')
    }
    return this.sendBytes(Buffer.from([0x1B, 0x2C, position + 0x30, line + 0x30]))
  }

  sendShowGif (gifId: number): Promise<void> {
    if (gifId < 1 || gifId > 4) {
      throw new Error('gif id must be in [1; 4]')
    }
    return this.sendBytes(Buffer.from([0x1B, 0x58, gifId + 0x30]))
  }

  sendSleep (): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x40]))
  }

  sendSleepOrWakeupScanner (wakeup: boolean): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x5B, wakeup ? 0x31 : 0x30]))
  }

  sendSoftReset (): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x5A]))
  }

  sendString (value: string): Promise<void> {
    return this.sendBytes(Buffer.from(value, 'utf8'))
  }

  sendWakeUp (): Promise<void> {
    return this.sendBytes(Buffer.from([0x1B, 0x41]))
  }
}

// Server Mode

type ShuttleServerEvents = {
  connection: Shuttle;
}

export class ShuttleServer extends AbstractEmitter<ShuttleServerEvents> {
  private readonly logger = getLogger<ShuttleServer>()
  private readonly server: Server

  constructor (private readonly port: number) {
    super()
    this.server = createServer(socket => this.handleSocket(socket))
  }

  private handleSocket (socket: Socket) {
    this.logger.info(`new client from ${socket.remoteAddress}:${socket.remotePort}`)
    this.emit('connection', new Shuttle(socket))
  }

  close (): void {
    this.server.close()
  }

  start (): Promise<void> {
    this.logger.info(`starting shuttle server on :${this.port}...`)
    let resolvePromise: () => void
    let rejectPromise: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    this.server.on('listening', () => {
      resolvePromise()
    })
    this.server.on('error', error => {
      rejectPromise(error)
    })
    this.server.listen(this.port)
    return promise
  }
}

// Client Mode

type ShuttleClientEvents = {
  connection: Shuttle;
}

export class ShuttleClient extends AbstractEmitter<ShuttleClientEvents> {
  private readonly logger = getLogger<ShuttleClient>()
  private socket: null | Socket = null

  constructor (private readonly host: string, private readonly port: number) {
    super()
  }

  close (): void {
    this.socket?.destroy()
  }

  start (): Promise<void> {
    this.logger.info(`trying establish connection to shuttle...`)
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port })
      this.socket = socket
      const handleError = (error: Error) => {
        reject(error)
      }
      socket.once('error', handleError)
      socket.once('connect', () => {
        socket.off('error', handleError)
        this.logger.info(`connected to ${this.host}:${this.port}`)
        this.emit('connection', new Shuttle(socket))
        resolve()
      })
    })
  }
}