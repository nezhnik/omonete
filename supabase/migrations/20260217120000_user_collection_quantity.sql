-- Количество монет в коллекции. Для уже созданной таблицы без quantity.
-- Запуск: Supabase → SQL Editor → вставить и Run.

alter table public.user_collection
  add column if not exists quantity integer not null default 1;

alter table public.user_collection
  drop constraint if exists user_collection_quantity_check;

alter table public.user_collection
  add constraint user_collection_quantity_check
  check (quantity >= 1 and quantity <= 99999);

drop policy if exists "Users can update own collection" on public.user_collection;
create policy "Users can update own collection"
  on public.user_collection for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
