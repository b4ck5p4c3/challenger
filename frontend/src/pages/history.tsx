import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/button'
import {
  attachProductCode,
  createItem,
  getHistory,
  getItems,
  HISTORY_QUERY_KEY,
  ITEMS_QUERY_KEY,
  STATS_QUERY_KEY,
  request,
  updateCrptData,
  updateScanUnit,
  type Item,
  type ProductCode,
  type ProductInput
} from '../utils/api'
import styles from './history.module.css'

type ProductDraft = {
  brand: string
  name: string
  volume: string
  caffeine: string
  alcohol: string
}

function emptyDraft (): ProductDraft {
  return { alcohol: '0', brand: '', caffeine: '0', name: '', volume: '0' }
}

function productInputFromDraft (draft: ProductDraft): ProductInput | null {
  const input: ProductInput = {
    alcohol: Number.parseFloat(draft.alcohol),
    brand: draft.brand.trim(),
    caffeine: Number.parseFloat(draft.caffeine),
    name: draft.name.trim(),
    volume: Number.parseFloat(draft.volume)
  }
  const valuesAreValid = [input.volume, input.caffeine, input.alcohol].every(value => Number.isFinite(value) && value >= 0)
  return input.brand && input.name && valuesAreValid ? input : null
}

export function HistoryPage() {
  const [page, setPage] = useState(1)
  const [createCodeId, setCreateCodeId] = useState<string | null>(null)
  const [attachCodeId, setAttachCodeId] = useState<string | null>(null)
  const [attachProductId, setAttachProductId] = useState('')
  const [attachCanCreate, setAttachCanCreate] = useState(false)
  const [redactScanUnit, setRedactScanUnit] = useState<{
    id: string
    productCode: { id: string; gtin: string }
    chestnyZnakCode: string | null
  } | null>(null)
  const [redactProductCodeId, setRedactProductCodeId] = useState('')
  const [redactChestnyZnakCode, setRedactChestnyZnakCode] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const history = useQuery({
    queryFn: () => getHistory(page),
    queryKey: [HISTORY_QUERY_KEY, page]
  })
  const products = useQuery({
    queryFn: getItems,
    queryKey: [ITEMS_QUERY_KEY]
  })
  const productCodes = useQuery({
    queryFn: () => request<ProductCode[]>('/product-codes'),
    queryKey: ['product-codes']
  })

  function closeEditor () {
    setCreateCodeId(null)
    setAttachCodeId(null)
    setAttachCanCreate(false)
    setRedactScanUnit(null)
    setRedactProductCodeId('')
    setRedactChestnyZnakCode('')
    setProductSearch('')
  }

  function startCreate (codeId: string) {
    closeEditor()
    setCreateCodeId(codeId)
    setDraft(emptyDraft())
  }

  function startAttach (item: {
    id: string
    productCode: { id: string; gtin: string; productId: string | null; product?: Item | null }
    chestnyZnakCode: string | null
  }) {
    closeEditor()
    setAttachCodeId(item.productCode.id)
    setAttachCanCreate(item.productCode.productId === null)
    setRedactScanUnit(item)
    setRedactProductCodeId(item.productCode.id)
    setRedactChestnyZnakCode(item.chestnyZnakCode ?? '')
    setProductSearch('')
    setAttachProductId(item.productCode.productId ?? products.data?.[0]?.id ?? '')
  }

  function startRedact () {
    if (!redactScanUnit) return
    const scanUnit = redactScanUnit
    closeEditor()
    setRedactScanUnit(scanUnit)
    setRedactProductCodeId(scanUnit.productCode.id)
    setRedactChestnyZnakCode(scanUnit.chestnyZnakCode ?? '')
  }

  async function submitCreate (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!createCodeId) return
    const input = productInputFromDraft(draft)
    if (!input) return

    setBusy(true)
    try {
      await createItem(input, createCodeId)
      await Promise.all([
        history.refetch(),
        queryClient.invalidateQueries({ queryKey: [ITEMS_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [STATS_QUERY_KEY] })
      ])
      closeEditor()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitAttach (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!attachCodeId || !attachProductId) return
    setBusy(true)
    try {
      await attachProductCode(attachCodeId, attachProductId)
      await Promise.all([
        history.refetch(),
        queryClient.invalidateQueries({ queryKey: [ITEMS_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [STATS_QUERY_KEY] })
      ])
      closeEditor()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitRedact (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!redactScanUnit || !redactProductCodeId) return

    setBusy(true)
    try {
      await updateScanUnit(redactScanUnit.id, {
        chestnyZnakCode: redactChestnyZnakCode.trim() || null,
        productCodeId: redactProductCodeId
      })
      await Promise.all([
        history.refetch(),
        queryClient.invalidateQueries({ queryKey: [STATS_QUERY_KEY] })
      ])
      closeEditor()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitCrptData () {
    if (!redactScanUnit?.id || !redactScanUnit.chestnyZnakCode) return
    setBusy(true)
    try {
      await updateCrptData(redactScanUnit.id)
      await history.refetch()
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  const normalizedSearch = productSearch.trim().toLocaleLowerCase()
  const matchingProducts = products.data?.filter(product => {
    if (!normalizedSearch) return true
    return `${product.name} ${product.brand}`.toLocaleLowerCase().includes(normalizedSearch)
  }) ?? []
  const selectedProduct = products.data?.find(product => product.id === attachProductId)
  const visibleProducts = selectedProduct && !matchingProducts.some(product => product.id === selectedProduct.id)
    ? [selectedProduct, ...matchingProducts]
    : matchingProducts

  return <>
    <div className={styles.heading}>
      <h3>History</h3>
      <span>{history.data?.total ?? 0} scans</span>
    </div>

    {createCodeId && <form className={styles.editor} onSubmit={event => void submitCreate(event)}>
      <strong>Create product for GTIN</strong>
      <div className={styles.formGrid}>
        <label>Brand<input required value={draft.brand} onChange={event => setDraft(current => ({ ...current, brand: event.target.value }))} /></label>
        <label>Name<input required value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>Volume, ml<input required min="0" step="any" type="number" value={draft.volume} onChange={event => setDraft(current => ({ ...current, volume: event.target.value }))} /></label>
        <label>Caffeine, mg<input required min="0" step="any" type="number" value={draft.caffeine} onChange={event => setDraft(current => ({ ...current, caffeine: event.target.value }))} /></label>
        <label>Alcohol, ml<input required min="0" step="any" type="number" value={draft.alcohol} onChange={event => setDraft(current => ({ ...current, alcohol: event.target.value }))} /></label>
      </div>
      <div className={styles.editorActions}>
        <Button type="submit" disabled={busy}>Create and attach</Button>
        <Button type="button" onClick={closeEditor} disabled={busy}>Cancel</Button>
      </div>
    </form>}

    {attachCodeId && <form className={styles.editor} onSubmit={event => void submitAttach(event)}>
      <div className={styles.editorHeader}>
        <strong>Attach GTIN to an existing product</strong>
        <div className={styles.editorActions}>
          <Button type="button" onClick={() => startCreate(attachCodeId)} disabled={busy || !attachCanCreate}>Create</Button>
          <Button type="button" onClick={() => {
            startRedact()
          }} disabled={busy || !redactScanUnit}>Redact</Button>
        </div>
      </div>
      <label className={styles.selectLabel}>Search by name
        <input type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Type a product name" disabled={busy} />
      </label>
      <label className={styles.selectLabel}>Product
        <select value={attachProductId} onChange={event => setAttachProductId(event.target.value)} disabled={busy || !products.data?.length}>
          {visibleProducts.map(product => <option key={product.id} value={product.id}>{product.brand} - {product.name}</option>)}
        </select>
      </label>
      <div className={styles.editorActions}>
        <Button type="submit" disabled={busy || !attachProductId}>Attach</Button>
        <Button type="button" onClick={closeEditor} disabled={busy}>Cancel</Button>
      </div>
    </form>}

    {!createCodeId && !attachCodeId && redactScanUnit && <form className={styles.editor} onSubmit={event => void submitRedact(event)}>
      <div className={styles.editorHeader}>
        <strong>Redact scan</strong>
        <Button type="button" onClick={() => void submitCrptData()} disabled={busy || !redactScanUnit.chestnyZnakCode}>Updated CRPT data</Button>
      </div>
      <label className={styles.selectLabel}>Product code
        <select value={redactProductCodeId} onChange={event => setRedactProductCodeId(event.target.value)} disabled={busy}>
          {!productCodes.data?.some(productCode => productCode.id === redactProductCodeId) && <option value={redactProductCodeId}>{redactScanUnit.productCode.gtin}</option>}
          {productCodes.data?.map(productCode => <option key={productCode.id} value={productCode.id}>{productCode.gtin}</option>)}
        </select>
      </label>
      <label className={styles.selectLabel}>Chestny Znak code
        <input value={redactChestnyZnakCode} onChange={event => setRedactChestnyZnakCode(event.target.value)} disabled={busy} />
      </label>
      <div className={styles.editorActions}>
        <Button type="submit" disabled={busy}>Save</Button>
        <Button type="button" onClick={closeEditor} disabled={busy}>Cancel</Button>
      </div>
    </form>}

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Time</th>
            <th>GTIN</th>
            <th>Product</th>
            <th>CRPT label</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {history.data?.scanUnits?.map(item => <tr key={item.id}>
            <td>{new Date(item.createdAt).toLocaleString()}</td>
            <td><Link to={`/records/product-codes/${item.productCode.id}`}>{item.productCode.gtin}</Link></td>
            <td>{item.productCode.product ? `${item.productCode.product.brand} - ${item.productCode.product.name}` : <span className={styles.unassigned}>Unassigned</span>}</td>
            <td><Link to={`/records/scan-units/${item.id}`}>{item.chestnyZnakCode ?? 'No Chestny Znak'}</Link></td>
            <td className={styles.actions}>
              <Button onClick={() => startAttach(item)} disabled={busy}>Edit</Button>
              <Button onClick={async () => {
                if (!confirm('Delete this scan?')) return
                try {
                  await request(`/scan-units/${item.id}`, { method: 'DELETE' })
                  await history.refetch()
                  await queryClient.invalidateQueries({ queryKey: [STATS_QUERY_KEY] })
                } catch (error) { alert(String(error)) }
              }}>Delete</Button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className={styles.paginator}>
      <Button className={styles.pageButton} disabled={page === 1} onClick={() => setPage(page - 1)}>&lt;</Button>
      <div>{page}/{history.data ? Math.max(1, Math.ceil(history.data.total / 50)) : '?'}</div>
      <Button className={styles.pageButton} disabled={!history.data || page >= Math.max(1, Math.ceil(history.data.total / 50))} onClick={() => setPage(page + 1)}>&gt;</Button>
    </div>
  </>
}
