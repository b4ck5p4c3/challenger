import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
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
  const stats = useQuery({
    queryFn: getStats,
    queryKey: [STATS_QUERY_KEY],
    staleTime: 30_000
  })

  return <header className={styles.header}>
    <div className={styles.headerRow}>
      <div className={styles.stats} aria-label="Scan statistics">
        {stats.data ? <>
          <Stat label="24h" data={stats.data.day} />
          <Stat label="30d" data={stats.data.month} />
          <Stat label="All" data={stats.data.total} />
        </> : <span className={styles.stat}>{stats.isError ? 'Stats unavailable' : 'Loading stats...'}</span>}
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

function Stat ({ label, data }: { label: string; data: StatsPeriod }) {
  return <span className={styles.stat} title={`${label}: volume ${data.volume} ml, caffeine ${data.caffeine} mg, alcohol ${data.alcohol} ml`}>
    <b>{label}</b>
    <span>V {formatVolume(data.volume)}</span>
    <span>C {formatMass(data.caffeine)}</span>
    <span>A {formatVolume(data.alcohol)}</span>
  </span>
}

function formatVolume (value: number) {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}L` : `${Math.round(value)}ml`
}

function formatMass (value: number) {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}g` : `${Math.round(value)}mg`
}
