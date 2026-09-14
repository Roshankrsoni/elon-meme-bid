// Creates a Dodo Payments checkout session for one pending bid.
//
// POST { bid_id: string, return_base: string }
// → 200 { checkout_url, session_id }
// → 404 bid not found · 409 bid no longer payable (paid / outbid) · 502 Dodo error
//
// Env (edge-function secrets): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// injected automatically. Set DODO_API_KEY and DODO_ENV (test|live).
//
// Deploy: Supabase dashboard → Edge Functions → New function → paste this
// file, or `supabase functions deploy create-checkout`.

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
  let returnBase = ''
  try {
    const body = await req.json()
    bidId = String(body?.bid_id ?? '')
    returnBase = String(body?.return_base ?? '').replace(/\/$/, '')
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!bidId || !returnBase) return json({ error: 'bid_id and return_base are required' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: bid, error: bidError } = await admin.from('bids').select('*').eq('id', bidId).single()
  if (bidError || !bid) return json({ error: 'Bid not found' }, 404)
  if (bid.status !== 'pending') return json({ error: `Bid is ${bid.status}` }, 409)

  // Per-spot starting bids — mirrors minBid in brandSlotDefs (1-2 chest $100,
  // left upper arm (3rd sticker) $1, other arms $50, 6-7 back $100,
  // 8 lower back $120). Unknown spots fall back to the global $50 floor.
  const SPOT_MINIMUMS_CENTS: Record<string, number> = {
    Chest_Left: 10000,
    Chest_Right: 10000,
    UpperArm_Left: 100,
    UpperArm_Right: 5000,
    Forearm_Right: 5000,
    Back_Left: 10000,
    Back_Right: 10000,
    Back_Waist: 12000,
  }
  const spotFloor = SPOT_MINIMUMS_CENTS[bid.spot_id] ?? 5000
  if (bid.amount_cents < spotFloor) {
    return json({ error: `Minimum bid for this spot is $${spotFloor / 100}` }, 409)
  }

  // Server-side auction guard: the bid must beat every paid bid by at least
  // the $10 increment.
  const { data: top } = await admin
    .from('bids')
    .select('amount_cents')
    .eq('spot_id', bid.spot_id)
    .eq('status', 'paid')
    .order('amount_cents', { ascending: false })
    .limit(1)
  const topPaid = top?.[0]?.amount_cents ?? 0
  const BID_INCREMENT_CENTS = 1000
  if (bid.amount_cents < topPaid + BID_INCREMENT_CENTS) {
    return json({ error: 'This bid must beat the top paid bid by at least $10' }, 409)
  }

  const dodo = async (path: string, payload: unknown) => {
    const res = await fetch(`${dodoBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DODO_API_KEY}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Dodo ${path} failed (${res.status})`)
    return data
  }

  try {
    // One product per bid — amounts are auction-driven, so no fixed catalogue works.
    const product = await dodo('/products', {
      name: `Body spot — ${bid.spot_label} (${bid.brand_name})`.slice(0, 120),
      description: `Sponsorship of the ${bid.spot_label} spot at ${bid.amount_cents / 100} USD.`,
      tax_category: 'digital_products',
      price: {
        type: 'one_time_price',
        currency: 'USD',
        price: bid.amount_cents,
        discount: 0,
        purchasing_power_parity: false,
      },
      metadata: { bid_id: bid.id },
    })
    const productId = product?.product_id ?? product?.id
    if (!productId) throw new Error('Dodo returned no product id')

    const session = await dodo('/checkouts', {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: bid.email, name: bid.brand_name },
      return_url: `${returnBase}/?bid=${bid.id}`,
      metadata: { bid_id: bid.id },
    })
    if (!session?.checkout_url) throw new Error('Dodo returned no checkout URL')

    await admin
      .from('bids')
      .update({
        dodo_product_id: productId,
        dodo_session_id: session.session_id,
        checkout_url: session.checkout_url,
      })
      .eq('id', bid.id)

    return json({ checkout_url: session.checkout_url, session_id: session.session_id })
  } catch (err) {
    console.error('[create-checkout]', err)
    return json({ error: err instanceof Error ? err.message : 'Checkout failed' }, 502)
  }
})
