import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { escapeSpecialCharacters, submitScan, type ScanResult } from '../utils/api'
import styles from './scanner.module.css'

function resultText(result: ScanResult): string {
  switch (result.type) {
    case 'ean_registered': return 'Добавлена без ЧестногоЗнака! ☆⌒(>。<) Пожалуйста, сканируйте ЧестныйЗнак'
    case 'chestny_znak_paired': return 'ЧестныйЗнак добавлен к ранее отсканированной банке (❤ω❤)'
    case 'chestny_znak_registered_without_ean': return 'Банка добавлена ( ◕▿◕ )'
    case 'duplicate_chestny_znak': return 'Эта банка уже была добавлена o(TヘTo)'
    case 'unsupported':
    case 'error': return result.msg
  }
}

export function ScannerPage() {
  const video = useRef<HTMLVideoElement>(null)
  const controls = useRef<IScannerControls | null>(null)
  const generation = useRef(0)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(' ')
  const [rawCode, setRawCode] = useState('')
  const queryClient = useQueryClient()

  function stop() {
    generation.current++
    controls.current?.stop()
    controls.current = null
    setActive(false)
  }

  useEffect(() => () => {
    generation.current++
    controls.current?.stop()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}splashes.txt`, { signal: controller.signal })
      .then(response => response.ok ? response.text() : Promise.reject(new Error('Failed to load splashes')))
      .then(content => {
        const splashes = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        if (splashes.length > 0 && !controller.signal.aborted) {
          setMsg(splashes[Math.floor(Math.random() * splashes.length)] ?? 'oopsie~')
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  async function send(code: string, codeType: 'ean13' | 'chestny_znak') {
    const escapedCode = escapeSpecialCharacters(code)
    setBusy(true)
    setRawCode(escapedCode)
    setMsg('ヘ(◕。◕ヘ)')
    try {
      setMsg(resultText(await submitScan(escapedCode, codeType)))
      await queryClient.invalidateQueries()
    } catch (error) {
      setMsg(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (!video.current || busy || active) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setMsg('Camera unaccessible! HTTP://[::] allowed only on 127.0.0.1')
      return
    }
    const current = ++generation.current
    let captured = false
    setActive(true)
    setMsg('Point your camera on DataMatrix or EAN13')
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.DATA_MATRIX]],
      [DecodeHintType.TRY_HARDER, true]
    ])
    const reader = new BrowserMultiFormatReader(hints)
    try {
      const camera = await reader.decodeFromConstraints({
        audio: false,
        video: { facingMode: { ideal: 'environment' } }
      }, video.current, (result, _error, scanner) => {
        if (!result || captured || current !== generation.current) return
        captured = true
        scanner.stop()
        setActive(false)
        void send(result.getText(), result.getBarcodeFormat() === BarcodeFormat.EAN_13 ? 'ean13' : 'chestny_znak')
      })
      if (current !== generation.current || captured) camera.stop()
      else controls.current = camera
    } catch (error) {
      if (current !== generation.current) return
      setActive(false)
      setMsg(String(error))
    }
  }

  return <section className={styles.scanner}>
    <div className={styles.heading}>
      <h3>Scan</h3>
    </div>
    <div className={styles.scannerContent}>
      <div className={styles.camera}><video ref={video} playsInline muted /><div className={styles.frame}/></div>
      <p role="status" aria-live="polite">{msg}</p>
      <div className={styles.controls}>
        <button onClick={() => void start()} disabled={busy || active}>START</button>
        <button onClick={stop} disabled={!active}>STOP</button>
      </div>
      <form onSubmit={event => {
        event.preventDefault()
        stop()
        void send(rawCode, /^\d{13}$/.test(rawCode) ? 'ean13' : 'chestny_znak')
      }}>
        <label htmlFor="raw-code">{'Enter manually (try \\u001d for FNC1)'}</label>
        <input id="raw-code" value={rawCode} onChange={event => setRawCode(event.target.value)} autoComplete="off" />
        <button disabled={busy || !rawCode}>SEND</button>
      </form>
    </div>
  </section>
}
