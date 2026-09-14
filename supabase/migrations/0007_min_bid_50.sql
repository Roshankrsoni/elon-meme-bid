-- Sponsor My Body — raise the global backstop to the lowest per-spot floor.
-- Run in the Supabase SQL editor. Per-spot floors live in the client
-- (minBid in brandSlotDefs) and the create-checkout edge function.

alter table public.bids drop constraint if exists bids_min_amount;
alter table public.bids
  add constraint bids_min_amount check (amount_cents >= 5000);
