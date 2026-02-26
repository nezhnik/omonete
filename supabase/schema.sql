-- Таблица коллекции монет пользователя (портфолио).
-- user_id берётся из Supabase Auth, coin_id — id из каталога (/data/coins/[id].json).
-- Выполнить в Supabase: SQL Editor → New query → вставить этот файл → Run.

create table if not exists public.user_collection (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null,
  added_at timestamptz default now(),
  unique(user_id, coin_id)
);

create index if not exists user_collection_user_id on public.user_collection(user_id);

alter table public.user_collection enable row level security;

-- Политики: пользователь видит и меняет только свои записи
drop policy if exists "Users can read own collection" on public.user_collection;
create policy "Users can read own collection"
  on public.user_collection for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own collection" on public.user_collection;
create policy "Users can insert own collection"
  on public.user_collection for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own collection" on public.user_collection;
create policy "Users can delete own collection"
  on public.user_collection for delete
  using (auth.uid() = user_id);
