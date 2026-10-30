import { supabase } from './supabase'

let bootstrapPromise: Promise<void> | null = null

/**
 * Ensures this browser has a Supabase session.
 * Existing admin or anonymous sessions are preserved.
 * Concurrent calls share one sign-in attempt.
 */
export function ensureAnonymousSession(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (data.session) return

      const { error: signInError } = await supabase.auth.signInAnonymously()
      if (signInError) throw signInError
    })().finally(() => {
      bootstrapPromise = null
    })
  }

  return bootstrapPromise
}
