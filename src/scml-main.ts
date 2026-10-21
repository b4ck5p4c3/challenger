import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import { config } from 'dotenv'
import z from 'zod'

import { Shuttle, ShuttleClient, ShuttleServer } from './shuttle/protocol'
import { compileScml, executeScml, ScmlError, type ScmlProgram } from './shuttle/scml'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

const environment = z.object({
  SHUTTLE_CLIENT_HOST: z.string().min(1).optional(),
  SHUTTLE_CLIENT_PORT: z.coerce.number().int().positive().default(1337),
  SHUTTLE_SERVER_PORT: z.coerce.number().int().positive().default(1337)
}).parse(process.env)

process.env.SCML_QUIET_LOGS = '1'

interface CliOptions {
  filePath?: string
  help: boolean
  keepOpen: boolean
}

interface QueuedProgram {
  label: string
  program: ScmlProgram
}

interface ConnectionState {
  abort: AbortController
  queue: Promise<void>
  shuttle: Shuttle
}

function usage (): string {
  return [
    'SCML Shuttle console',
    '',
    'Usage:',
    '  bun src/scml-main.ts [--file path | -f path | path] [-c|--continue]',
    '',
    'Connection mode is selected from environment:',
    '  SHUTTLE_CLIENT_HOST + SHUTTLE_CLIENT_PORT  connect as a client',
    '  SHUTTLE_SERVER_PORT                           wait as a TCP server',
    '',
    'The file is compiled before the first byte is sent.',
    'With -c/--continue it is replayed on every connection and the console stays open.',
    'Without it, a file run exits five seconds after completion.',
    'Type SCML lines in the console. Use :help, :cr, :quit or :exit for local commands.'
  ].join('\n')
}

