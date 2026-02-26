# Что нужно для своей БД в Supabase

## 1. Аккаунт и проект

1. Зайти на [supabase.com](https://supabase.com) → **Start your project**.
2. Войти через GitHub или зарегистрироваться по email.
3. **New project**: выбрать организацию, задать имя проекта (например `omonete`), пароль к БД (сохранить), регион (например Frankfurt). Создать проект — поднимется БД Postgres и Auth.

После создания будут доступны:
- **Dashboard** проекта: таблицы, Auth, SQL, настройки.
- **Project URL** и **anon key** (API keys) — они понадобятся фронту для подключения.

---

## 2. Пользователи (регистрация / вход)

**Отдельную таблицу `users` создавать не нужно** — Supabase Auth уже хранит пользователей (email, хеш пароля, id).

- В проекте: **Authentication** → **Providers** → **Email** включён по умолчанию.
- При желании: **Authentication** → **URL Configuration** — указать Site URL (ваш домен, например `https://omonete.ru`) и Redirect URLs для после логина/регистрации.

Регистрация и вход на сайте будут через JS: `supabase.auth.signUp()`, `supabase.auth.signInWithPassword()`, `supabase.auth.getUser()`.

---

## 3. Таблица для коллекции (портфолио)

Нужна **одна таблица** — какие монеты пользователь добавил в коллекцию.

В **SQL Editor** выполнить:

```sql
-- Таблица коллекции: user_id из Auth, coin_id из вашего каталога
create table public.user_collection (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  coin_id text not null,
  added_at timestamptz default now(),
  unique(user_id, coin_id)
);

-- Индекс для быстрой выборки "все монеты пользователя"
create index user_collection_user_id on public.user_collection(user_id);

-- RLS: пользователь видит и меняет только свои записи
alter table public.user_collection enable row level security;

create policy "Users can read own collection"
  on public.user_collection for select
  using (auth.uid() = user_id);

create policy "Users can insert own collection"
  on public.user_collection for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own collection"
  on public.user_collection for delete
  using (auth.uid() = user_id);
```

Итог:
- **user_id** — id из Supabase Auth (автоматически подставляется из текущей сессии).
- **coin_id** — строка id монеты из вашего каталога (например `"4000"`, `"3213-0005-ММД"`).
- Один пользователь не может добавить одну и ту же монету дважды (`unique(user_id, coin_id)`).
- RLS (Row Level Security) — пользователь видит и изменяет только свои строки.

---

## 4. Что понадобится в коде сайта

1. **Подключить Supabase JS** в проект:
   ```bash
   npm install @supabase/supabase-js
   ```

2. **Переменные окружения** (в `.env.local` для разработки, на билде/деплое — в настройках окружения):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
   ```
   URL и anon key взять в Supabase: **Project Settings** → **API**.

3. **Клиент Supabase** (один раз создать и использовать):
   - Инициализация с `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Auth: `signUp`, `signInWithPassword`, `getUser`, `signOut`.
   - Коллекция: `from('user_collection').select('coin_id').eq('user_id', userId)`, `insert({ user_id, coin_id })`, `delete().eq('user_id', userId).eq('coin_id', coinId)`.

Данные монет (название, картинка и т.д.) по-прежнему брать из вашего каталога (`/data/coins/[id].json`), из Supabase — только список `coin_id` для текущего пользователя.

---

## 5. Чек-лист

| Шаг | Где | Действие |
|-----|-----|----------|
| 1 | supabase.com | Аккаунт, New project, сохранить пароль БД и ключи API |
| 2 | Dashboard → Authentication | Ничего не создавать для users; при необходимости настроить Site URL |
| 3 | SQL Editor | Выполнить скрипт создания `user_collection` и RLS |
| 4 | Project Settings → API | Скопировать URL и anon key в `.env.local` |
| 5 | Код сайта | Установить `@supabase/supabase-js`, формы логина/регистрации, запросы к `user_collection` и подстановка данных из каталога |

После этого у вас будет своя БД в Supabase (Auth + таблица коллекции), без отдельного сервера и без доп. покупок в рамках бесплатного тарифа.
