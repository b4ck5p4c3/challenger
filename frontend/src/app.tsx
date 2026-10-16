import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import { useState } from 'react'
import styles from './app.module.css'
import { ItemsPage } from './pages/items'
import { HistoryPage } from './pages/history'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { ItemEditPage } from './pages/item-edit'
import { ScannerPage } from './pages/scanner'
import { RecordPage } from './pages/record'
import { CodesPage } from './pages/codes'
import { getStats, STATS_QUERY_KEY, type StatsPeriod } from './utils/api'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Header/>
        <main className={styles.main}>
          <Routes>
            <Route path="/scan" element={<ScannerPage />} />
            <Route path="/codes" element={<CodesPage />} />
            <Route path="/records/:collection/:id" element={<RecordPage />} />
            <Route path={"/"} element={<Navigate to={"/history"} replace={true} />}/>
            <Route path={"/items"} element={<ItemsPage />}/>
            <Route path={"/products"} element={<ItemsPage />}/>
            <Route path={"/items/:id"} element={<ItemEditPage />}/>
            <Route path={"/history"} element={<HistoryPage />}/>

            <Route path={"*"} element={<Navigate to={"/"} replace={true} />}/>
          </Routes>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function Header() {
  const [statsPeriodIndex, setStatsPeriodIndex] = useState(0)
  const stats = useQuery({
    queryFn: getStats,
    queryKey: [STATS_QUERY_KEY],
    staleTime: 30_000
  })
  const periods = stats.data ? [
    { data: stats.data.day, label: '24h' },
    { data: stats.data.month, label: '30d' },
    { data: stats.data.total, label: 'All' }
  ] : []
  const currentPeriod = periods[statsPeriodIndex] ?? periods[0]

  return <header className={styles.header}>
    <div className={styles.headerRow}>
      <div className={styles.stats} aria-label="Scan statistics">
        {currentPeriod ? <Stat
          label={currentPeriod.label}
          data={currentPeriod.data}
          onClick={() => setStatsPeriodIndex(index => (index + 1) % 3)}
        /> : <span className={styles.stat}>{stats.isError ? 'Stats unavailable' : 'Loading stats...'}</span>}
      </div>
      <div className={styles.headerMenu}>
        <Link to="/scan">Scan</Link>
        <Link to="/codes">GTIN</Link>
        <Link to={"/items"}>Items</Link>
        <Link to={"/history"}>History</Link>
      </div>
    </div>
    <hr/>
  </header>
}

function Stat ({ label, data, onClick }: { label: string; data: StatsPeriod; onClick: () => void }) {
  function handleKeyDown (event: React.KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onClick()
  }

  return <span
    className={styles.stat}
    onClick={onClick}
    onKeyDown={handleKeyDown}
    role="button"
    tabIndex={0}
    title={`${label}: volume ${data.volume} ml, caffeine ${data.caffeine} mg, alcohol ${data.alcohol} ml`}
  >
    {label} / V {formatVolume(data.volume)} / C {formatMass(data.caffeine)} / A {formatVolume(data.alcohol)}
  </span>
}

function formatVolume (value: number) {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}L` : `${Math.round(value)}ml`
}

function formatMass (value: number) {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}g` : `${Math.round(value)}mg`
}
