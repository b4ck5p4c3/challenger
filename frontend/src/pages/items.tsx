import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/button'
import {
  deleteItem,
  getItems,
  HISTORY_QUERY_KEY,
  ITEMS_QUERY_KEY,
  STATS_QUERY_KEY,
  type ProductDeleteMode
} from '../utils/api'
import styles from './items.module.css'

export function ItemsPage() {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState<ProductDeleteMode>('product')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const items = useQuery({
    queryFn: getItems,
    queryKey: [ITEMS_QUERY_KEY]
  })
  const deletingItem = items.data?.find(item => item.id === deleteId)

  function startDelete (id: string) {
    setDeleteId(id)
    setDeleteMode('product')
  }

  async function submitDelete (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deleteId) return
    setBusy(true)
    try {
      await deleteItem(deleteId, deleteMode)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [ITEMS_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: [STATS_QUERY_KEY] })
      ])
      setDeleteId(null)
    } catch (error) {
      alert(String(error))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className={styles.heading}>
      <h3>Items</h3>
      <span>{items.data?.length ?? 0} products</span>
    </div>

    {deleteId && <form className={styles.editor} onSubmit={event => void submitDelete(event)}>
      <div className={styles.editorHeader}>
        <strong>Delete {deletingItem ? `${deletingItem.brand} - ${deletingItem.name}` : 'product'}</strong>
      </div>
      <fieldset className={styles.choiceGroup}>
        <legend>What should be deleted?</legend>
        <label className={styles.choice}>
          <input type="radio" name="delete-mode" value="product" checked={deleteMode === 'product'} onChange={() => setDeleteMode('product')} disabled={busy} />
          <span>Product only - keep ProductCodes and scans</span>
        </label>
        <label className={styles.choice}>
          <input type="radio" name="delete-mode" value="product_with_history" checked={deleteMode === 'product_with_history'} onChange={() => setDeleteMode('product_with_history')} disabled={busy} />
          <span>Product, all ProductCodes and all scans</span>
        </label>
      </fieldset>
      <div className={styles.editorActions}>
        <Button type="submit" disabled={busy}>Delete</Button>
        <Button type="button" onClick={() => setDeleteId(null)} disabled={busy}>Cancel</Button>
      </div>
    </form>}

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Brand</th>
            <th>Name</th>
            <th>Volume</th>
            <th>Caffeine</th>
            <th>Alcohol</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.data?.map(item => <tr key={item.id}>
            <td>{item.brand}</td>
            <td>{item.name}</td>
            <td>{item.volume.toFixed(2)} ml</td>
            <td>{item.caffeine.toFixed(2)} mg</td>
            <td>{item.alcohol.toFixed(2)} ml</td>
            <td className={styles.actions}>
              <Button onClick={() => navigate(`/items/${item.id}`)}>Edit</Button>
              <Button onClick={() => startDelete(item.id)} disabled={busy}>Delete</Button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </>
}
