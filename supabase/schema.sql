-- The Sellout — schema. Run in the Supabase SQL editor. Idempotent.
create extension if not exists pgcrypto;

-- A live sale: an ordered queue of lots with one on the block at a time.
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- short join code used in share links
  title text not null default 'The Sellout',
  phase text not null default 'idle',        -- idle|presenting|bidding|sold|ended
  current_lot_id uuid,
  lot_ends_at timestamptz,
  high_bid numeric,
  high_bidder text,
  watchers int not null default 0,
  created_at timestamptz not null default now()
);

-- Something found in a room scan. Becomes a lot when picked for a sale.
create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete set null,
  name text not null,
  category text not null default 'Other',
  condition text,
  blurb text,
  image_url text,                            -- cutout used in the cloud and the sale
  source_image_url text,                     -- the room frame it came from
  bbox jsonb,                                -- {x,y,w,h} relative to the frame
  low numeric,
  high numeric,
  reserve numeric,
  comps jsonb not null default '[]'::jsonb,  -- [{title,price,url,source}]
  picked boolean not null default true,
  status text not null default 'found',      -- found|queued|live|sold|unsold
  sold_to text,
  sold_for numeric,
  checkout_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists sale_bids (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  lot_id uuid not null references lots(id) on delete cascade,
  bidder text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists sale_messages (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  name text not null,
  text text not null,
  answered boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists lots_sale_order on lots (sale_id, sort_order);
create index if not exists bids_lot_time on sale_bids (lot_id, created_at desc);

-- Hackathon posture: anyone may read, writes go through the service role in /api.
alter table sales enable row level security;
alter table lots enable row level security;
alter table sale_bids enable row level security;
alter table sale_messages enable row level security;
drop policy if exists "read sales" on sales;
drop policy if exists "read lots" on lots;
drop policy if exists "read bids" on sale_bids;
drop policy if exists "read messages" on sale_messages;
create policy "read sales" on sales for select using (true);
create policy "read lots" on lots for select using (true);
create policy "read bids" on sale_bids for select using (true);
create policy "read messages" on sale_messages for select using (true);

-- Realtime for the bidder page and the stage
do $$ begin alter publication supabase_realtime add table sales; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table lots; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table sale_bids; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table sale_messages; exception when duplicate_object then null; end $$;

-- Public bucket for room frames and cutouts
insert into storage.buckets (id, name, public) values ('scans', 'scans', true)
on conflict (id) do nothing;
drop policy if exists "public read scans" on storage.objects;
create policy "public read scans" on storage.objects for select using (bucket_id = 'scans');
