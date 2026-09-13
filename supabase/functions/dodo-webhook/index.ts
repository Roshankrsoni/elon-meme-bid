// Dodo Payments webhook → marks bids paid / failed / cancelled.
//
// Register in the Dodo dashboard (Developer → Webhooks) with endpoint
//   https://<project-ref>.supabase.co/functions/v1/dodo-webhook
// subscribed to payment.succeeded, payment.failed and payment.cancelled.
//
// Signature verification follows the Standard Webhooks spec: the signed
// content is `<webhook-id>.<webhook-timestamp>.<raw-body>`, HMAC-SHA256 with
// the endpoint signing secret (DODO_WEBHOOK_SECRET).
//
// Deploy: Supabase dashboard → Edge Functions → New function → paste this
// file, or `supabase functions deploy dodo-webhook`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.0'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifySignature(rawBody: string, headers: Headers, secret: string) {
  const id = headers.get('webhook-id') ?? ''
  const timestamp = headers.get('webhook-timestamp') ?? ''
  const signature = headers.get('webhook-signature') ?? ''
  if (!id || !timestamp || !signature) return false

  // Reject stale deliveries (5 minute tolerance).
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const keyB64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  )
  const expected =
    'v1,' + btoa(String.fromCharCode(...new Uint8Array(mac)))

  return signature
    .split(' ')
    .map((part) => part.split(',')[1] ?? part)
    .some((candidate) => timingSafeEqual(candidate, expected))
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = Deno.env.get('DODO_WEBHOOK_SECRET')
  if (!secret) {
    console.error('[dodo-webhook] DODO_WEBHOOK_SECRET not configured')
    return json({ error: 'Webhook secret not configured' }, 500)
  }

  const rawBody = await req.text()
  if (!(await verifySignature(rawBody, req.headers, secret))) {
    console.error('[dodo-webhook] signature verification failed')
    return json({ error: 'Invalid signature' }, 401)
  }

  let event: { type?: string; data?: Record<string, any> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const data = event.data ?? {}
  const bidId = data?.metadata?.bid_id ?? data?.metadata?.bidId ?? null
  const paymentId = data?.payment_id ?? data?.paymentId ?? null

  if (event.type === 'payment.succeeded' && bidId) {
    const { error } = await admin
      .from('bids')
      .update({ status: 'paid', dodo_payment_id: paymentId, paid_at: new Date().toISOString() })
      .eq('id', bidId)
      .eq('status', 'pending')
    if (error) console.error('[dodo-webhook] mark-paid failed', error)
    return json({ received: true })
  }

  if ((event.type === 'payment.failed' || event.type === 'payment.cancelled') && bidId) {
    const status = event.type === 'payment.failed' ? 'failed' : 'cancelled'
    await admin.from('bids').update({ status }).eq('id', bidId).eq('status', 'pending')
    return json({ received: true })
  }

  // Unknown event or no bid attached — acknowledge so Dodo stops retrying.
  console.info('[dodo-webhook] ignored event', event.type)
  return json({ received: true })
})
