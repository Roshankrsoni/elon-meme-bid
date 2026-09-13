import { createClient } from '@supabase/supabase-js'

const url = import.meta.env?.VITE_SUPABASE_URL
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY

/** True once the Supabase keys are in `.env` — the bid form degrades gracefully until then. */
export const isBackendConfigured = () => Boolean(url && anonKey)

/**
 * Null when the keys are missing so the page still runs (browsing, sponsors
 * list, body) and only the paid actions explain what is missing.
 */
export const supabase = isBackendConfigured() ? createClient(url, anonKey) : null
