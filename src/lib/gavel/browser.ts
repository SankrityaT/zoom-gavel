import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function supabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

// Anon-key client for the browser: read + realtime only. RLS blocks writes;
// all writes go through /api/session/[key].
//
// Deliberately a DYNAMIC import: supabase-js touches WebSocket machinery
// when it initializes, and the Zoom client webview has no working
// WebSocket. Callers on the polling path never invoke this, so inside
// Zoom the library is never even downloaded or evaluated.
export async function getBrowserClient(): Promise<SupabaseClient> {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )
  }
  return client
}
