import { createServer } from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.PORT || 3001)
const isProduction = process.env.NODE_ENV === 'production'
const basePath = '/ice-factory-website/'
const dbPath = resolve(process.env.ICE_FACTORY_DB_PATH || join(root, 'data', 'factory.sqlite'))
const sessionDuration = 7 * 24 * 60 * 60 * 1000
const loginAttempts = new Map()
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

mkdirSync(join(dbPath, '..'), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('sale', 'expense', 'electricity')),
    title TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    entry_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(entry_date);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`)

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || ''
  for (const part of cookies.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return ''
}

function sessionCookie(token, maxAge = sessionDuration / 1000) {
  return `ice_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isProduction ? '; Secure' : ''}`
}

function validOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return true
  const expected = process.env.PUBLIC_ORIGIN || `http://${request.headers.host}`
  try {
    const originUrl = new URL(origin)
    if (originUrl.origin === new URL(expected).origin) return true
    return !isProduction && ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(originUrl.origin)
  } catch {
    return false
  }
}

function requireSameOrigin(request, response) {
  if (validOrigin(request)) return true
  json(response, 403, { error: 'Request origin was not accepted.' })
  return false
}

function getAdmin(request) {
  const token = cookieValue(request, 'ice_session')
  if (!token || token.length > 200) return null
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const session = db.prepare(`
    SELECT admins.id, admins.username
    FROM sessions JOIN admins ON admins.id = sessions.admin_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now())
  return session || null
}

function requireAdmin(request, response) {
  const admin = getAdmin(request)
  if (admin) return admin
  json(response, 401, { error: 'Please sign in to access the private ledger.' })
  return null
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 16_384) {
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolveBody(body ? JSON.parse(body) : {})
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }))
      }
    })
    request.on('error', reject)
  })
}

function validMonth(value) {
  return typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value)
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function sendSummary(response, month) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'sale' THEN amount_cents ELSE 0 END), 0) AS sales,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN type = 'electricity' THEN amount_cents ELSE 0 END), 0) AS electricity
    FROM entries WHERE substr(entry_date, 1, 7) = ?
  `).get(month)
  const start = new Date(`${month}-01T12:00:00Z`)
  start.setUTCMonth(start.getUTCMonth() - 5)
  const firstMonth = start.toISOString().slice(0, 7)
  const rows = db.prepare(`
    SELECT substr(entry_date, 1, 7) AS month,
      SUM(CASE WHEN type = 'sale' THEN amount_cents ELSE 0 END) AS sales,
      SUM(CASE WHEN type != 'sale' THEN amount_cents ELSE 0 END) AS outgoing
    FROM entries
    WHERE substr(entry_date, 1, 7) BETWEEN ? AND ?
    GROUP BY substr(entry_date, 1, 7)
  `).all(firstMonth, month)
  const rowByMonth = new Map(rows.map((row) => [row.month, row]))
  const history = []
  for (let offset = 0; offset < 6; offset += 1) {
    const date = new Date(`${firstMonth}-01T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + offset)
    const key = date.toISOString().slice(0, 7)
    const row = rowByMonth.get(key)
    history.push({
      month: key,
      label: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(date),
      sales: Number(row?.sales || 0) / 100,
      outgoing: Number(row?.outgoing || 0) / 100,
    })
  }
  const salesCents = Number(totals.sales)
  const expensesCents = Number(totals.expenses)
  const electricityCents = Number(totals.electricity)
  const sales = salesCents / 100
  const expenses = expensesCents / 100
  const electricity = electricityCents / 100
  json(response, 200, {
    month,
    totals: { sales, expenses, electricity, net: (salesCents - expensesCents - electricityCents) / 100 },
    history,
  })
}

function sendDateRangeSummary(response, startDate, endDate) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'sale' THEN amount_cents ELSE 0 END), 0) AS sales,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expenses,
      COALESCE(SUM(CASE WHEN type = 'electricity' THEN amount_cents ELSE 0 END), 0) AS electricity
    FROM entries WHERE entry_date BETWEEN ? AND ?
  `).get(startDate, endDate)
  const rows = db.prepare(`
    SELECT substr(entry_date, 1, 7) AS month,
      SUM(CASE WHEN type = 'sale' THEN amount_cents ELSE 0 END) AS sales,
      SUM(CASE WHEN type != 'sale' THEN amount_cents ELSE 0 END) AS outgoing
    FROM entries
    WHERE entry_date BETWEEN ? AND ?
    GROUP BY substr(entry_date, 1, 7)
  `).all(startDate, endDate)
  const rowByMonth = new Map(rows.map((row) => [row.month, row]))
  const firstMonth = startDate.slice(0, 7)
  const lastMonth = endDate.slice(0, 7)
  const firstDate = new Date(`${firstMonth}-01T12:00:00Z`)
  const lastDate = new Date(`${lastMonth}-01T12:00:00Z`)
  const monthCount = (lastDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12
    + lastDate.getUTCMonth() - firstDate.getUTCMonth() + 1
  const history = []
  for (let offset = 0; offset < monthCount; offset += 1) {
    const date = new Date(firstDate)
    date.setUTCMonth(date.getUTCMonth() + offset)
    const key = date.toISOString().slice(0, 7)
    const row = rowByMonth.get(key)
    history.push({
      month: key,
      label: new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date),
      sales: Number(row?.sales || 0) / 100,
      outgoing: Number(row?.outgoing || 0) / 100,
    })
  }
  const salesCents = Number(totals.sales)
  const expensesCents = Number(totals.expenses)
  const electricityCents = Number(totals.electricity)
  json(response, 200, {
    startDate,
    endDate,
    totals: {
      sales: salesCents / 100,
      expenses: expensesCents / 100,
      electricity: electricityCents / 100,
      net: (salesCents - expensesCents - electricityCents) / 100,
    },
    history,
  })
}

function addSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
}

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url
  if (request.method === 'GET' && pathname === '/api/status') {
    json(response, 200, {
      initialized: Boolean(db.prepare('SELECT id FROM admins LIMIT 1').get()),
      authenticated: Boolean(getAdmin(request)),
    })
    return
  }

  if (request.method === 'GET' && pathname === '/api/summary') {
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (startDate !== null || endDate !== null) {
      if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
        json(response, 400, { error: 'Choose a valid start and end date for the reporting period.' })
        return
      }
      sendDateRangeSummary(response, startDate, endDate)
      return
    }
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)
    if (!validMonth(month)) {
      json(response, 400, { error: 'Choose a valid reporting month.' })
      return
    }
    sendSummary(response, month)
    return
  }

  if (request.method === 'POST' && (pathname === '/api/setup' || pathname === '/api/login')) {
    if (!requireSameOrigin(request, response)) return
    const body = await readBody(request)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username) || password.length < 10 || password.length > 128) {
      json(response, 400, { error: 'Use a 3–40 character username and a password of at least 10 characters.' })
      return
    }

    if (pathname === '/api/setup') {
      db.exec('BEGIN IMMEDIATE')
      let created = false
      try {
        if (db.prepare('SELECT id FROM admins LIMIT 1').get()) {
          db.exec('ROLLBACK')
          json(response, 409, { error: 'An admin account already exists. Please sign in instead.' })
          return
        }
        const salt = randomBytes(16).toString('hex')
        const passwordHash = scryptSync(password, salt, 64).toString('hex')
        db.prepare('INSERT INTO admins (username, salt, password_hash) VALUES (?, ?, ?)').run(username, salt, passwordHash)
        db.exec('COMMIT')
        created = true
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      if (!created) return
    } else {
      const now = Date.now()
      const address = request.socket.remoteAddress || 'unknown'
      const attempt = loginAttempts.get(address)
      if (attempt && attempt.until > now && attempt.count >= 8) {
        json(response, 429, { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' })
        return
      }
      const admin = db.prepare('SELECT id, salt, password_hash FROM admins WHERE username = ?').get(username)
      const expected = admin ? Buffer.from(admin.password_hash, 'hex') : Buffer.alloc(64)
      const actual = scryptSync(password, admin?.salt || 'unknown-user-salt', 64)
      const matches = timingSafeEqual(actual, expected) && Boolean(admin)
      if (!matches) {
        const current = loginAttempts.get(address)
        loginAttempts.set(address, { count: current?.until > now ? current.count + 1 : 1, until: now + 15 * 60 * 1000 })
        json(response, 401, { error: 'Username or password is incorrect.' })
        return
      }
      loginAttempts.delete(address)
    }

    const admin = db.prepare('SELECT id, username FROM admins WHERE username = ?').get(username)
    const token = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(
      createHash('sha256').update(token).digest('hex'),
      admin.id,
      Date.now() + sessionDuration,
    )
    json(response, 200, { username: admin.username }, { 'Set-Cookie': sessionCookie(token) })
    return
  }

  if (request.method === 'POST' && pathname === '/api/logout') {
    if (!requireSameOrigin(request, response)) return
    const token = cookieValue(request, 'ice_session')
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(token).digest('hex'))
    json(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) })
    return
  }

  if (pathname === '/api/entries' && request.method === 'GET') {
    if (!requireAdmin(request, response)) return
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const month = searchParams.get('month')
    if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
      json(response, 400, { error: 'Choose valid start and end dates.' })
      return
    }
    if (startDate && endDate && startDate > endDate) {
      json(response, 400, { error: 'The start date must be on or before the end date.' })
      return
    }

    let where = ''
    let parameters = []
    if (startDate || endDate) {
      const conditions = []
      if (startDate) {
        conditions.push('entry_date >= ?')
        parameters.push(startDate)
      }
      if (endDate) {
        conditions.push('entry_date <= ?')
        parameters.push(endDate)
      }
      where = `WHERE ${conditions.join(' AND ')}`
    } else if (month) {
      if (!validMonth(month)) {
        json(response, 400, { error: 'Choose a valid reporting month.' })
        return
      }
      where = 'WHERE substr(entry_date, 1, 7) = ?'
      parameters = [month]
    }

    const entries = db.prepare(`
      SELECT id, type, title, amount_cents, entry_date AS date, notes
      FROM entries ${where} ORDER BY entry_date DESC, id DESC
    `).all(...parameters).map(({ amount_cents, ...entry }) => ({ ...entry, amount: Number(amount_cents) / 100 }))
    json(response, 200, { entries })
    return
  }

  if (pathname === '/api/entries' && request.method === 'POST') {
    if (!requireSameOrigin(request, response)) return
    if (!requireAdmin(request, response)) return
    const body = await readBody(request)
    const types = ['sale', 'expense', 'electricity']
    if (!types.includes(body.type)) {
      json(response, 400, { error: 'Choose sale, general expense, or electricity bill.' })
      return
    }
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
      json(response, 400, { error: 'Description is required and must be 100 characters or fewer.' })
      return
    }
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 999999999) {
      json(response, 400, { error: 'Enter an amount greater than zero and below PKR 1,000,000,000.' })
      return
    }
    const amountCents = Math.round(body.amount * 100)
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents / 100 !== body.amount) {
      json(response, 400, { error: 'Enter an amount using no more than two decimal places.' })
      return
    }
    if (!validDate(body.date)) {
      json(response, 400, { error: 'Choose a valid record date.' })
      return
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (notes.length > 500) {
      json(response, 400, { error: 'Notes must be 500 characters or fewer.' })
      return
    }
    db.prepare('INSERT INTO entries (type, title, amount_cents, entry_date, notes) VALUES (?, ?, ?, ?, ?)').run(
      body.type, body.title.trim(), amountCents, body.date, notes,
    )
    json(response, 201, { ok: true })
    return
  }

  const entryMatch = pathname.match(/^\/api\/entries\/(\d+)$/)
  if (entryMatch && request.method === 'DELETE') {
    if (!requireSameOrigin(request, response)) return
    if (!requireAdmin(request, response)) return
    const result = db.prepare('DELETE FROM entries WHERE id = ?').run(Number(entryMatch[1]))
    if (!result.changes) {
      json(response, 404, { error: 'Record not found.' })
      return
    }
    json(response, 200, { ok: true })
    return
  }

  json(response, 404, { error: 'API route not found.' })
}

