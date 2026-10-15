import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'
const DEFAULT_LOGIN_ACCOUNT = {
  name: 'Veloop Admin',
  email: 'admin@veloopwallet.com',
  password: 'Veloop@123',
}
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

const routeForPath = (path) => {
  if (path.startsWith('/payout')) return 'payout'
  if (path.startsWith('/collect')) return 'collect'
  if (path.startsWith('/rewards')) return 'rewards'
  if (path.startsWith('/overview')) return 'overview'
  return 'dashboard'
}

const canSubmitAuthForm = (mode, form) => (
  /^\S+@\S+\.\S+$/.test(form.email.trim())
  && form.password.length >= 8
  && (mode !== 'register' || form.name.trim().length >= 2)
)

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
    if (typeof window === 'undefined') return 'dashboard'
    return routeForPath(window.location.pathname)
  })
  const [rewards, setRewards] = useState([])
  const [integrations, setIntegrations] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [claimingDailyReward, setClaimingDailyReward] = useState(false)
  const [authForm, setAuthForm] = useState({
    name: DEFAULT_LOGIN_ACCOUNT.name,
    email: import.meta.env.VITE_DEFAULT_EMAIL || DEFAULT_LOGIN_ACCOUNT.email,
    password: import.meta.env.VITE_DEFAULT_PASSWORD || DEFAULT_LOGIN_ACCOUNT.password,
  })
  const [collectionForm, setCollectionForm] = useState({ amount: '', note: '' })
  const [demoPaymentForm, setDemoPaymentForm] = useState({ amount: '', method: 'upi' })
  const [demoWithdrawalForm, setDemoWithdrawalForm] = useState({ amount: '', method: 'upi' })
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: (WALLET_POLICY.fixedPayoutAmountCents / 100).toFixed(2),
    method: 'bank_transfer',
    destination: '',
  })
  const collectionRequestKey = useRef(null)
  const withdrawalRequestKey = useRef(null)
  const demoPaymentRequestKey = useRef(null)
  const demoWithdrawalRequestKey = useRef(null)
  const rewardRequestKeys = useRef({})

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
      setRoute(routeForPath(path))
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
    setRoute(routeForPath(safePath))
  }

  useEffect(() => {
    if (!token || !databaseConnected) return undefined
    let cancelled = false

    const loadDashboard = async () => {
      try {
        const [account, summary, options, ledger, rewardCatalog, integrationStatus] = await Promise.all([
          apiRequest('/auth/me', { token }),
          apiRequest('/wallet', { token }),
          apiRequest('/wallet/payout-options', { token }),
          apiRequest('/wallet/ledger?limit=10', { token }),
          apiRequest('/wallet/rewards', { token }),
          apiRequest('/wallet/integrations', { token }),
        ])
        if (cancelled) return
        setUser(account.user)
        setWallet(summary.wallet)
        setTransactions(summary.transactions)
        setPayoutOptions(options.options)
        setLedgerEntries(ledger.entries)
        setRewards(rewardCatalog.rewards)
        setIntegrations(integrationStatus.integrations)
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

  const claimDailyReward = async () => {
    setClaimingDailyReward(true)
    setNotice(null)
    try {
      const result = await apiRequest('/wallet/daily-streak/claim', { token, method: 'POST' })
      setWallet(result.wallet)
      const rewardText = [
        result.reward.ves ? `${result.reward.ves} VEs` : null,
        result.reward.spins ? `${result.reward.spins} ${result.reward.spins === 1 ? 'spin' : 'spins'}` : null,
      ].filter(Boolean).join(' and ')
      setNotice({ kind: 'success', text: `Day ${result.reward.streakDay} reward claimed: ${rewardText}.` })
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setClaimingDailyReward(false)
    }
  }

  const submitDemoPayment = async (event) => {
    event.preventDefault()
    const payload = { amountCents: toCents(demoPaymentForm.amount), method: demoPaymentForm.method }
    if (!payload.amountCents) {
      setNotice({ kind: 'error', text: 'Enter a valid demo payment amount.' })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest('/wallet/demo/payments', {
        token,
        method: 'POST',
        headers: { 'Idempotency-Key': requestKeyFor(demoPaymentRequestKey, payload) },
        body: JSON.stringify(payload),
      })
      setWallet(result.wallet)
      setDemoPaymentForm({ ...demoPaymentForm, amount: '' })
      demoPaymentRequestKey.current = null
      setNotice({ kind: 'success', text: `${result.message} Demo balance: ${formatMoney(result.wallet.demoBalanceCents, result.wallet.currency)}.` })
      await refreshWallet()
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const submitDemoWithdrawal = async (event) => {
    event.preventDefault()
    const payload = { amountCents: toCents(demoWithdrawalForm.amount), method: demoWithdrawalForm.method }
    if (!payload.amountCents) {
      setNotice({ kind: 'error', text: 'Enter a valid demo withdrawal amount.' })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const result = await apiRequest('/wallet/demo/withdrawals', {
        token,
        method: 'POST',
        headers: { 'Idempotency-Key': requestKeyFor(demoWithdrawalRequestKey, payload) },
        body: JSON.stringify(payload),
      })
      setWallet(result.wallet)
      setDemoWithdrawalForm({ ...demoWithdrawalForm, amount: '' })
      demoWithdrawalRequestKey.current = null
      setNotice({ kind: 'success', text: `${result.message} Remaining demo balance: ${formatMoney(result.wallet.demoBalanceCents, result.wallet.currency)}.` })
      await refreshWallet()
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const redeemReward = async (reward) => {
    setLoading(true)
    setNotice(null)
    try {
      const keyRef = rewardRequestKeys.current[reward.id] || { current: null }
      rewardRequestKeys.current[reward.id] = keyRef
      const result = await apiRequest(`/wallet/rewards/${reward.id}/redeem`, {
        token,
        method: 'POST',
        headers: { 'Idempotency-Key': requestKeyFor(keyRef, { rewardId: reward.id }) },
      })
      setWallet(result.wallet)
      delete rewardRequestKeys.current[reward.id]
      setNotice({ kind: 'success', text: `${result.message} Demo code: ${result.reward.demoCode}.` })
      await refreshWallet()
    } catch (error) {
      setNotice({ kind: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
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

  const pageTitle = {
    dashboard: 'Dashboard',
    overview: 'Overview',
    payout: 'Payout',
    collect: 'Collect money',
    rewards: 'Redeem rewards',
  }[route]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <p className="nav-caption">Workspace</p>
        <nav className="main-nav" aria-label="Wallet sections">
          <NavButton label="Dashboard" value="dashboard" active={route} onClick={() => navigateTo('/wallet')} />
          <NavButton label="Overview" value="overview" active={route} onClick={() => navigateTo('/overview')} />
          <NavButton label="Payout" value="payout" active={route} onClick={() => navigateTo('/payout')} />
          <NavButton label="Collect money" value="collect" active={route} onClick={() => navigateTo('/collect')} />
          <NavButton label="Redeem rewards" value="rewards" active={route} onClick={() => navigateTo('/rewards')} />
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
            <h1>{route === 'dashboard' ? `Good day, ${user.name.split(' ')[0]}` : pageTitle}</h1>
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
            demoForm={demoWithdrawalForm}
            setDemoForm={setDemoWithdrawalForm}
            onDemoSubmit={submitDemoWithdrawal}
          />
        ) : route === 'collect' ? (
          <CollectionView
            form={collectionForm}
            setForm={setCollectionForm}
            onSubmit={submitCollection}
            loading={loading}
            transactions={transactions}
            currency={wallet.currency}
            demoForm={demoPaymentForm}
            setDemoForm={setDemoPaymentForm}
            onDemoSubmit={submitDemoPayment}
            demoBalanceCents={wallet.demoBalanceCents}
          />
        ) : route === 'rewards' ? (
          <RewardsView rewards={rewards} wallet={wallet} integrations={integrations} onRedeem={redeemReward} loading={loading} />
        ) : route === 'overview' ? (
          <OverviewView wallet={wallet} transactions={transactions} ledgerEntries={ledgerEntries} onNavigate={navigateTo} />
        ) : (
          <Dashboard
            wallet={wallet}
            transactions={transactions}
            ledgerEntries={ledgerEntries}
            onClaimDailyReward={claimDailyReward}
            claimingDailyReward={claimingDailyReward}
            onNavigate={(next) => navigateTo(next === 'collect' ? '/collect' : next === 'rewards' ? '/rewards' : '/payout')}
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
          <button className="primary-button" type="submit" disabled={loading || !canSubmitAuthForm(mode, form)}>
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

function Dashboard({ wallet, transactions, ledgerEntries, onClaimDailyReward, claimingDailyReward, onNavigate }) {
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
      <DailyStreakCard
        dailyStreak={wallet.dailyStreak}
        onClaim={onClaimDailyReward}
        loading={claimingDailyReward}
      />
      <section className="balance-grid" aria-label="Wallet summary">
        <div className="balance-card">
          <div className="balance-card-top"><span>Available balance</span><span className="balance-symbol">USD</span></div>
          <p className="balance-amount">{formatMoney(wallet.balanceCents, wallet.currency)}</p>
          <div className="balance-card-bottom"><span>Wallet cap: {formatMoney(WALLET_POLICY.maxBalanceCents, wallet.currency)}</span><button onClick={() => onNavigate('payout')}>Make a withdrawal <span aria-hidden="true">↗</span></button></div>
        </div>
        <Metric label="Open collections" value={formatMoney(pendingCollections, wallet.currency)} detail="Awaiting payment confirmation" tone="lime" />
        <Metric label="Payouts in progress" value={String(pendingWithdrawals).padStart(2, '0')} detail="Pending withdrawal requests" tone="coral" />
      </section>

      <section className="demo-balance-banner">
        <div><p className="eyebrow">Demo-only funds</p><strong>{formatMoney(wallet.demoBalanceCents, wallet.currency)}</strong><span>Simulated balance · no real money</span></div>
        <button className="text-button" onClick={() => onNavigate('collect')}>Add demo funds <span aria-hidden="true">→</span></button>
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
          <button className="action-link" onClick={() => onNavigate('rewards')}><span><strong>Redeem rewards</strong><small>Use VEs for demo vouchers and credits</small></span><b aria-hidden="true">↗</b></button>
          <p className="settlement-note">Collections are added to your available balance only after payment is confirmed.</p>
        </aside>
      </section>
    </>
  )
}

function OverviewView({ wallet, transactions, ledgerEntries, onNavigate }) {
  const recentActivity = (wallet.demoActivities || []).slice(0, 5)
  return (
    <div className="overview-page">
      <section className="overview-cards" aria-label="Balances and rewards">
        <Metric label="Withdrawable balance" value={formatMoney(wallet.balanceCents, wallet.currency)} detail="Real wallet balance" tone="lime" />
        <Metric label="Demo balance" value={formatMoney(wallet.demoBalanceCents, wallet.currency)} detail="Simulated only · not cash" tone="coral" />
        <Metric label="Reward coins" value={Number(wallet.ves || 0).toLocaleString()} detail="VEs available to redeem" tone="lime" />
        <Metric label="Active streak" value={`${wallet.dailyStreak?.currentDays || 0} days`} detail={`${wallet.dailyStreak?.bestDays || 0} days best`} tone="coral" />
      </section>
      <section className="overview-lists">
        <div className="quick-actions">
          <p className="eyebrow">Demo wallet</p><h2>Recent simulated activity</h2>
          {recentActivity.length ? recentActivity.map((activity) => (
            <div className="request-row" key={activity.reference}>
              <div><strong>{activity.description}</strong><small>{activity.reference} · {formatDate(activity.createdAt)}</small></div>
              <strong>{activity.amountCents ? formatMoney(activity.amountCents, wallet.currency) : `${activity.vesSpent} VEs`}</strong>
            </div>
          )) : <p className="aside-empty">Demo payments, withdrawals, and reward claims will appear here.</p>}
        </div>
        <div className="quick-actions">
          <p className="eyebrow">Wallet activity</p><h2>Latest balance movements</h2>
          {ledgerEntries.length ? ledgerEntries.slice(0, 5).map((entry) => (
            <div className="request-row" key={entry._id}>
              <div><strong>{entry.description}</strong><small>{entry.reference} · {formatDate(entry.createdAt)}</small></div>
              <strong>{entry.direction === 'debit' ? '−' : '+'}{formatMoney(entry.amountCents, wallet.currency)}</strong>
            </div>
          )) : <p className="aside-empty">{transactions.length ? 'No posted wallet movements yet.' : 'No real balance activity yet.'}</p>}
          <div className="overview-actions">
            <button className="text-button" onClick={() => onNavigate('/collect')}>Collect money</button>
            <button className="text-button" onClick={() => onNavigate('/payout')}>Go to payout</button>
            <button className="text-button" onClick={() => onNavigate('/rewards')}>Redeem a reward</button>
          </div>
        </div>
      </section>
    </div>
  )
}

function DailyStreakCard({ dailyStreak, onClaim, loading }) {
  const schedule = dailyStreak?.rewardSchedule || []
  const nextReward = dailyStreak?.nextReward || { ves: 0, spins: 0 }
  const completedDay = dailyStreak?.currentDays
    ? ((dailyStreak.currentDays - 1) % 7) + 1
    : 0
  const rewardLabel = [
    nextReward.ves ? `${nextReward.ves} VEs` : null,
    nextReward.spins ? `${nextReward.spins} ${nextReward.spins === 1 ? 'spin' : 'spins'}` : null,
  ].filter(Boolean).join(' + ')

  return (
    <section className="daily-streak-card" aria-labelledby="daily-streak-title">
      <div className="daily-streak-header">
        <div>
          <p className="eyebrow">Daily rewards</p>
          <h2 id="daily-streak-title">{dailyStreak?.currentDays || 0} day streak</h2>
          <p className="daily-streak-copy">Check in once each UTC day. Miss a day and your active streak restarts.</p>
        </div>
        <div className="streak-best"><strong>{dailyStreak?.bestDays || 0}</strong><span>Best streak</span></div>
      </div>
      <div className="streak-reward-track" aria-label="Seven-day reward schedule">
        {schedule.map((reward) => {
          const isNext = dailyStreak?.canClaim && reward.cycleDay === nextReward.cycleDay
          const isComplete = reward.cycleDay <= completedDay
          return (
            <div className={`streak-reward-day ${isComplete ? 'complete' : ''} ${isNext ? 'next' : ''}`} key={reward.cycleDay}>
              <span>Day {reward.cycleDay}</span>
              <strong>{reward.ves} VEs</strong>
              {reward.spins > 0 && <small>+ {reward.spins} spin</small>}
            </div>
          )
        })}
      </div>
      <div className="daily-streak-footer">
        <span>{dailyStreak?.claimedToday ? `Come back tomorrow · next: ${rewardLabel}` : `Today's reward · ${rewardLabel}`}</span>
        <button className="primary-button" type="button" disabled={!dailyStreak?.canClaim || loading} onClick={onClaim}>
          {loading ? 'Claiming…' : dailyStreak?.claimedToday ? 'Claimed today' : 'Claim daily reward'}
        </button>
      </div>
      <p className="daily-streak-note">Rewards are VEs and spins only; they never add to your withdrawable USD balance.</p>
    </section>
  )
}

function Metric({ label, value, detail, tone }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function CollectionView({ form, setForm, onSubmit, loading, transactions, currency, demoForm, setDemoForm, onDemoSubmit, demoBalanceCents }) {
  const recentCollections = transactions.filter((transaction) => transaction.type === 'collection').slice(0, 4)

  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <div className="demo-payment-panel">
          <p className="eyebrow">Incoming · simulated</p>
          <h2>Add demo funds</h2>
          <p className="section-copy">Preview an incoming UPI, card, or Razorpay payment. This is a simulation: no real payment is taken.</p>
          <form className="workflow-form" onSubmit={onDemoSubmit}>
            <label>Amount
              <span className="money-input"><span>$</span><input type="number" inputMode="decimal" min="0.01" max="500" step="0.01" placeholder="0.00" required value={demoForm.amount} onChange={(event) => setDemoForm({ ...demoForm, amount: event.target.value })} /><small>USD</small></span>
            </label>
            <fieldset className="method-fieldset"><legend>Demo payment method</legend>
              <div className="method-options">
                {[['upi', 'UPI'], ['card', 'Card'], ['razorpay', 'Razorpay']].map(([value, label]) => (
                  <label className={`method-option ${demoForm.method === value ? 'selected' : ''}`} key={value}>
                    <input type="radio" name="demo-payment-method" value={value} checked={demoForm.method === value} onChange={() => setDemoForm({ ...demoForm, method: value })} />
                    <span><strong>{label}</strong><small>Demo only — no details collected</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Simulating…' : 'Simulate incoming payment'}</button>
          </form>
          <div className="demo-current-balance">Demo balance: <strong>{formatMoney(demoBalanceCents, currency)}</strong></div>
        </div>
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

function WithdrawalView({ form, setForm, onSubmit, loading, options, wallet, transactionsSupported, demoForm, setDemoForm, onDemoSubmit }) {
  return (
    <section className="workflow-layout">
      <div className="workflow-main">
        <div className="section-heading"><div><p className="eyebrow">Payout</p><h2>Withdraw funds</h2><p className="section-copy">Choose where to send your available balance.</p></div></div>
        <div className="demo-payment-panel">
          <p className="eyebrow">Demo payout · simulated</p>
          <h2>Withdraw demo funds</h2>
          <p className="section-copy">Try an outgoing UPI, Razorpay, or bank transfer using simulated funds only.</p>
          <div className="available-line"><span>Demo balance · not real money</span><strong>{formatMoney(wallet.demoBalanceCents, wallet.currency)}</strong></div>
          <form className="workflow-form" onSubmit={onDemoSubmit}>
            <label>Amount
              <span className="money-input"><span>$</span><input type="number" inputMode="decimal" min="0.01" max="500" step="0.01" placeholder="0.00" required value={demoForm.amount} onChange={(event) => setDemoForm({ ...demoForm, amount: event.target.value })} /><small>{wallet.currency}</small></span>
            </label>
            <fieldset className="method-fieldset"><legend>Demo payout method</legend>
              <div className="method-options">
                {[['upi', 'UPI'], ['razorpay', 'Razorpay'], ['bank_transfer', 'Bank transfer']].map(([value, label]) => (
                  <label className={`method-option ${demoForm.method === value ? 'selected' : ''}`} key={value}>
                    <input type="radio" name="demo-withdrawal-method" value={value} checked={demoForm.method === value} onChange={() => setDemoForm({ ...demoForm, method: value })} />
                    <span><strong>{label}</strong><small>No payment destination needed in demo mode</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="primary-button" type="submit" disabled={loading || wallet.demoBalanceCents <= 0}>{loading ? 'Simulating…' : 'Simulate outgoing payment'}</button>
          </form>
        </div>
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

function RewardsView({ rewards, wallet, integrations, onRedeem, loading }) {
  const liveProviders = [
    ['Amazon gift cards', integrations?.amazonGiftCards],
    ['Merchant vouchers', integrations?.merchantVouchers],
    ['Razorpay Checkout', integrations?.razorpayCheckout],
    ['RazorpayX payouts', integrations?.razorpayPayouts],
  ]

  return (
    <section className="rewards-page">
      <div className="rewards-intro">
        <div><p className="eyebrow">Rewards marketplace</p><h2>Choose a reward</h2><p className="section-copy">Spend VEs or spins on bonus coins and simulated wallet credit. Live merchant rewards are listed separately by availability.</p></div>
        <div className="reward-balance"><strong>{Number(wallet.ves || 0).toLocaleString()}</strong><span>VEs · {wallet.spins || 0} spins</span></div>
      </div>
      <section className="integration-panel" aria-label="Live provider availability">
        <div className="integration-panel-heading"><div><p className="eyebrow">Live fulfillment</p><h3>Provider connections</h3></div><span>{integrations?.currency?.code || 'USD'} wallet · INR unavailable</span></div>
        <div className="integration-capabilities">
          {liveProviders.map(([label, provider]) => (
            <article className="integration-capability" key={label}>
              <div><strong>{label}</strong><span>{provider?.provider || 'Provider not selected'}</span></div>
              <span className={provider?.enabled ? 'capability-status is-enabled' : 'capability-status'}>{provider?.enabled ? 'Available' : 'Unavailable'}</span>
              <p>{provider?.reason || 'Provider integration is not enabled.'}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="demo-mode-banner"><strong>DEMO CATALOG</strong><span>No merchant voucher is valid and no real money or discount is issued.</span></div>
      <div className="reward-grid">
        {rewards.map((reward) => {
          const canAfford = Number(wallet.ves || 0) >= reward.costVes && Number(wallet.spins || 0) >= (reward.costSpins || 0)
          const price = [
            reward.costVes ? `${reward.costVes.toLocaleString()} VEs` : null,
            reward.costSpins ? `${reward.costSpins} ${reward.costSpins === 1 ? 'spin' : 'spins'}` : null,
          ].filter(Boolean).join(' + ') || 'Free'
          return (
            <article className="reward-card" key={reward.id}>
              <span className="reward-category">{reward.category}</span>
              <h3>{reward.title}</h3>
              <p>{reward.description}</p>
              <strong className="reward-value">{reward.valueLabel}</strong>
              <div className="reward-card-footer"><span>{price}</span><button className="primary-button" type="button" disabled={loading || !canAfford} onClick={() => onRedeem(reward)}>{loading ? 'Please wait…' : canAfford ? 'Claim demo reward' : 'Not enough rewards'}</button></div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default App
