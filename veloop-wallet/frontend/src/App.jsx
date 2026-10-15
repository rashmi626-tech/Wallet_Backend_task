import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'
const WALLET_POLICY = {
  maxBalanceCents: 500_000,
  maxWithdrawalCents: 250_000,
  fixedPayoutAmountCents: 50_000,
}

const apiRequest = async (path, options = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body) headers.set('Content-Type', 'application/json')
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)

  const response = await fetch(`${API_URL}${path}`, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

const formatMoney = (cents = 0, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
}).format(cents / 100)

const formatDate = (date) => new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(date))

const toCents = (amount) => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000_000 ? cents : null
}

const requestKeyFor = (ref, payload) => {
  const fingerprint = JSON.stringify(payload)
  if (ref.current?.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: crypto.randomUUID() }
  }
  return ref.current.key
}

function App() {
  const [status, setStatus] = useState('checking')
  const [databaseConnected, setDatabaseConnected] = useState(false)
  const [transactionsSupported, setTransactionsSupported] = useState(false)
  const [authenticationConfigured, setAuthenticationConfigured] = useState(false)
  const [token, setToken] = useState(() => sessionStorage.getItem('wallet-token') || '')
  const [user, setUser] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [payoutOptions, setPayoutOptions] = useState([])
  const [route, setRoute] = useState(() => {
    if (typeof window === 'undefined') return 'wallet'
    return window.location.pathname.startsWith('/payout') ? 'payout' : 'wallet'
  })
  const [activeView, setActiveView] = useState('dashboard')
  const [authMode, setAuthMode] = useState('login')
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [authForm, setAuthForm] = useState({
    name: 'Veloop Admin',
    email: import.meta.env.VITE_DEFAULT_EMAIL || 'admin@veloopwallet.com',
    password: import.meta.env.VITE_DEFAULT_PASSWORD || 'Veloop@123',
  })
  const [collectionForm, setCollectionForm] = useState({ amount: '', note: '' })
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: (WALLET_POLICY.fixedPayoutAmountCents / 100).toFixed(2),
    method: 'bank_transfer',
    destination: '',
  })
  const collectionRequestKey = useRef(null)
  const withdrawalRequestKey = useRef(null)

  useEffect(() => {
    let cancelled = false
    const checkBackend = async () => {
      try {
        const data = await apiRequest('/health')
        if (cancelled) return
        setDatabaseConnected(Boolean(data.database?.connected))
        setTransactionsSupported(Boolean(data.database?.transactionsSupported))
        setAuthenticationConfigured(Boolean(data.authenticationConfigured))
        setStatus(data.database?.connected ? 'online' : 'degraded')
      } catch {
        if (!cancelled) setStatus('offline')
      }
    }

    checkBackend()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const syncRoute = () => {
      const path = typeof window === 'undefined' ? '/wallet' : window.location.pathname
      setRoute(path.startsWith('/payout') ? 'payout' : 'wallet')
    }

    syncRoute()
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  const navigateTo = (nextPath) => {
    const safePath = nextPath.startsWith('/') ? nextPath : `/${nextPath}`
    if (typeof window !== 'undefined' && window.location.pathname !== safePath) {
      window.history.pushState({}, '', safePath)
    }
    setRoute(safePath.startsWith('/payout') ? 'payout' : 'wallet')
  }

  useEffect(() => {
    if (!token || !databaseConnected) return undefined
    let cancelled = false

    const loadDashboard = async () => {
      try {
        const [account, summary, options, ledger] = await Promise.all([
          apiRequest('/auth/me', { token }),
          apiRequest('/wallet', { token }),
          apiRequest('/wallet/payout-options', { token }),
          apiRequest('/wallet/ledger?limit=10', { token }),
        ])
        if (cancelled) return
        setUser(account.user)
        setWallet(summary.wallet)
        setTransactions(summary.transactions)
        setPayoutOptions(options.options)
        setLedgerEntries(ledger.entries)
      } catch (error) {
        if (cancelled) return
        setNotice({ kind: 'error', text: error.message })
        if (error.status === 401) {
          sessionStorage.removeItem('wallet-token')
          setToken('')
        }
      }
    }

    loadDashboard()
    return () => { cancelled = true }
  }, [token, databaseConnected])

  const refreshWallet = async (activeToken = token) => {
    const [summary, ledger] = await Promise.all([
      apiRequest('/wallet', { token: activeToken }),
      apiRequest('/wallet/ledger?limit=10', { token: activeToken }),
    ])
    setWallet(summary.wallet)
    setTransactions(summary.transactions)
    setLedgerEntries(ledger.entries)
  }

  const submitAuth = async (event) => {
    event.preventDefault()
    setLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest(`/auth/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(authForm),
      })
      sessionStorage.setItem('wallet-token', result.token)
      setToken(result.token)
      setUser(result.user)
      setWallet(result.wallet)
      navigateTo('/wallet')
      setNotice({ kind: 'success', text: `Welcome${result.user.name ? `, ${result.user.name}` : ''}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const submitCollection = async (event) => {
    event.preventDefault()
    const payload = { amountCents: toCents(collectionForm.amount), note: collectionForm.note.trim() }
    if (!payload.amountCents) {
      setNotice({ kind: 'error', text: `Enter a valid collection amount up to $${(WALLET_POLICY.maxBalanceCents / 100).toFixed(2)}.` })
      return
    }
    if ((wallet?.balanceCents || 0) + payload.amountCents > WALLET_POLICY.maxBalanceCents) {
      setNotice({ kind: 'error', text: `This collection would exceed the wallet cap of $${(WALLET_POLICY.maxBalanceCents / 100).toFixed(2)}.` })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest('/wallet/collections', {
        token,
        method: 'POST',
        headers: { 'Idempotency-Key': requestKeyFor(collectionRequestKey, payload) },
        body: JSON.stringify(payload),
      })
      setNotice({ kind: 'success', text: `${result.message} Reference: ${result.transaction.reference}` })
      collectionRequestKey.current = null
      setCollectionForm({ amount: '', note: '' })
      await refreshWallet()
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const submitWithdrawal = async (event) => {
    event.preventDefault()
    const payload = { amountCents: toCents(withdrawalForm.amount), method: withdrawalForm.method }
    if (!payload.amountCents) {
      setNotice({ kind: 'error', text: 'Enter a valid withdrawal amount.' })
      return
    }
    if (payload.amountCents > WALLET_POLICY.maxWithdrawalCents) {
      setNotice({ kind: 'error', text: `Single withdrawals are capped at $${(WALLET_POLICY.maxWithdrawalCents / 100).toFixed(2)}.` })
      return
    }
    if (payload.amountCents > (wallet?.balanceCents || 0)) {
      setNotice({ kind: 'error', text: 'Withdrawal amount cannot exceed the available balance.' })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest('/wallet/withdrawals', {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': requestKeyFor(withdrawalRequestKey, payload) },
        body: JSON.stringify(payload),
      })
      setNotice({ kind: 'success', text: `${result.message} Reference: ${result.transaction.reference}` })
      withdrawalRequestKey.current = null
      setWithdrawalForm({ ...withdrawalForm, amount: '' })
      await refreshWallet()
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const signOut = () => {
    sessionStorage.removeItem('wallet-token')
    setToken('')
    setUser(null)
    setWallet(null)
    setTransactions([])
    setLedgerEntries([])
    setNotice(null)
  }

  if (!token) {
    return (
      <AuthScreen
        status={status}
        databaseConnected={databaseConnected}
        authenticationConfigured={authenticationConfigured}
        mode={authMode}
        form={authForm}
        setForm={setAuthForm}
        setMode={setAuthMode}
        onSubmit={submitAuth}
        notice={notice}
        loading={loading}
      />
    )
  }

  if (!user || !wallet) {
    return (
      <main className="loading-screen">
        <Brand />
        <p>{databaseConnected ? 'Loading your wallet…' : 'Waiting for the wallet database…'}</p>
        {status === 'offline' && <p className="inline-error">The API is offline. Start the backend and refresh.</p>}
      </main>
    )
  }

  const pageTitle = { wallet: 'Overview', payout: 'Payout', collect: 'Collect money', withdraw: 'Withdraw' }[route === 'payout' ? 'payout' : activeView === 'collect' ? 'collect' : activeView === 'withdraw' ? 'withdraw' : 'wallet']

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <p className="nav-caption">Workspace</p>
        <nav className="main-nav" aria-label="Wallet sections">
          <NavButton label="Wallet" value="wallet" active={route} onClick={() => { setActiveView('dashboard'); navigateTo('/wallet') }} />
          <NavButton label="Payout" value="payout" active={route} onClick={() => { setActiveView('withdraw'); navigateTo('/payout') }} />
          <NavButton label="Collect" value="collect" active={activeView} onClick={() => { setActiveView('collect'); navigateTo('/wallet') }} />
        </nav>
        <div className="sidebar-bottom">
          <span className={`connection-indicator ${status}`} />
          <span>{status === 'online' ? 'Database connected' : status === 'offline' ? 'API offline' : 'Database unavailable'}</span>
          <button className="sign-out" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">VELoop Wallet / {pageTitle}</p>
            <h1>{route === 'payout' ? 'Payout' : activeView === 'dashboard' ? `Good day, ${user.name.split(' ')[0]}` : pageTitle}</h1>
          </div>
          <div className="header-account">
            <span className={`connection-indicator ${status}`} />
            <span>{user.email}</span>
          </div>
        </header>

        {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}

        {route === 'payout' ? (
          <WithdrawalView
            form={withdrawalForm}
            setForm={setWithdrawalForm}
            onSubmit={submitWithdrawal}
            loading={loading}
            options={payoutOptions}
            wallet={wallet}
            transactionsSupported={transactionsSupported}
          />
        ) : activeView === 'collect' ? (
          <CollectionView
            form={collectionForm}
            setForm={setCollectionForm}
            onSubmit={submitCollection}
            loading={loading}
            transactions={transactions}
            currency={wallet.currency}
          />
        ) : (
          <Dashboard
            wallet={wallet}
            transactions={transactions}
            ledgerEntries={ledgerEntries}
            onNavigate={(next) => {
              if (next === 'payout') {
                setActiveView('withdraw')
                navigateTo('/payout')
                return
              }
              setActiveView(next)
              navigateTo('/wallet')
            }}
          />
        )}
      </main>
    </div>
  )
}

function Brand() {
  return (
    <div className="brand-lockup">
      <span className="brand-mark">V</span>
      <span>veloop<span className="brand-light">wallet</span></span>
    </div>
  )
}

function NavButton({ label, value, active, onClick }) {
  return (
    <button className={`nav-button ${active === value ? 'active' : ''}`} onClick={() => onClick(value)} aria-current={active === value ? 'page' : undefined}>
      <span>{label}</span>
      <span className="nav-arrow" aria-hidden="true">↗</span>
    </button>
  )
}

function Notice({ notice, onDismiss }) {
  return (
    <div className={`notice ${notice.kind}`} role="status">
      <p>{notice.text}</p>
      <button onClick={onDismiss} aria-label="Dismiss message">Dismiss</button>
    </div>
  )
}

function AuthScreen({ status, databaseConnected, authenticationConfigured, mode, form, setForm, setMode, onSubmit, notice, loading }) {
  return (
    <main className="auth-screen">
      <header className="auth-header"><Brand /><span className={`service-state ${status}`}>{status === 'offline' ? 'API offline' : !databaseConnected ? 'Database setup required' : !authenticationConfigured ? 'Auth setup required' : 'Systems ready'}</span></header>
      <section className="auth-layout">
        <div className="auth-copy">
          <p className="eyebrow">Personal wallet</p>
          <h1>Money, moving with purpose.</h1>
          <p>Track incoming collections, manage your balance, and submit payouts from one clear workspace.</p>
          <div className="auth-accent"><span>01</span><span>Collections · balance · withdrawals</span></div>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="form-heading">
            <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Get started'}</p>
            <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
          </div>
          {mode === 'register' && (
            <label>Full name<input required minLength="2" maxLength="80" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          )}
          <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Password<input required type="password" minLength="8" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          {!databaseConnected && <p className="setup-note">Connect MongoDB in the backend environment before signing in.</p>}
          {databaseConnected && !authenticationConfigured && <p className="setup-note">Set a private JWT_SECRET of at least 32 characters in the backend environment before signing in.</p>}
          {notice && <p className={`form-notice ${notice.kind}`}>{notice.text}</p>}
          <button className="primary-button" type="submit" disabled={loading || !databaseConnected || !authenticationConfigured}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in to wallet' : 'Create wallet'}
          </button>
          <p className="auth-switch">
            {mode === 'login' ? 'New to Veloop?' : 'Already have an account?'}{' '}
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login') }}>
              {mode === 'login' ? 'Create account' : 'Sign in'}
            </button>
          </p>
        </form>
      </section>
      <footer className="auth-footer"><span>API</span><code>{API_URL}</code><span>USD · secure session</span></footer>
    </main>
  )
}

function Dashboard({ wallet, transactions, ledgerEntries, onNavigate }) {
  const pendingCollections = transactions
    .filter((transaction) => transaction.type === 'collection' && transaction.status === 'pending')
    .reduce((sum, transaction) => sum + transaction.amountCents, 0)
  const pendingWithdrawals = transactions.filter((transaction) => transaction.type === 'withdrawal' && transaction.status === 'pending').length
  const walletCards = [
    { label: 'VEs', value: Number(wallet?.ves ?? 0) },
    { label: 'SVEs', value: Number(wallet?.sves ?? 0) },
    { label: 'Gems', value: Number(wallet?.gems ?? 0) },
    { label: 'Tokens', value: Number(wallet?.tokens ?? 0) },
    { label: 'Spins', value: Number(wallet?.spins ?? 0) },
  ]

  return (
    <>
      <section className="balance-grid" aria-label="Wallet summary">
        <div className="balance-card">
          <div className="balance-card-top"><span>Available balance</span><span className="balance-symbol">USD</span></div>
          <p className="balance-amount">{formatMoney(wallet.balanceCents, wallet.currency)}</p>
          <div className="balance-card-bottom"><span>Wallet cap: {formatMoney(WALLET_POLICY.maxBalanceCents, wallet.currency)}</span><button onClick={() => onNavigate('payout')}>Make a withdrawal <span aria-hidden="true">↗</span></button></div>
        </div>
        <Metric label="Open collections" value={formatMoney(pendingCollections, wallet.currency)} detail="Awaiting payment confirmation" tone="lime" />
        <Metric label="Payouts in progress" value={String(pendingWithdrawals).padStart(2, '0')} detail="Pending withdrawal requests" tone="coral" />
      </section>

      <section className="wallet-summary-grid" style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: '1.5rem' }}>
        {walletCards.map((card) => (
          <div key={card.label} className="metric-card" style={{ padding: '1rem', borderRadius: '14px', background: '#0f172a', color: '#e2e8f0' }}>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{card.label}</span>
            <strong style={{ display: 'block', fontSize: '2rem', marginTop: '0.5rem' }}>{Number(card.value).toLocaleString()}</strong>
          </div>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="activity-section">
          <div className="section-heading"><div><p className="eyebrow">Wallet ledger</p><h2>Recent balance movements</h2></div><span className="record-count">{ledgerEntries.length} latest</span></div>
          {ledgerEntries.length === 0 ? (
            <div className="empty-state"><span className="empty-mark">+</span><h3>No balance movements yet</h3><p>Confirmed collections, withdrawals, and refunds appear here.</p><button className="text-button" onClick={() => onNavigate('collect')}>Create a collection request <span aria-hidden="true">→</span></button></div>
          ) : (
            <div className="activity-list">
              {ledgerEntries.map((entry) => (
                <article className="activity-row" key={entry._id}>
                  <span className={`activity-glyph ${entry.direction === 'debit' ? 'withdrawal' : ''}`}>{entry.direction === 'credit' ? '↓' : '↑'}</span>
                  <div className="activity-description"><h3>{entry.description}</h3><p>{formatDate(entry.createdAt)} <span>·</span> {entry.reference}</p></div>
                  <div className="activity-amount"><strong>{entry.direction === 'debit' ? '−' : '+'}{formatMoney(entry.amountCents, wallet.currency)}</strong><span className="transaction-status completed">Posted</span></div>
                </article>
              ))}
            </div>
          )}
        </div>
        <aside className="quick-actions">
          <p className="eyebrow">Move money</p>
          <h2>What would you like to do?</h2>
          <button className="action-link collect-action" onClick={() => onNavigate('collect')}><span><strong>Collect a payment</strong><small>Create an incoming payment request</small></span><b aria-hidden="true">↗</b></button>
          <button className="action-link withdraw-action" onClick={() => onNavigate('payout')}><span><strong>Withdraw funds</strong><small>Send available balance to a payout method</small></span><b aria-hidden="true">↗</b></button>
          <p className="settlement-note">Collections are added to your available balance only after payment is confirmed.</p>
        </aside>
      </section>
    </>
  )
}

function Metric({ label, value, detail, tone }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function CollectionView({ form, setForm, onSubmit, loading, transactions, currency }) {
  const recentCollections = transactions.filter((transaction) => transaction.type === 'collection').slice(0, 4)

  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <div className="section-heading"><div><p className="eyebrow">Incoming payments</p><h2>Create a collection</h2><p className="section-copy">Set an amount and reference for a payment you expect to receive.</p></div></div>
        <form className="workflow-form" onSubmit={onSubmit}>
          <label>Amount
            <span className="money-input"><span>$</span><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /><small>{currency}</small></span>
          </label>
          <label>What is this payment for?<input maxLength="100" placeholder="e.g. Invoice 1042" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Creating request…' : 'Create collection request'} <span aria-hidden="true">↗</span></button>
        </form>
        <div className="inline-info"><span>i</span><p>This records a pending request only. Your balance changes after a payment provider confirms the funds.</p></div>
      </div>
      <aside className="workflow-aside">
        <p className="eyebrow">Recent requests</p>
        <h3>Collections</h3>
        {recentCollections.length === 0 ? <p className="aside-empty">Your collection requests will show here.</p> : recentCollections.map((item) => (
          <div className="request-row" key={item._id}><div><strong>{item.description}</strong><small>{item.reference} · {item.status}</small></div><strong>{formatMoney(item.amountCents, currency)}</strong></div>
        ))}
      </aside>
    </section>
  )
}

function WithdrawalView({ form, setForm, onSubmit, loading, options, wallet, transactionsSupported }) {
  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <div className="section-heading"><div><p className="eyebrow">Payout</p><h2>Withdraw funds</h2><p className="section-copy">Choose where to send your available balance.</p></div></div>
        <div className="available-line"><span>Available to withdraw</span><strong>{formatMoney(wallet.balanceCents, wallet.currency)}</strong></div>
        <div className="inline-info"><span>i</span><p>Wallet cap: {formatMoney(WALLET_POLICY.maxBalanceCents, wallet.currency)} · Max single withdrawal: {formatMoney(WALLET_POLICY.maxWithdrawalCents, wallet.currency)} · Fixed payout amount: {formatMoney(WALLET_POLICY.fixedPayoutAmountCents, wallet.currency)}</p></div>
        <form className="workflow-form" onSubmit={onSubmit}>
          <label>Amount
            <span className="money-input"><span>$</span><input type="number" inputMode="decimal" min="0.01" step="0.01" max={(WALLET_POLICY.maxWithdrawalCents / 100).toFixed(2)} placeholder="0.00" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /><small>{wallet.currency}</small></span>
          </label>
          <fieldset className="method-fieldset"><legend>Withdrawal method</legend>
            <div className="method-options">{options.map((option) => (
              <label className={`method-option ${form.method === option.code ? 'selected' : ''}`} key={option.code}>
                <input type="radio" name="method" value={option.code} checked={form.method === option.code} onChange={() => setForm({ ...form, method: option.code })} />
                <span><strong>{option.label}</strong><small>{option.eta}</small></span>
              </label>
            ))}</div>
          </fieldset>
          <button className="primary-button" type="submit" disabled={loading || wallet.balanceCents <= 0 || !transactionsSupported}>{loading ? 'Submitting…' : 'Submit withdrawal request'} <span aria-hidden="true">↗</span></button>
        </form>
        <div className="inline-info"><span>i</span><p>{transactionsSupported ? 'Funds are reserved when your request is submitted. A payout provider must process the transfer.' : 'Withdrawals are disabled because this MongoDB server is standalone. Configure MongoDB as a replica set to enable atomic balance operations.'}</p></div>
      </div>
      <aside className="workflow-aside payout-aside">
        <p className="eyebrow">Before you submit</p>
        <h3>Withdrawal details</h3>
        <ul><li>Wallet cap: {formatMoney(WALLET_POLICY.maxBalanceCents, wallet.currency)}.</li><li>Single withdrawals are capped at {formatMoney(WALLET_POLICY.maxWithdrawalCents, wallet.currency)}.</li><li>Reserved funds leave the available balance immediately.</li></ul>
        <div className="aside-balance"><span>Available balance</span><strong>{formatMoney(wallet.balanceCents, wallet.currency)}</strong></div>
      </aside>
    </section>
  )
}

export default App