function parseArguments (argv: string[]): CliOptions {
  let filePath: string | undefined
  let help = false
  let keepOpen = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '-h' || argument === '--help') {
      help = true
      continue
    }
    if (argument === '-c' || argument === '--continue') {
      keepOpen = true
      continue
    }
    if (argument === '-f' || argument === '--file') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) throw new Error(`${argument} expects a file path`)
      filePath = value
      index += 1
      continue
    }
    if (argument.startsWith('-f=')) {
      const value = argument.slice('-f='.length)
      if (!value) throw new Error('-f expects a file path')
      filePath = value
      continue
    }
    if (argument.startsWith('--file=')) {
      const value = argument.slice('--file='.length)
      if (!value) throw new Error('--file expects a file path')
      filePath = value
      continue
    }
    if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`)
    if (filePath !== undefined) throw new Error(`unexpected argument: ${argument}`)
    filePath = argument
  }

  return { help, keepOpen, ...(filePath === undefined ? {} : { filePath }) }
}

function printError (error: unknown): void {
  console.error(formatError(error))
}

function formatError (error: unknown): string {
  if (error instanceof ScmlError || error instanceof Error) return error.message
  return String(error)
}

async function readProgram (filePath: string | undefined): Promise<QueuedProgram | undefined> {
  if (!filePath) return undefined
  const source = await readFile(filePath, 'utf8')
  return {
    label: `file ${filePath}`,
    program: compileScml(source)
  }
}

async function main (): Promise<void> {
  let options: CliOptions
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    printError(error)
    console.error(`\n${usage()}`)
    process.exitCode = 2
    return
  }

  if (options.help) {
    console.log(usage())
    return
  }

  let replay: QueuedProgram | undefined
  try {
    replay = await readProgram(options.filePath)
  } catch (error) {
    printError(error)
    process.exitCode = 1
    return
  }

  if (!options.keepOpen && !replay) {
    console.error('a SCML file is required unless -c/--continue is specified')
    process.exitCode = 2
    return
  }

  const endpoint = environment.SHUTTLE_CLIENT_HOST
    ? new ShuttleClient(environment.SHUTTLE_CLIENT_HOST, environment.SHUTTLE_CLIENT_PORT)
    : new ShuttleServer(environment.SHUTTLE_SERVER_PORT)

  let active: ConnectionState | undefined
  const pending: QueuedProgram[] = []
  let replayStarted = false
  let stopped = false
  let finishTimer: ReturnType<typeof setTimeout> | undefined
  let readline: ReturnType<typeof createInterface> | undefined
  let sendCarriageReturn = false

  const writeMessage = (message: string, error = false): void => {
    if (stopped) return
    if (readline && process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[2K${message}\n`)
      readline.prompt(true)
      return
    }
    if (error) {
      console.error(message)
    } else {
      console.log(message)
    }
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (finishTimer) clearTimeout(finishTimer)
    readline?.close()
    active?.abort.abort()
    active?.shuttle.close()
    endpoint.close()
  }

  const finishOneShot = (): void => {
    if (stopped || options.keepOpen) return
    writeMessage('SCML file completed; exiting in 5 seconds')
    finishTimer = setTimeout(stop, 5_000)
  }

  const schedule = (state: ConnectionState, item: QueuedProgram, onFinished?: () => void): void => {
    state.queue = state.queue
      .then(async () => {
        await executeScml(item.program, state.shuttle, state.abort.signal)
        writeMessage(`sent ${item.label}`)
      })
      .catch(error => {
        writeMessage(`failed to send ${item.label}: ${formatError(error)}`, true)
      })
      .finally(() => onFinished?.())
  }

  const enqueue = (item: QueuedProgram): boolean => {
    if (!active) {
      pending.push(item)
      writeMessage(`queued ${item.label}; waiting for Shuttle connection`)
      return true
    }
    schedule(active, item)
    return false
  }

  endpoint.on('connection', shuttle => {
    if (active && active.shuttle !== shuttle) active.shuttle.close()
    const state: ConnectionState = { abort: new AbortController(), queue: Promise.resolve(), shuttle }
    active = state
    writeMessage('Shuttle connected')
    shuttle.on('error', error => {
      writeMessage(`Shuttle connection error: ${error.message}`, true)
    })
    shuttle.on('close', () => {
      state.abort.abort()
      if (active === state) active = undefined
      writeMessage('Shuttle disconnected')
    })

    if (replay && (options.keepOpen || !replayStarted)) {
      replayStarted = true
      schedule(state, replay, finishOneShot)
    }
    for (const item of pending.splice(0)) schedule(state, item)
  })

  try {
    await endpoint.start()
  } catch (error) {
    printError(error)
    process.exitCode = 1
    return
  }

  if (endpoint instanceof ShuttleClient) {
    writeMessage(`connecting to Shuttle at ${environment.SHUTTLE_CLIENT_HOST}:${environment.SHUTTLE_CLIENT_PORT}`)
  } else {
    writeMessage(`waiting for Shuttle connection on :${environment.SHUTTLE_SERVER_PORT}`)
  }

  process.once('SIGINT', stop)
  if (!options.keepOpen) {
    process.stdin.pause()
    return
  }

  readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    ...(process.stdin.isTTY ? { prompt: 'scml> ' } : {})
  })
  readline.on('line', line => {
    const command = line.trim()
    if (command === ':help') {
      writeMessage(usage())
      return
    }
    if (command === ':quit' || command === ':exit') {
      stop()
      return
    }
    if (command === ':cr') {
      sendCarriageReturn = !sendCarriageReturn
      writeMessage(`carriage return on enter: ${sendCarriageReturn ? 'on' : 'off'}`)
      return
    }
    try {
      const program = compileScml(line)
      if (sendCarriageReturn) {
        program.instructions.push({ data: Buffer.from([0x0D]), type: 'bytes' })
      }
      const outputWasWritten = program.instructions.length > 0
        ? enqueue({ label: 'console input', program })
        : false
      if (!outputWasWritten) readline.prompt()
    } catch (error) {
      writeMessage(formatError(error), true)
    }
  })
  readline.on('close', stop)
  readline.prompt()
}

await main()
