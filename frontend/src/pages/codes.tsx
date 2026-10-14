import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { request, type ProductCode } from '../utils/api'
import styles from './codes.module.css'

export function CodesPage() {
  const codes = useQuery({
    queryKey: ['product-codes'],
    queryFn: () => request<ProductCode[]>('/product-codes')
  })
  return <>
    <div className={styles.heading}>
      <h3>GTIN</h3>
    </div>
    <table>
      <thead><tr><th>GTIN</th><th>Product</th><th>Open</th></tr></thead>
      <tbody>{codes.data?.map(code => <tr key={code.id}>
        <td>{code.gtin}</td>
        <td>{code.productId ?? '-'}</td>
        <td><Link to={`/records/product-codes/${code.id}`}>Open</Link></td>
      </tr>)}</tbody>
    </table>
  </>
}
