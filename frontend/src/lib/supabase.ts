import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured. Auth features will be disabled.')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      storageKey: 'pinzos-auth',
      autoRefreshToken: true,
      // detectSessionInUrl is OFF on purpose. With it on, this client parses the
      // OAuth callback hash itself AND our AuthCallback calls setSession() — two
      // concurrent ops contend gotrue's navigator.locks lock and one aborts with
      // "signal is aborted without reason" (seen on mobile, captured via the
      // auth_failure telemetry). AuthCallback is now the SOLE handler of the
      // callback URL (hash → setSession, ?code → exchangeCodeForSession), so
      // there's exactly one processor and no race.
      detectSessionInUrl: false,
    },
  }
)

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)
