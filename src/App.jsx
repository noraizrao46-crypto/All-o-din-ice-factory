import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const assetBase = import.meta.env.BASE_URL

const money = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

function localDateKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function oneYearAgoDateKey() {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const emptySummary = {
  month: '',
  totals: { sales: 0, expenses: 0, electricity: 0, net: 0 },
  history: [],
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

function Icon({ name, size = 20 }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    sales: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 14 4-4 3 2 6-7" /><path d="M16 5h4v4" /></>,
    expense: <><path d="M12 3v18" /><path d="M17 7.5c0-1.6-1.8-2.5-4.5-2.5S8 6.1 8 7.5s1.2 2.2 4.5 2.5 4.5 1.1 4.5 2.5-1.8 2.5-4.5 2.5S8 14.1 8 12.5" /></>,
    power: <><path d="m13 2-3 8h7l-6 12 1-9H6l7-11Z" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    arrow: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.7 15.7 0 0 1-3.1 3.8" /><path d="M6.6 6.6C3.6 8.6 2 12 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4.1-.8" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    ice: <><path d="M12 2v20M4 7l16 10M4 17 20 7M7 3l5 3 5-3M7 21l5-3 5 3M2 9l5-1 1-5M22 15l-5 1-1 5M2 15l5 1 1 5M22 9l-5-1-1-5" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function MetricCard({ label, amount, icon, tone, helper }) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <div className={`metric-icon ${tone}`}><Icon name={icon} /></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{money.format(amount)}</p>
      <p className="metric-helper">{helper}</p>
    </article>
  )
}

function Header({ page, setPage, authenticated }) {
  return (
    <header className="site-header">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('overview') }} aria-label="All-o-din Ice Factory home">
        <img className="brand-logo" src={`${assetBase}all-o-din-factory-logo-optimized.png`} alt="All-o-din Ice Factory — Pure Ice, Cooler Tomorrow" />
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={page === 'overview' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('overview')}>Overview</button>
        <button className={page === 'admin' ? 'nav-link active' : 'nav-link'} onClick={() => setPage('admin')}>
          <Icon name="lock" size={15} /> {authenticated ? 'Admin' : 'Admin sign in'}
        </button>
      </nav>
      <span className="online-badge"><span /> Factory report</span>
    </header>
  )
}

