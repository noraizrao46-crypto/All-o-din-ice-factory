import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) throw new Error('Supabase credentials are missing.')

const supabase = createClient(url, key, {
  auth: { persistSession: false }
})

const db = new DatabaseSync('data/factory-backup.sqlite', {
  readOnly: true
})

try {
  const admins = db.prepare(
    'SELECT id, username, salt, password_hash, created_at FROM admins'
  ).all()

  const entries = db.prepare(
    'SELECT id, type, title, amount_cents, entry_date, notes, created_at FROM entries'
  ).all()

  console.log(`Found ${admins.length} admins and ${entries.length} entries.`)

  if (admins.length !== 1 || entries.length !== 5) {
    throw new Error('Unexpected backup record count. Migration stopped.')
  }

  const { error: adminError } = await supabase
    .from('admins')
    .upsert(admins, { onConflict: 'id' })

  if (adminError) throw adminError

  console.log('Admin account transferred.')

  const { error: entriesError } = await supabase
    .from('entries')
    .upsert(entries, { onConflict: 'id' })

  if (entriesError) throw entriesError

  console.log('Entries transferred.')

  const { count: adminCount, error: adminCheckError } = await supabase
    .from('admins')
    .select('*', { count: 'exact', head: true })

  if (adminCheckError) throw adminCheckError

  const { count: entryCount, error: entryCheckError } = await supabase
    .from('entries')
    .select('*', { count: 'exact', head: true })

  if (entryCheckError) throw entryCheckError

  console.log('Supabase admin records:', adminCount)
  console.log('Supabase entry records:', entryCount)

  if (adminCount !== 1 || entryCount !== 5) {
    throw new Error('Final record counts do not match the backup.')
  }

  console.log('Migration completed successfully.')
} finally {
  db.close()
}
