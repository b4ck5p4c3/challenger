import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { request } from '../utils/api'

export function RecordPage() {
  const { collection, id } = useParams()
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const endpoint = collection === 'product-codes' ? `/product-codes/${id}` : `/scan-units/${id}`
    request(endpoint).then(setData).catch(value => setError(String(value)))
  }, [collection, id])

  return <section>
    <Link to="/history">Назад</Link>
    <h3>{collection} / {id}</h3>
    {error ? <pre>{error}</pre> : <pre>{data ? JSON.stringify(data, null, 2) : 'Загрузка…'}</pre>}
  </section>
}
