-- Nexus 2.0 — Supabase setup (run once in Supabase → SQL Editor).
-- All app data lives in one document table; each row is one record of one collection
-- (orders, dispatches, users, roles, customers, items, processes, audit, settings).

create table if not exists public.nx_docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists nx_docs_updated_idx on public.nx_docs (updated_at desc);

alter table public.nx_docs enable row level security;

-- Only signed-in users (Supabase Auth) can read or write. The anon key alone gets nothing.
drop policy if exists "nx read"  on public.nx_docs;
drop policy if exists "nx write" on public.nx_docs;
drop policy if exists "nx update" on public.nx_docs;
drop policy if exists "nx delete" on public.nx_docs;
create policy "nx read"   on public.nx_docs for select to authenticated using (true);
create policy "nx write"  on public.nx_docs for insert to authenticated with check (true);
create policy "nx update" on public.nx_docs for update to authenticated using (true) with check (true);
-- Audit rows can never be deleted from the app.
create policy "nx delete" on public.nx_docs for delete to authenticated using (collection <> 'audit');

-- Live updates to every open screen.
do $$ begin
  alter publication supabase_realtime add table public.nx_docs;
exception when duplicate_object then null; end $$;
