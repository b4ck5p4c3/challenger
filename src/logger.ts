import { Logger } from 'tslog'

export function getLogger<T> (): Logger<T> {
  const flags = ['-vvv', '-vv', '-v']
  const index = flags.findIndex(flag => process.argv.includes(flag))
  const minLevel = index === -1 ? 3 : index

  return new Logger<T>({
    minLevel,
    type: 'pretty'
  })
}
