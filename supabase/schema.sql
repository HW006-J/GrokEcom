-- ClosetLive schema. Run in Supabase SQL editor. Idempotent.
create extension if not exists pgcrypto;

create table if not exists shows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  phase text not null default 'idle', -- idle|intro|qa|auction|closed|ended
  current_item_id uuid,
  auction_ends_at timestamptz,
  high_bid numeric,
  high_bidder_name text,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  title text not null,
  brand text,
  size text,
  condition text,
  description text,
  price_estimate numeric,
  buy_now_price numeric,
  shopify_product_id text,
  shopify_variant_id text,
  image_urls text[] not null default '{}',
  status text not null default 'listed', -- listed|live|sold|unsold
  sold_to text,
  invoice_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  bidder_name text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  name text not null,
  text text not null,
  answered boolean not null default false,
  created_at timestamptz not null default now()
);

-- Hackathon: open read access for anon (browser reads + realtime). Writes go through service role in /api.
alter table shows enable row level security;
alter table items enable row level security;
alter table bids enable row level security;
alter table messages enable row level security;
drop policy if exists "anon read shows" on shows;
drop policy if exists "anon read items" on items;
drop policy if exists "anon read bids" on bids;
drop policy if exists "anon read messages" on messages;
create policy "anon read shows" on shows for select using (true);
create policy "anon read items" on items for select using (true);
create policy "anon read bids" on bids for select using (true);
create policy "anon read messages" on messages for select using (true);

-- Realtime
do $$ begin
  alter publication supabase_realtime add table shows;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table bids;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table items;
exception when duplicate_object then null; end $$;

-- Public storage bucket for photos
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;
drop policy if exists "public read photos" on storage.objects;
create policy "public read photos" on storage.objects for select using (bucket_id = 'photos');
