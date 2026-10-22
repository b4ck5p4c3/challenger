import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../components/button'
import {
  createShuttleTemplate,
  deleteShuttleTemplate,
  enableOnlyShuttleTemplate,
  getShuttleTemplates,
  SHUTTLE_TEMPLATES_QUERY_KEY,
  SCAN_SITUATIONS,
  setAllShuttleTemplatesEnabled,
  type ScanSituation,
  type ShuttleTemplate,
  updateShuttleTemplate
} from '../utils/api'
import styles from './templates.module.css'

const situationLabels: Record<ScanSituation, string> = {
  chestny_znak_paired: 'Chestny Znak paired',
  chestny_znak_registered_without_ean: 'Chestny Znak without EAN',
  duplicate_chestny_znak: 'Duplicate Chestny Znak',
  ean_registered: 'EAN registered',
  error: 'Processing error',
  processing: 'Processing started',
  unsupported: 'Unsupported scan'
}

type TemplateDraft = {
  name: string
  situation: ScanSituation
  template: string
}

export function TemplatesPage() {
  const queryClient = useQueryClient()
  const templates = useQuery({
    queryFn: getShuttleTemplates,
    queryKey: [SHUTTLE_TEMPLATES_QUERY_KEY]
  })
  const [draft, setDraft] = useState<TemplateDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const templateList = templates.data ?? []
  const enabledCount = templateList.filter(template => template.enabled).length
  const templateGroups = SCAN_SITUATIONS
    .map(situation => {
      const templates = templateList.filter(template => template.situation === situation)
      return {
        situation,
        templates,
        enabledCount: templates.filter(template => template.enabled).length
      }
    })
    .filter(group => group.templates.length > 0)

  async function refresh () {
    await queryClient.invalidateQueries({ queryKey: [SHUTTLE_TEMPLATES_QUERY_KEY] })
  }

  async function submitCreate (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    setBusy(true)
    try {
      await createShuttleTemplate(draft)
      await refresh()
      setDraft(null)
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function enableAll () {
    setBusy(true)
    try {
      await setAllShuttleTemplatesEnabled(true)
      await refresh()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  return <section className={styles.page}>
    <div className={styles.heading}>
      <div>
        <h3>Shuttle templates</h3>
        <p>Choose a random enabled SCML template for each scan situation.</p>
      </div>
      <div className={styles.toolbar}>
        <Button onClick={() => setDraft({ name: '', situation: 'processing', template: '' })} disabled={busy || draft !== null}>New template</Button>
        <Button onClick={() => void enableAll()} disabled={busy || templateList.length === 0 || enabledCount === templateList.length}>Enable all</Button>
      </div>
    </div>

    {draft && <form className={styles.editor} onSubmit={event => void submitCreate(event)}>
      <div className={styles.editorHeader}>
        <strong>New template</strong>
        <Button type="button" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
      </div>
      <div className={styles.fieldGrid}>
        <label>
          Name
          <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} disabled={busy} required />
        </label>
        <label>
          Situation
          <SituationSelect value={draft.situation} onChange={situation => setDraft({ ...draft, situation })} disabled={busy} />
        </label>
      </div>
      <label>
        SCML template
        <LineNumberedTextarea value={draft.template} onChange={event => setDraft({ ...draft, template: event.target.value })} disabled={busy} required rows={7} />
      </label>
      <p className={styles.hint}>Variables: {'{{situation}}'}, {'{{scan.rawCode}}'}, {'{{result.type}}'}, {'{{result.msg}}'}, {'{{result.scanUnitId}}'}, {'{{stats.before.total.volume}}'}, {'{{stats.after.total.volume}}'}</p>
      <div className={styles.editorActions}>
        <Button type="submit" disabled={busy}>Create</Button>
      </div>
    </form>}

    {templates.isPending && <p>Loading templates...</p>}
    {templates.isError && <p role="alert">{String(templates.error)}</p>}
    {!templates.isPending && !templates.isError && templateList.length === 0 && <p>No templates have been created.</p>}
    <div className={styles.groups}>
      {templateGroups.map(group => <section className={styles.group} key={group.situation}>
        <h4>Situation: {situationLabels[group.situation]}</h4>
        <div className={styles.grid}>
          {group.templates.map(template => <TemplateCard
            key={template.id}
            template={template}
            enabledCount={group.enabledCount}
            onRefresh={refresh}
          />)}
        </div>
      </section>)}
    </div>
  </section>
}

function TemplateCard ({ template, enabledCount, onRefresh }: { template: ShuttleTemplate; enabledCount: number; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(template.name)
  const [situation, setSituation] = useState(template.situation)
  const [source, setSource] = useState(template.template)
  const [enabled, setEnabled] = useState(template.enabled)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(template.name)
    setSituation(template.situation)
    setSource(template.template)
    setEnabled(template.enabled)
  }, [template])

  async function save (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      await updateShuttleTemplate(template.id, { name, situation, template: source })
      await onRefresh()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggle () {
    setBusy(true)
    try {
      const updated = await updateShuttleTemplate(template.id, { enabled: !enabled })
      setEnabled(updated.enabled)
      await onRefresh()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function enableOnly () {
    setBusy(true)
    try {
      await enableOnlyShuttleTemplate(template.id)
      await onRefresh()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove () {
    if (!window.confirm(`Delete template "${name}"?`)) return
    setBusy(true)
    try {
      await deleteShuttleTemplate(template.id)
      await onRefresh()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  return <form className={`${styles.card} ${enabled ? styles.enabled : styles.disabled}`} onSubmit={event => void save(event)}>
    <div className={styles.cardHeader}>
      <div>
        <strong>{name}</strong>
        <code>{template.id}</code>
      </div>
      <span className={styles.status}>{enabled ? 'enabled' : 'disabled'}</span>
    </div>
    <label>
      Name
      <input value={name} onChange={event => setName(event.target.value)} disabled={busy} required />
    </label>
    <label>
      Situation
      <SituationSelect value={situation} onChange={setSituation} disabled={busy} />
    </label>
    <label>
      SCML template
      <LineNumberedTextarea value={source} onChange={event => setSource(event.target.value)} disabled={busy} required rows={10} />
    </label>
    <p className={styles.hint}>Use {'{{result.msg}}'} or {'{{stats.after.total.volume}}'} in the SCML text.</p>
    <div className={styles.cardActions}>
      <Button type="submit" disabled={busy}>Save</Button>
      <Button type="button" onClick={() => void enableOnly()} disabled={busy || (enabled && enabledCount <= 1)}>Only this</Button>
      <Button type="button" onClick={() => void toggle()} disabled={busy || (enabled && enabledCount <= 1)}>{enabled ? 'Disable' : 'Enable'}</Button>
      <Button type="button" onClick={() => void remove()} disabled={busy}>Delete</Button>
    </div>
  </form>
}

function SituationSelect ({ value, onChange, disabled }: { value: ScanSituation; onChange: (value: ScanSituation) => void; disabled?: boolean }) {
  return <select value={value} onChange={event => onChange(event.target.value as ScanSituation)} disabled={disabled}>
    {SCAN_SITUATIONS.map(situation => <option key={situation} value={situation}>{situationLabels[situation]}</option>)}
  </select>
}

function LineNumberedTextarea ({ value, onChange, disabled, required, rows }: {
  value: string
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
  disabled?: boolean
  required?: boolean
  rows: number
}) {
  const lineNumbers = useRef<HTMLDivElement>(null)
  const lines = value.split('\n')

  function handleScroll (event: React.UIEvent<HTMLTextAreaElement>) {
    if (lineNumbers.current) lineNumbers.current.scrollTop = event.currentTarget.scrollTop
  }

  return <div className={styles.codeEditor}>
    <div className={styles.lineNumbers} ref={lineNumbers} aria-hidden="true">
      {lines.map((_, index) => <span className={styles.lineNumber} key={index}>{index + 1}</span>)}
    </div>
    <textarea
      value={value}
      onChange={onChange}
      onScroll={handleScroll}
      disabled={disabled}
      required={required}
      rows={rows}
      wrap="off"
    />
  </div>
}
