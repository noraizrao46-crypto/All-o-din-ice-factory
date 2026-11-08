import { createServer } from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const envPath = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(envPath)) process.loadEnvFile(envPath)

const port = Number(process.env.PORT || 3001)
const sessionDuration = 7 * 24 * 60 * 60 * 1000
const loginAttempts = new Map()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const allowedOrigins = [
  process.env.FRONTEND_ORIGIN || 'https://noraizrao46-crypto.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function addSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
}

function validOrigin(request) {
  const origin = request.headers.origin
  return !origin || allowedOrigins.includes(origin)
}

function addCorsHeaders(request, response) {
  const origin = request.headers.origin

  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
}

function requireSameOrigin(request, response) {
  if (validOrigin(request)) return true

  json(response, 403, { error: 'Request origin was not accepted.' })
  return false
}

function bearerToken(request) {
  const authorization = request.headers.authorization || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1] || ''

  return token.length <= 200 ? token : ''
}

async function getAdmin(request) {
  const token = bearerToken(request)
  if (!token) return null

  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('admin_id')
    .eq('token_hash', tokenHash)
    .gt('expires_at', Date.now())
    .maybeSingle()

  if (sessionError) throw sessionError
  if (!session) return null

  const { data: admin, error: adminError } = await supabase
    .from('admins')
    .select('id, username')
    .eq('id', session.admin_id)
    .maybeSingle()

  if (adminError) throw adminError
  return admin || null
}