function sendStatic(response, pathname) {
  const dist = join(root, 'dist')
  if (!isProduction || !existsSync(join(dist, 'index.html'))) {
    json(response, 404, { error: 'Page not found.' })
    return
  }
  if (pathname === basePath.slice(0, -1)) pathname = basePath
  const assetPath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.replace(/^\/+/, '')
  const requestedPath = assetPath || 'index.html'
  const file = normalize(join(dist, requestedPath))
  const fileRelative = relative(dist, file)
  if (isAbsolute(fileRelative) || fileRelative === '..' || fileRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    json(response, 403, { error: 'Forbidden.' })
    return
  }
  const target = existsSync(file) ? file : join(dist, 'index.html')
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream',
    'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  response.end(readFileSync(target))
}

const server = createServer(async (request, response) => {
  addSecurityHeaders(response)
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      sendStatic(response, url.pathname)
      return
    }
    json(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' })
  } catch (error) {
    if (response.headersSent || response.destroyed) return
    if (error.status) {
      json(response, error.status, { error: error.message })
      return
    }
    console.error('Request failed:', error)
    json(response, 500, { error: 'The request could not be completed. Please try again.' })
  }
})

server.listen(port, () => {
  console.log(`Ice factory API listening on http://localhost:${port}`)
  if (isProduction) console.log(`Using database at ${dbPath}`)
})

function close() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
