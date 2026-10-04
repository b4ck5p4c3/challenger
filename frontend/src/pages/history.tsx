import { useState } from 'react'
import { Button } from '../components/button'
import { getHistory, HISTORY_QUERY_KEY } from '../utils/api'
import styles from './history.module.css'
import {useQuery} from '@tanstack/react-query'

export function HistoryPage() {
  const [page, setPage] = useState(1)

  const history = useQuery({
    queryFn: () => getHistory(page),
    queryKey: [HISTORY_QUERY_KEY, page]
  })

  return <>
    <h3>History</h3>
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Time</th>
          <th>EAN13</th>
          <th>Item</th>
          <th>CRPT Label</th>
        </tr>
      </thead>
      <tbody>
        {history.data?.scannedItems?.map(item => <tr key={item.id}>
          <td>{new Date(item.createdAt).toLocaleString()}</td>
          <td>{item.item.ean13}</td>
          <td>{item.item.brand} - {item.item.name}</td>
          <td>{item.crptLabelId ?? '-'}</td>
        </tr>)}
      </tbody>
    </table>
    <div className={styles.paginator}>
      <Button className={styles.pageButton} disabled={page === 1} onClick={() => setPage(page - 1)}>&lt;</Button>
      <div>{page}/{history.data ? Math.floor((history.data.total + 49) / 50) : '?'}</div>
      <Button className={styles.pageButton} disabled={!history.data || page == Math.floor((history.data.total + 49) / 50)} 
        onClick={() => setPage(page + 1)}>&gt;</Button>
    </div>
  </>
}