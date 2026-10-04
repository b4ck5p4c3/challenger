import { Button } from '../components/button'
import { getItems, ITEMS_QUERY_KEY } from '../utils/api'
import styles from './items.module.css'
import {useQuery} from '@tanstack/react-query'
import {useNavigate} from 'react-router'

export function ItemsPage() {
  const items = useQuery({
    queryFn: () => getItems(),
    queryKey: [ITEMS_QUERY_KEY]
  })

  const navigate = useNavigate()

  return <>
    <h3>Items</h3>
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.tableSmallColumn}></th>
          <th>EAN13</th>
          <th>Brand</th>
          <th>Name</th>
          <th>Volume</th>
          <th>Caffeine</th>
          <th>Alcohol</th>
          <th>Filled</th>
        </tr>
      </thead>
      <tbody>
        {items.data?.map(item => <tr key={item.id}>
          <td><Button className={styles.buttonEdit} onClick={() => navigate(`/items/${item.id}`)}>✏️</Button></td>
          <td>{item.ean13}</td>
          <td>{item.brand}</td>
          <td>{item.name}</td>
          <td>{item.volume.toFixed(2)} ml</td>
          <td>{item.caffeine.toFixed(2)} mg</td>
          <td>{item.alcohol.toFixed(2)} ml</td>
          <td>{item.filled ? '✅' : '❌'}</td>
        </tr>)}
      </tbody>
    </table>
  </>
}