-- PPL Coach: one table holds everything, one row per record, private per user.
create table if not exists public.ppl_records (
  user_id   uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  kind      text   not null check (kind in ('session', 'bw', 'kv')),
  key       text   not null,
  body      jsonb  not null,
  at        bigint not null,              -- when the record last changed (ms since 1970)
  primary key (user_id, kind, key)
);

alter table public.ppl_records enable row level security;

-- Each signed-in user can only see and change their own rows.
drop policy if exists "own rows: read"   on public.ppl_records;
drop policy if exists "own rows: insert" on public.ppl_records;
drop policy if exists "own rows: update" on public.ppl_records;
drop policy if exists "own rows: delete" on public.ppl_records;
create policy "own rows: read"   on public.ppl_records for select using (auth.uid() = user_id);
create policy "own rows: insert" on public.ppl_records for insert with check (auth.uid() = user_id);
create policy "own rows: update" on public.ppl_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows: delete" on public.ppl_records for delete using (auth.uid() = user_id);
