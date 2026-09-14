// Verifies one bid against Dodo's API and marks it paid/failed if settled.
//
// POST { bid_id: string }
// → 200 { status: 'paid' | 'pending' | 'failed' | 'cancelled' | 'unknown', payment_id? }
//
// Why this exists: the webhook is the primary path (dodo-webhook marks the
// row), but webhooks can arrive late, fail verification, or be misconfigured.
// The frontend calls this after returning from checkout so "payment success"
// still paints the body even when the webhook hasn't landed yet. It also lets
// old `pending` rows recover on next visit.
//
// Env: DODO_API_KEY + DODO_ENV (test|live). SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Deploy: `supabase functions deploy verify-payment`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const DODO_API_KEY = Deno.env.get('DODO_API_KEY')
  if (!DODO_API_KEY) return json({ error: 'DODO_API_KEY not configured' }, 500)
  const dodoBase =
    Deno.env.get('DODO_ENV') === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com'

  let bidId = ''
  try {
    const body = await req.json()
    bidId = String(body?.bid_id ?? '')
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!bidId) return json({ error: 'bid_id is required' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: bid, error: bidError } = await admin.from('bids').select('*').eq('id', bidId).single()
  if (bidError || !bid) return json({ error: 'Bid not found' }, 404)
  if (bid.status !== 'pending') return json({ status: bid.status, payment_id: bid.dodo_payment_id })

  const dodoGet = async (path: string) => {
    const res = await fetch(`${dodoBase}${path}`, {
      headers: { Authorization: `Bearer ${DODO_API_KEY}` },
    })
    if (!res.ok) return null
    return res.json().catch(() => null)
  }

  // 1) Checkout session → payment_id + payment_status (per Dodo docs
  // GET /checkouts/{id} returns { payment_id, payment_status, ... }).
  let paymentId: string | null = bid.dodo_payment_id ?? null
  if (bid.dodo_session_id) {
    const session = await dodoGet(`/checkouts/${bid.dodo_session_id}`)
    if (session?.payment_id) paymentId = session.payment_id
    const payStatus = String(session?.payment_status ?? '').toLowerCase()
    console.info(`[verify-payment] bid=${bidId} session=${bid.dodo_session_id} payment=${paymentId} session_status=${payStatus}`)
    if (payStatus === 'succeeded' || payStatus === 'paid') {
      await admin
        .from('bids')
        .update({ status: 'paid', dodo_payment_id: paymentId, paid_at: new Date().toISOString() })
        .eq('id', bidId)
        .eq('status', 'pending')
      return json({ status: 'paid', payment_id: paymentId })
    }
    if (payStatus === 'failed' || payStatus === 'cancelled' || payStatus === 'expired') {
      const mapped = payStatus === 'failed' ? 'failed' : 'cancelled'
      await admin.from('bids').update({ status: mapped }).eq('id', bidId).eq('status', 'pending')
      return json({ status: mapped, payment_id: paymentId })
    }
  }

  // 2) Payment directly → status + metadata cross-check.
  if (paymentId) {
    const payment = await dodoGet(`/payments/${paymentId}`)
    const status = String(payment?.status ?? '').toLowerCase()
    console.info(`[verify-payment] bid=${bidId} payment=${paymentId} status=${status}`)
    if (status === 'succeeded') {
      await admin
        .from('bids')
        .update({ status: 'paid', dodo_payment_id: paymentId, paid_at: new Date().toISOString() })
        .eq('id', bidId)
        .eq('status', 'pending')
      return json({ status: 'paid', payment_id: paymentId })
    }
    if (status === 'failed' || status === 'cancelled') {
      await admin.from('bids').update({ status }).eq('id', bidId).eq('status', 'pending')
      return json({ status, payment_id: paymentId })
    }
  }

  // Still unsettled — leave pending so the webhook can finish it.
  return json({ status: 'pending', payment_id: paymentId })
})
