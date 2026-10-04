import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import styles from './app.module.css'
import { ItemsPage } from './pages/items'
import { HistoryPage } from './pages/history'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ItemEditPage } from './pages/item-edit'

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Header/>
        <main className={styles.main}>
          <Routes>
            <Route path={"/"} element={<Navigate to={"/items"} replace={true} />}/>
            <Route path={"/items"} element={<ItemsPage />}/>
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
  return <header className={styles.header}>
    <div className={styles.headerRow}>
      <h1>Challenger</h1>
      <div className={styles.headerMenu}>
        <Link to={"/items"}>Items</Link>
        <Link to={"/history"}>History</Link>
      </div>
    </div>
    <hr/>
  </header>
}