async function requireAdmin(request, response) {
  const admin = await getAdmin(request)

  if (admin) return admin

  json(response, 401, {
    error: 'Please sign in to access the private ledger.',
  })

  return null
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = ''
    let tooLarge = false

    request.on('data', (chunk) => {
      if (tooLarge) return

      body += chunk

      if (body.length > 16_384) {
        tooLarge = true
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }))
      }
    })

    request.on('end', () => {
      if (tooLarge) return

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

function monthAfter(month) {
  const date = new Date(`${month}-01T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

function monthBefore(month, offset) {
  const date = new Date(`${month}-01T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - offset)
  return date.toISOString().slice(0, 7)
}

async function getEntries(startDate, endDate) {
  const { data, error } = await supabase
    .from('entries')
    .select('id, type, title, amount_cents, entry_date, notes')
    .gte('entry_date', startDate)
    .lte('entry_date', endDate)

  if (error) throw error
  return data || []
}

function calculateTotals(entries) {
  let sales = 0
  let expenses = 0
  let electricity = 0

  for (const entry of entries) {
    const amount = Number(entry.amount_cents)

    if (entry.type === 'sale') sales += amount
    if (entry.type === 'expense') expenses += amount
    if (entry.type === 'electricity') electricity += amount
  }

  return {
    sales,
    expenses,
    electricity,
    net: sales - expenses - electricity,
  }
}

function monthlyHistory(entries, firstMonth, lastMonth, includeYear = false) {
  const rows = new Map()

  for (const entry of entries) {
    const month = entry.entry_date.slice(0, 7)
    const current = rows.get(month) || { sales: 0, outgoing: 0 }
    const amount = Number(entry.amount_cents)

    if (entry.type === 'sale') current.sales += amount
    else current.outgoing += amount

    rows.set(month, current)
  }

  const firstDate = new Date(`${firstMonth}-01T12:00:00Z`)
  const lastDate = new Date(`${lastMonth}-01T12:00:00Z`)
  const monthCount =
    (lastDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12
    + lastDate.getUTCMonth() - firstDate.getUTCMonth() + 1

  const history = []

  for (let offset = 0; offset < monthCount; offset += 1) {
    const date = new Date(firstDate)
    date.setUTCMonth(date.getUTCMonth() + offset)

    const key = date.toISOString().slice(0, 7)
    const row = rows.get(key) || { sales: 0, outgoing: 0 }

    history.push({
      month: key,
      label: new Intl.DateTimeFormat('en', {
        month: 'short',
        ...(includeYear ? { year: '2-digit' } : {}),
        timeZone: 'UTC',
      }).format(date),
      sales: row.sales / 100,
      outgoing: row.outgoing / 100,
    })
  }

  return history
}

async function sendSummary(response, month) {
  const firstMonth = monthBefore(month, 5)
  const entries = await getEntries(
    `${firstMonth}-01`,
    `${month}-31`,
  )

  const currentEntries = entries.filter(
    (entry) => entry.entry_date.startsWith(month),
  )

  const totals = calculateTotals(currentEntries)

  json(response, 200, {
    month,
    totals: {
      sales: totals.sales / 100,
      expenses: totals.expenses / 100,
      electricity: totals.electricity / 100,
      net: totals.net / 100,
    },
    history: monthlyHistory(entries, firstMonth, month),
  })
}

async function sendDateRangeSummary(response, startDate, endDate) {
  const entries = await getEntries(startDate, endDate)
  const totals = calculateTotals(entries)

  json(response, 200, {
    startDate,
    endDate,
    totals: {
      sales: totals.sales / 100,
      expenses: totals.expenses / 100,
      electricity: totals.electricity / 100,
      net: totals.net / 100,
    },
    history: monthlyHistory(
      entries,
      startDate.slice(0, 7),
      endDate.slice(0, 7),
      true,
    ),
  })
}

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url

  if (request.method === 'GET' && pathname === '/api/status') {
    const { data: admin, error } = await supabase
      .from('admins')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (error) throw error

    json(response, 200, {
      initialized: Boolean(admin),
      authenticated: Boolean(await getAdmin(request)),
    })
    return
  }

  if (request.method === 'GET' && pathname === '/api/summary') {
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (startDate !== null || endDate !== null) {
      if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
        json(response, 400, {
          error: 'Choose a valid start and end date for the reporting period.',
        })
        return
      }

      await sendDateRangeSummary(response, startDate, endDate)
      return
    }

    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)

    if (!validMonth(month)) {
      json(response, 400, { error: 'Choose a valid reporting month.' })
      return
    }

    await sendSummary(response, month)
    return
  }

  if (request.method === 'POST' && (pathname === '/api/setup' || pathname === '/api/login')) {
    if (!requireSameOrigin(request, response)) return

    const body = await readBody(request)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username) || password.length < 10 || password.length > 128) {
      json(response, 400, {
        error: 'Use a 3–40 character username and a password of at least 10 characters.',
      })
      return
    }

    let admin

    if (pathname === '/api/setup') {
      const { data: existing, error: checkError } = await supabase
        .from('admins')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (checkError) throw checkError

      if (existing) {
        json(response, 409, {
          error: 'An admin account already exists. Please sign in instead.',
        })
        return
      }

      const salt = randomBytes(16).toString('hex')
      const passwordHash = scryptSync(password, salt, 64).toString('hex')

      const { data: created, error: createError } = await supabase
        .from('admins')
        .insert({
          username,
          salt,
          password_hash: passwordHash,
        })
        .select('id, username')
        .single()

      if (createError) throw createError
      admin = created
    } else {
      const now = Date.now()
      const address = request.socket.remoteAddress || 'unknown'
      const attempt = loginAttempts.get(address)

      if (attempt && attempt.until > now && attempt.count >= 8) {
        json(response, 429, {
          error: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
        })
        return
      }

      const { data: foundAdmin, error: lookupError } = await supabase
        .from('admins')
        .select('id, username, salt, password_hash')
        .eq('username', username)
        .maybeSingle()

      if (lookupError) throw lookupError

      const expected = foundAdmin
        ? Buffer.from(foundAdmin.password_hash, 'hex')
        : Buffer.alloc(64)

      const actual = scryptSync(
        password,
        foundAdmin?.salt || 'unknown-user-salt',
        64,
      )

      const matches = timingSafeEqual(actual, expected) && Boolean(foundAdmin)

      if (!matches) {
        const current = loginAttempts.get(address)

        loginAttempts.set(address, {
          count: current?.until > now ? current.count + 1 : 1,
          until: now + 15 * 60 * 1000,
        })

        json(response, 401, { error: 'Username or password is incorrect.' })
        return
      }

      loginAttempts.delete(address)
      admin = foundAdmin
    }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const { error: sessionError } = await supabase
      .from('sessions')
      .insert({
        token_hash: tokenHash,
        admin_id: admin.id,
        expires_at: Date.now() + sessionDuration,
      })

    if (sessionError) throw sessionError

    json(response, 200, {
      username: admin.username,
      token,
    })
    return
  }

  if (request.method === 'POST' && pathname === '/api/logout') {
    if (!requireSameOrigin(request, response)) return

    const token = bearerToken(request)

    if (token) {
      const tokenHash = createHash('sha256').update(token).digest('hex')

      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('token_hash', tokenHash)

      if (error) throw error
    }

    json(response, 200, { ok: true })
    return
  }

  if (pathname === '/api/entries' && request.method === 'GET') {
    if (!await requireAdmin(request, response)) return

    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const month = searchParams.get('month')

    if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
      json(response, 400, { error: 'Choose valid start and end dates.' })
      return
    }

    if (startDate && endDate && startDate > endDate) {
      json(response, 400, {
        error: 'The start date must be on or before the end date.',
      })
      return
    }

    let query = supabase
      .from('entries')
      .select('id, type, title, amount_cents, entry_date, notes')

    if (startDate) query = query.gte('entry_date', startDate)
    if (endDate) query = query.lte('entry_date', endDate)

    if (!startDate && !endDate && month) {
      if (!validMonth(month)) {
        json(response, 400, { error: 'Choose a valid reporting month.' })
        return
      }

      query = query
        .gte('entry_date', `${month}-01`)
        .lt('entry_date', monthAfter(month))
    }

    const { data, error } = await query
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false })

    if (error) throw error

    const entries = (data || []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      date: entry.entry_date,
      notes: entry.notes,
      amount: Number(entry.amount_cents) / 100,
    }))

    json(response, 200, { entries })
    return
  }

  if (pathname === '/api/entries' && request.method === 'POST') {
    if (!requireSameOrigin(request, response)) return
    if (!await requireAdmin(request, response)) return

    const body = await readBody(request)
    const types = ['sale', 'expense', 'electricity']

    if (!types.includes(body.type)) {
      json(response, 400, {
        error: 'Choose sale, general expense, or electricity bill.',
      })
      return
    }

    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) {
      json(response, 400, {
        error: 'Description is required and must be 100 characters or fewer.',
      })
      return
    }

    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 999999999) {
      json(response, 400, {
        error: 'Enter an amount greater than zero and below PKR 1,000,000,000.',
      })
      return
    }

    const amountCents = Math.round(body.amount * 100)

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents / 100 !== body.amount) {
      json(response, 400, {
        error: 'Enter an amount using no more than two decimal places.',
      })
      return
    }

    if (!validDate(body.date)) {
      json(response, 400, { error: 'Choose a valid record date.' })
      return
    }

    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

    if (notes.length > 500) {
      json(response, 400, {
        error: 'Notes must be 500 characters or fewer.',
      })
      return
    }

    const { error } = await supabase
      .from('entries')
      .insert({
        type: body.type,
        title: body.title.trim(),
        amount_cents: amountCents,
        entry_date: body.date,
        notes,
      })

    if (error) throw error

    json(response, 201, { ok: true })
    return
  }

  const entryMatch = pathname.match(/^\/api\/entries\/(\d+)$/)

  if (entryMatch && request.method === 'DELETE') {
    if (!requireSameOrigin(request, response)) return
    if (!await requireAdmin(request, response)) return

    const { data, error } = await supabase
      .from('entries')
      .delete()
      .eq('id', Number(entryMatch[1]))
      .select('id')

    if (error) throw error

    if (!data?.length) {
      json(response, 404, { error: 'Record not found.' })
      return
    }

    json(response, 200, { ok: true })
    return
  }

  json(response, 404, { error: 'API route not found.' })
}

const server = createServer(async (request, response) => {
  addSecurityHeaders(response)
  addCorsHeaders(request, response)

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

  try {
    if (!validOrigin(request)) {
      json(response, 403, { error: 'Request origin was not accepted.' })
      return
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }

    json(response, 404, { error: 'API route not found.' })
  } catch (error) {
    if (response.headersSent || response.destroyed) return

    if (error.status) {
      json(response, error.status, { error: error.message })
      return
    }

    console.error('Request failed:', error)
    json(response, 500, {
      error: 'The request could not be completed. Please try again.',
    })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Ice factory API listening on port ${port}`)
})

function close() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
