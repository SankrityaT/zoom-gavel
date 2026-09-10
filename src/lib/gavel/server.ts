import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { toSession, type AuctionSessionRow } from './types'

// Service-role client, server only. Lazy so `next build` succeeds before
// env vars exist; never import this from client components.
let client: SupabaseClient | null = null

function getServiceClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      throw new Error(
        'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    client = createClient(url, serviceKey, {
      auth: { persistSession: false },
    })
  }
  return client
}

export async function getSession(uuid: string) {
  const { data, error } = await getServiceClient()
    .from('auction_sessions')
    .select('*')
    .eq('uuid', uuid)
    .maybeSingle<AuctionSessionRow>()

  if (error) throw new Error(`getSession failed: ${error.message}`)
  return data ? toSession(data) : null
}

// Single round trip: inserts if absent, returns the existing row
// untouched otherwise (never resets a live bid).
export async function ensureSession(
  uuid: string,
  itemName: string,
  openingBid: number,
) {
  const { data, error } = await getServiceClient()
    .rpc('ensure_session', { p_uuid: uuid, p_item: itemName, p_opening: openingBid })
    .select()

  if (error) throw new Error(`ensureSession failed: ${error.message}`)
  const rows = data as AuctionSessionRow[] | null
  if (!rows || rows.length === 0) {
    throw new Error('ensureSession: no row returned')
  }
  return toSession(rows[0])
}

// Returns the updated session, or null if the bid was rejected
// (lower than current, session closed, or unknown uuid).
export async function placeBid(uuid: string, amount: number, bidderId: string) {
  const { data, error } = await getServiceClient()
    .rpc('place_bid', { p_uuid: uuid, p_amount: amount, p_bidder: bidderId })
    .select()

  if (error) throw new Error(`placeBid failed: ${error.message}`)
  const rows = data as AuctionSessionRow[] | null
  return rows && rows.length > 0 ? toSession(rows[0]) : null
}