function HistoryChart({ history }) {
  const max = Math.max(1, ...history.map((item) => Math.max(item.sales, item.outgoing)))
  return (
    <div className="chart-area">
      <div className="chart-scale"><span>{money.format(max)}</span><span>{money.format(max / 2)}</span><span>PKR 0</span></div>
      <div className="chart-grid" style={{ gridTemplateColumns: `repeat(${history.length}, minmax(48px, 1fr))` }}>
        {history.map((item) => (
          <div className="chart-column" key={item.month}>
            <div className="bars">
              <span className="bar sales-bar" style={{ height: item.sales ? `${Math.max(3, (item.sales / max) * 100)}%` : '0%' }} title={`Sales: ${money.format(item.sales)}`} />
              <span className="bar outgoing-bar" style={{ height: item.outgoing ? `${Math.max(3, (item.outgoing / max) * 100)}%` : '0%' }} title={`Expenses & electricity: ${money.format(item.outgoing)}`} />
            </div>
            <span className="chart-month">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const partners = [
  { name: 'RAO GHULAM MURTAZA', factory: 'All-o-din Ice Factory' },
  { name: 'RAO INTIZAR', factory: 'All-o-din Ice Factory' },
  { name: 'RAO IRFAN ALI', factory: 'All-o-din Ice Factory' },
  { name: 'RAO GHULAM SARWAR', factory: 'All-o-din Ice Factory' },
]

function PartnersSection() {
  return (
    <section className="partners-section" id="partners" aria-labelledby="partners-title">
      <div className="partners-heading">
        <p className="eyebrow"><span className="eyebrow-line" /> PARTNERS</p>
        <h2 id="partners-title">Our <em>partners.</em></h2>
      </div>
      <div className="partners-grid">
        {partners.map((partner, index) => (
          <article className="partner-card" key={partner.name}>
            <div className={`partner-portrait partner-portrait-${index + 1}`} role="img" aria-label={`Illustrated portrait of ${partner.name}`}>
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <path className="partner-portrait-body" d="M17 120c2-28 18-42 43-42s41 14 43 42H17Z" />
                <path className="partner-portrait-neck" d="M49 68h22v22H49z" />
                <ellipse className="partner-portrait-face" cx="60" cy="49" rx="24" ry="30" />
                <path className="partner-portrait-hair" d="M36 50c-4-25 8-39 25-39 21 0 29 15 24 40-5-5-7-13-8-19-9 7-21 11-37 10-1 4-2 6-4 8Z" />
              </svg>
            </div>
            <div>
              <span className="partner-label">PARTNER</span>
              <h3>{partner.name}</h3>
            </div>
            <div>
              <span className="partner-label">FACTORY</span>
              <p>{partner.factory}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function Overview({ summary, startDate, setStartDate, endDate, setEndDate, error, loading }) {
  const periodTitle = `${dateFormat.format(new Date(`${startDate}T12:00:00`))} – ${dateFormat.format(new Date(`${endDate}T12:00:00`))}`
  const availableHistory = summary.history.some((item) => item.sales || item.outgoing) ? summary.history : []
  return (
    <main>
      <div className="overview-visual">
        <section className="welcome-row">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> FACTORY PERFORMANCE</p>
            <h1>Good work starts<br />with a clear <em>picture.</em></h1>
            <p className="welcome-copy">A monthly look at the numbers behind our ice.</p>
          </div>
          <label className="month-picker">
            <span>REPORTING PERIOD</span>
            <span className="period-dates">
              <input aria-label="Start date" type="date" max={endDate || undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <span className="period-date-separator">to</span>
              <input aria-label="End date" type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </span>
          </label>
        </section>

        {error && <div className="alert error-alert overview-alert" role="alert">{error}</div>}
        <section className={`metrics-grid ${loading ? 'is-loading' : ''}`} aria-label={`${periodTitle} financial summary`}>
          <MetricCard label="Total sales" amount={summary.totals.sales} icon="sales" tone="blue" helper="Revenue recorded this month" />
          <MetricCard label="Operating expenses" amount={summary.totals.expenses} icon="expense" tone="orange" helper="General expenses this month" />
          <MetricCard label="Electricity bills" amount={summary.totals.electricity} icon="power" tone="yellow" helper="Power costs this month" />
          <MetricCard label="Net balance" amount={summary.totals.net} icon="arrow" tone="green" helper="Sales less all recorded costs" />
        </section>
      </div>

      <section className="report-grid">
        <article className="panel trend-panel">
          <div className="panel-heading">
            <div><p className="panel-kicker">SELECTED PERIOD</p><h2>Sales & outgoings</h2></div>
            <div className="chart-legend"><span><i className="legend-dot sales-dot" /> Sales</span><span><i className="legend-dot outgoing-dot" /> Expenses + power</span></div>
          </div>
          {availableHistory.length ? <HistoryChart history={availableHistory} /> : <div className="empty-chart"><span className="empty-icon"><Icon name="sales" size={23} /></span><strong>Your report is getting started</strong><span>Monthly trends will appear here as records are added.</span></div>}
        </article>
        <aside className="panel report-note">
          <div className="note-icon"><Icon name="ice" size={22} /></div>
          <p className="panel-kicker">SELECTED PERIOD</p>
          <h2>{periodTitle}</h2>
          <p className="note-copy">A snapshot of the factory’s recorded sales and running costs for these dates.</p>
          <div className="note-divider" />
          <div className="balance-line"><span>Net balance</span><strong className={summary.totals.net < 0 ? 'negative' : ''}>{money.format(summary.totals.net)}</strong></div>
          <p className="privacy-note"><Icon name="lock" size={14} /> Individual records are private to the admin.</p>
        </aside>
      </section>
      <p className="report-disclaimer">Figures include records dated from {periodTitle}.</p>
      <PartnersSection />
    </main>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer" id="site-footer">
      <div className="footer-main">
        <div className="footer-brand">
          <a className="brand footer-brand-link" href="#" aria-label="All-o-din Ice Factory home">
            <img className="brand-logo" src={`${assetBase}all-o-din-factory-logo-optimized.png`} alt="All-o-din Ice Factory — Pure Ice, Cooler Tomorrow" />
          </a>
          <p>Dependable ice, made with care for the businesses and people around us.</p>
        </div>
        <div className="footer-contact">
          <h2>Get in touch</h2>
          <a href="tel:+923087825174"><span className="footer-contact-icon" aria-hidden="true">☎</span> +92 308 7825174</a>
          <a href="mailto:ghulamsarwar030878@gmail.com"><span className="footer-contact-icon" aria-hidden="true">✉</span> ghulamsarwar030878@gmail.com</a>
        </div>
        <div className="footer-social">
          <h2>Follow along</h2>
          <div className="social-links">
            <a href="https://www.facebook.com/share/19wAdMpBAX/" target="_blank" rel="noreferrer" aria-label="Facebook">f</a>
            <a href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram">◎</a>
            <a href="https://wa.me/923087825174" target="_blank" rel="noreferrer" aria-label="WhatsApp">WA</a>
          </div>
          <p>Social profile links can be updated with your official pages.</p>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} All-o-din Ice Factory</span>
        <a href="#leadership">Our leadership team</a>
      </div>
    </footer>
  )
}

function AuthPanel({ initialized, onLogin, onSetup, busy }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const isSetup = !initialized

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      if (isSetup) await onSetup(username, password)
      else await onLogin(username, password)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return (
    <section className="auth-wrap">
      <div className="auth-card">
        <div className="auth-icon"><Icon name="lock" size={24} /></div>
        <p className="eyebrow"><span className="eyebrow-line" /> ADMIN ACCESS</p>
        <h1>{isSetup ? 'Set up your admin account.' : 'Welcome back.'}</h1>
        <p className="auth-copy">{isSetup ? 'Create the first account to start managing factory records.' : 'Sign in to manage sales, expenses, and electricity bills.'}</p>
        {error && <div className="alert error-alert" role="alert">{error}</div>}
        <form className="auth-form" onSubmit={submit}>
          <label>Username<input autoComplete="username" required minLength="3" maxLength="40" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Choose a username" /></label>
          <label>Password
            <span className="password-input-wrap">
              <input autoComplete={isSetup ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} required minLength="10" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" />
              <button className="password-visibility-button" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </span>
          </label>
          <button className="primary-button full-button" disabled={busy}>{busy ? 'Please wait…' : isSetup ? 'Create admin account' : 'Sign in'} <span>→</span></button>
        </form>
        <p className="auth-hint"><Icon name="lock" size={14} /> Private records are only available after sign-in.</p>
      </div>
      <div className="auth-side"><img className="auth-side-logo" src={`${assetBase}all-o-din-factory-logo-optimized.png`} alt="All-o-din Ice Factory — Pure Ice, Cooler Tomorrow" /><p className="panel-kicker">ALL-O-DIN ICE FACTORY</p><h2>Everything in<br />its right place.</h2><p>Keep an accurate record of the everyday numbers that keep your factory moving.</p></div>
    </section>
  )
}

function Admin({ authenticated, initialized, onLogin, onSetup, onLogout }) {
  const [entries, setEntries] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [type, setType] = useState('sale')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(localDateKey)
  const [notes, setNotes] = useState('')
  const [blockName, setBlockName] = useState('')
  const [blockCount, setBlockCount] = useState('')
  const [blockPrice, setBlockPrice] = useState('')
  const [blockSaleDate, setBlockSaleDate] = useState(localDateKey)
  const [busy, setBusy] = useState(false)
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const entriesRequestId = useRef(0)
  const blockCountValue = Number(blockCount)
  const blockUnitPriceCents = Math.round(Number(blockPrice) * 100)
  const blockSaleTotalCents = blockCountValue * blockUnitPriceCents
  const validBlockSaleTotal = Number.isSafeInteger(blockCountValue)
    && blockCountValue > 0
    && Number.isSafeInteger(blockUnitPriceCents)
    && blockUnitPriceCents > 0
    && Number.isSafeInteger(blockSaleTotalCents)
    && blockSaleTotalCents <= 99999999900

  const loadEntries = useCallback(async () => {
    const requestId = ++entriesRequestId.current
    setLoadingEntries(true)
    try {
      const filters = new URLSearchParams()
      if (startDate) filters.set('startDate', startDate)
      if (endDate) filters.set('endDate', endDate)
      const query = filters.toString()
      const data = await request(`/api/entries${query ? `?${query}` : ''}`)
      if (requestId === entriesRequestId.current) setEntries(data.entries)
    } catch (loadError) {
      if (requestId === entriesRequestId.current) setError(loadError.message)
      throw loadError
    } finally {
      if (requestId === entriesRequestId.current) setLoadingEntries(false)
    }
  }, [startDate, endDate])

  function changeStartDate(value) {
    setLoadingEntries(true)
    setError('')
    setStartDate(value)
  }

  function changeEndDate(value) {
    setLoadingEntries(true)
    setError('')
    setEndDate(value)
  }

  function clearDateRange() {
    setLoadingEntries(true)
    setError('')
    setStartDate('')
    setEndDate('')
  }

  useEffect(() => {
    if (!authenticated) return
    loadEntries().catch(() => {})
  }, [authenticated, loadEntries])

  async function addEntry(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await request('/api/entries', {
        method: 'POST',
        body: JSON.stringify({ type, title, amount: Number(amount), date, notes }),
      })
      setTitle('')
      setAmount('')
      setNotes('')
      setNotice('Record added successfully.')
      await loadEntries()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function addBlockSale(event) {
    event.preventDefault()
    if (!blockName.trim()) {
      setError('Enter a block name.')
      return
    }
    if (!validBlockSaleTotal) {
      setError('Enter a valid block quantity and price with a total below PKR 1,000,000,000.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      await request('/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          type: 'sale',
          title: `${blockName.trim()} - ${blockCountValue} blocks`,
          amount: blockSaleTotalCents / 100,
          date: blockSaleDate,
          notes: `Unit price: ${money.format(blockUnitPriceCents / 100)}`,
        }),
      })
      setBlockName('')
      setBlockCount('')
      setBlockPrice('')
      setNotice('Ice block sale added successfully.')
      await loadEntries()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteEntry(id) {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    setError('')
    setNotice('')
    try {
      await request(`/api/entries/${id}`, { method: 'DELETE' })
      setEntries((current) => current.filter((entry) => entry.id !== id))
      setNotice('Record deleted.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  if (!authenticated) return <AuthPanel initialized={initialized} onLogin={onLogin} onSetup={onSetup} busy={busy} />

  return (
    <main className="admin-main">
      <div className="admin-title-row">
        <div><p className="eyebrow"><span className="eyebrow-line" /> ADMIN WORKSPACE</p><h1>Factory records.</h1><p className="welcome-copy">Add and manage your monthly sales and operating costs.</p></div>
        <button className="text-button" onClick={onLogout}><Icon name="logout" size={17} /> Sign out</button>
      </div>
      {error && <div className="alert error-alert" role="alert">{error}</div>}
      {notice && <div className="alert success-alert" role="status">{notice}</div>}
      <section className="admin-layout">
        <article className="panel entry-panel">
          <div className="entry-forms-row">
            <section className="entry-form-column" aria-labelledby="entry-heading">
              <div className="panel-heading"><div><p className="panel-kicker">NEW RECORD</p><h2 id="entry-heading">ADD AN ENTRY</h2></div><span className="add-icon"><Icon name="plus" /></span></div>
              <form className="entry-form" onSubmit={addEntry}>
                <label>Record type<select value={type} onChange={(event) => setType(event.target.value)}><option value="sale">Sale</option><option value="expense">General expense</option><option value="electricity">Electricity bill</option></select></label>
                <label>Description<input required maxLength="100" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === 'sale' ? 'e.g. Ice block order' : type === 'electricity' ? 'e.g. Monthly electricity bill' : 'e.g. Packaging supplies'} /></label>
                <div className="form-row">
                  <label>Amount (PKR)<input required type="number" min="0.01" max="999999999" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
                  <label>Date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
                </div>
                <label>Notes <span className="optional">(optional)</span><textarea rows="3" maxLength="500" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add any useful details…" /></label>
                <button className="primary-button full-button" disabled={busy}><Icon name="plus" size={17} /> {busy ? 'Saving…' : 'Save record'}</button>
              </form>
            </section>
            <section className="entry-form-column" aria-labelledby="block-sale-heading">
              <div className="panel-heading"><div><p className="panel-kicker">QUICK SALE</p><h2 id="block-sale-heading">ICE BLOCK SALE</h2></div></div>
              <form className="entry-form" onSubmit={addBlockSale}>
                <label>Name<input required maxLength="70" value={blockName} onChange={(event) => setBlockName(event.target.value)} placeholder="e.g. Large ice block" /></label>
                <div className="form-row">
                  <label>Number of blocks<input required type="number" min="1" max="999999999" step="1" value={blockCount} onChange={(event) => setBlockCount(event.target.value)} placeholder="0" /></label>
                  <label>Value per block (PKR)<input required type="number" min="0.01" max="999999999" step="0.01" value={blockPrice} onChange={(event) => setBlockPrice(event.target.value)} placeholder="0.00" /></label>
                </div>
                <label>Sale date<input required type="date" value={blockSaleDate} onChange={(event) => setBlockSaleDate(event.target.value)} /></label>
                <p className="block-sale-total">Total sale <strong>{validBlockSaleTotal ? money.format(blockSaleTotalCents / 100) : '—'}</strong></p>
                <button className="primary-button full-button" disabled={busy || !validBlockSaleTotal}><Icon name="plus" size={17} /> {busy ? 'Saving…' : 'Add as sale'}</button>
              </form>
            </section>
          </div>
        </article>
        <article className="panel records-panel">
          <div className="panel-heading records-heading"><div><p className="panel-kicker">PRIVATE LEDGER</p><h2>Recent records</h2></div></div>
          <div className="ledger-date-filter">
            <label>From date<input type="date" max={endDate || undefined} value={startDate} onChange={(event) => changeStartDate(event.target.value)} /></label>
            <label>To date<input type="date" min={startDate || undefined} value={endDate} onChange={(event) => changeEndDate(event.target.value)} /></label>
            {(startDate || endDate) && <button className="text-button clear-date-filter" onClick={clearDateRange}>Show all dates</button>}
          </div>
          {loadingEntries ? <div className="empty-records"><span className="empty-icon"><Icon name="dashboard" size={22} /></span><strong>Updating records…</strong><span>Applying the selected date range.</span></div> : entries.length ? (
            <div className="table-scroll"><table><thead><tr><th>RECORD</th><th>DATE</th><th>TYPE</th><th className="amount-cell">AMOUNT</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
              {entries.map((entry) => <tr key={entry.id}><td><strong>{entry.title}</strong>{entry.notes && <small>{entry.notes}</small>}</td><td>{dateFormat.format(new Date(`${entry.date}T12:00:00`))}</td><td><span className={`type-pill ${entry.type}`}>{entry.type === 'sale' ? 'Sale' : entry.type === 'electricity' ? 'Electricity' : 'Expense'}</span></td><td className={`amount-cell ${entry.type === 'sale' ? 'income-amount' : ''}`}>{money.format(entry.amount)}</td><td><button className="delete-button" aria-label={`Delete ${entry.title}`} onClick={() => deleteEntry(entry.id)}><Icon name="close" size={17} /></button></td></tr>)}
            </tbody></table></div>
          ) : <div className="empty-records"><span className="empty-icon"><Icon name="dashboard" size={22} /></span><strong>{loadingEntries ? 'Loading records…' : 'No records for these dates'}</strong><span>{loadingEntries ? 'Please wait.' : 'Choose another date range or show all dates.'}</span></div>}
        </article>
      </section>
      <p className="admin-privacy"><Icon name="lock" size={14} /> This ledger is private. The public overview shows monthly totals only.</p>
    </main>
  )
}

export default function App() {
  const [page, setPage] = useState('overview')
  const [startDate, setStartDate] = useState(oneYearAgoDateKey)
  const [endDate, setEndDate] = useState(localDateKey)
  const [summary, setSummary] = useState(emptySummary)
  const [initialized, setInitialized] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const summaryRequestId = useRef(0)

  const refreshStatus = useCallback(async () => {
    const status = await request('/api/status')
    setInitialized(status.initialized)
    setAuthenticated(status.authenticated)
  }, [])

  const refreshSummary = useCallback(async () => {
    const requestId = ++summaryRequestId.current
    if (!startDate || !endDate || startDate > endDate) {
      setLoading(false)
      setError('Start date must be on or before the end date.')
      return
    }

    setLoading(true)
    const params = new URLSearchParams({ startDate, endDate })
    try {
      const data = await request(`/api/summary?${params}`)
      if (requestId === summaryRequestId.current) {
        setSummary(data)
        setError('')
      }
    } catch (loadError) {
      if (requestId === summaryRequestId.current) setError(loadError.message)
      throw loadError
    } finally {
      if (requestId === summaryRequestId.current) setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    Promise.all([refreshStatus(), refreshSummary()])
      .catch((loadError) => setError(loadError.message))
  }, [refreshStatus, refreshSummary])

  useEffect(() => {
    if (!authenticated || page !== 'overview') return
    refreshSummary().catch((loadError) => setError(loadError.message))
  }, [authenticated, page, refreshSummary])

  async function authenticate(path, username, password) {
    setBusy(true)
    setError('')
    try {
      await request(path, { method: 'POST', body: JSON.stringify({ username, password }) })
      await refreshStatus()
      setPage('admin')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await request('/api/logout', { method: 'POST', body: '{}' })
      setAuthenticated(false)
      setPage('overview')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  return (
    <div className="app-shell">
      <Header page={page} setPage={setPage} authenticated={authenticated} />
      {page === 'overview'
        ? <Overview summary={summary} startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate} error={error} loading={loading} />
        : <Admin authenticated={authenticated} initialized={initialized} busy={busy} onLogin={(username, password) => authenticate('/api/login', username, password)} onSetup={(username, password) => authenticate('/api/setup', username, password)} onLogout={logout} />}
      <SiteFooter />
    </div>
  )
}
