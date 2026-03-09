-- Playtest Forge — Card Price Database (Supabase/Postgres)
--
-- 1) Create a new Supabase project
-- 2) Open SQL Editor
-- 3) Paste this entire file and run
--
-- Notes:
-- - This enables RLS with public read-only access.
-- - Writes are intended to be done ONLY from server routes using the Service Role key.

create extension if not exists pgcrypto;

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- STORES
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  base_url text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_stores
before update on public.stores
for each row execute function public.set_updated_at();

-- CARDS
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  set_code text,
  set_name text,
  collector_number text,
  scryfall_id uuid,
  scryfall_uri text,
  image_small text,
  image_normal text,
  image_png text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cards_name on public.cards using gin (to_tsvector('simple', name));
create index if not exists idx_cards_set on public.cards (set_code);
create index if not exists idx_cards_collector on public.cards (collector_number);

-- A loose uniqueness constraint to reduce duplicates.
-- (We keep it "loose" because some stores may not provide set+collector; those can be null.)
create unique index if not exists cards_unique_print
on public.cards (lower(name), coalesce(set_code,''), coalesce(collector_number,''));

create trigger set_updated_at_cards
before update on public.cards
for each row execute function public.set_updated_at();

-- LISTINGS (a store offering for a card)
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  product_url text not null,
  price numeric(12,2) not null,
  currency text not null default 'PHP',
  condition text,
  language text,
  in_stock boolean not null default true,
  stock_qty integer,
  last_seen_at timestamptz not null default now(),
  last_scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_url)
);

create index if not exists idx_listings_card on public.listings(card_id);
create index if not exists idx_listings_store on public.listings(store_id);
create index if not exists idx_listings_price on public.listings(price);

create trigger set_updated_at_listings
before update on public.listings
for each row execute function public.set_updated_at();

-- PRICE HISTORY
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  price numeric(12,2) not null,
  currency text not null default 'PHP',
  scraped_at timestamptz not null default now()
);

create index if not exists idx_price_history_listing on public.price_history(listing_id);
create index if not exists idx_price_history_time on public.price_history(scraped_at);

-- SCRAPE RUNS
create table if not exists public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  status text not null check (status in ('running','success','error')),
  message text,
  rows integer,
  meta jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_scrape_runs_store on public.scrape_runs(store_slug);
create index if not exists idx_scrape_runs_started on public.scrape_runs(started_at);

-- Row Level Security
alter table public.stores enable row level security;
alter table public.cards enable row level security;
alter table public.listings enable row level security;
alter table public.price_history enable row level security;
alter table public.scrape_runs enable row level security;

-- Public read-only policies
create policy "public_read_stores" on public.stores
for select using (true);

create policy "public_read_cards" on public.cards
for select using (true);

create policy "public_read_listings" on public.listings
for select using (true);

create policy "public_read_price_history" on public.price_history
for select using (true);

create policy "public_read_scrape_runs" on public.scrape_runs
for select using (true);

-- No insert/update/delete policies on purpose.
-- Use the Service Role key for server-side writes.
