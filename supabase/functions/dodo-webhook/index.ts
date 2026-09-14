// Dodo Payments webhook → marks bids paid / failed / cancelled.
//
// Register in the Dodo dashboard (Developer → Webhooks) with endpoint
//   https://<project-ref>.supabase.co/functions/v1/dodo-webhook
// subscribed to payment.succeeded, payment.failed and payment.cancelled.
//
// Signature verification follows the Standard Webhooks spec via the
// official library (per Dodo docs). Do NOT hand-roll the HMAC compare —
// the previous manual version compared `v1,<sig>` against `<sig>` and
// 401'd every delivery, so paid bids stayed `pending` forever.
//
// Deploy: `supabase functions deploy dodo-webhook`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.0'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = Deno.env.get('DODO_WEBHOOK_SECRET')
  if (!secret) {
    console.error('[dodo-webhook] DODO_WEBHOOK_SECRET not configured')
    return json({ error: 'Webhook secret not configured' }, 500)
  }

  const rawBody = await req.text()

  // Verify via the Standard Webhooks library (handles whsec_ prefix,
  // base64 key, multi-signature header and timestamp tolerance itself).
  try {
    const wh = new Webhook(secret)
    await wh.verify(rawBody, {
      'webhook-id': req.headers.get('webhook-id') ?? '',
      'webhook-signature': req.headers.get('webhook-signature') ?? '',
      'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
    })
  } catch (err) {
    console.error('[dodo-webhook] signature verification failed', err)
    return json({ error: 'Invalid signature' }, 401)
  }

  let event: { type?: string; data?: Record<string, any> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const data = (event.data ?? {}) as Record<string, any>

  // --- Resolve the bid -------------------------------------------------
  // Primary: checkout metadata we set in create-checkout ({ bid_id }).
  // Fallbacks: checkout_session_id → bids.dodo_session_id lookup, then
  // Dodo GET /payments/{id} to recover metadata when the webhook payload
  // is a trimmed subset.
  let bidId: string | null =
    data?.metadata?.bid_id ?? data?.metadata?.bidId ?? data?.metadata?.bid ?? null
  let paymentId: string | null = data?.payment_id ?? data?.paymentId ?? null
  const sessionId: string | null =
    data?.checkout_session_id ??
    data?.checkoutSessionId ??
    data?.session_id ??
    data?.checkout_session?.id ??
    null

  console.info(
    `[dodo-webhook] ${event.type} bid=${bidId ?? '-'} session=${sessionId ?? '-'} payment=${paymentId ?? '-'}`,
  )

  const DODO_API_KEY = Deno.env.get('DODO_API_KEY')
  const dodoBase =
    Deno.env.get('DODO_ENV') === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com'

  // Fallback 1: look up by checkout session id stored at checkout time.
  if (!bidId && sessionId) {
    const { data: bySession } = await admin
      .from('bids')
      .select('id')
      .eq('dodo_session_id', sessionId)
      .limit(1)
    if (bySession?.[0]?.id) {
      bidId = bySession[0].id
      console.info(`[dodo-webhook] resolved bid via session ${sessionId} → ${bidId}`)
    }
  }

  // Fallback 2: ask Dodo for the payment — it carries the full metadata +
  // checkout_session_id even when the webhook payload is trimmed.
  if (!bidId && paymentId && DODO_API_KEY) {
    try {
      const res = await fetch(`${dodoBase}/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${DODO_API_KEY}` },
      })
      if (res.ok) {
        const payment = await res.json()
        bidId = payment?.metadata?.bid_id ?? payment?.metadata?.bidId ?? null
        const paySession: string | null = payment?.checkout_session_id ?? null
        if (!bidId && paySession) {
          const { data: bySession } = await admin
            .from('bids')
            .select('id')
            .eq('dodo_session_id', paySession)
            .limit(1)
          if (bySession?.[0]?.id) bidId = bySession[0].id
        }
        if (bidId) console.info(`[dodo-webhook] resolved bid via payment API → ${bidId}`)
      }
    } catch (err) {
      console.error('[dodo-webhook] payment lookup failed', err)
    }
  }

  if (event.type === 'payment.succeeded' && bidId) {
    const { error } = await admin
      .from('bids')
      .update({ status: 'paid', dodo_payment_id: paymentId, paid_at: new Date().toISOString() })
      .eq('id', bidId)
      .eq('status', 'pending')
    if (error) console.error('[dodo-webhook] mark-paid failed', error)
    else console.info(`[dodo-webhook] marked paid ${bidId}`)
    return json({ received: true })
  }

  if ((event.type === 'payment.failed' || event.type === 'payment.cancelled') && bidId) {
    const status = event.type === 'payment.failed' ? 'failed' : 'cancelled'
    const { error } = await admin.from('bids').update({ status }).eq('id', bidId).eq('status', 'pending')
    if (error) console.error('[dodo-webhook] mark-failed failed', error)
    return json({ received: true })
  }

  // Unknown event or no bid attached — acknowledge so Dodo stops retrying.
  console.info('[dodo-webhook] ignored event', event.type, 'bid=', bidId ?? 'none')
  return json({ received: true })
})
