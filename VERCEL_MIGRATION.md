# Переезд на Vercel — пошагово

Пошаговый план: от текущего состояния до работающего сайта на Vercel.

---

## Шаг 1. Сохранить всё в Git (локально)

В папке `omonete-app` выполни:

```bash
cd "/Users/mihail/Desktop/Нумизматика сайт/omonete-app"

# Добавить нужные файлы (без секретов и тяжёлых xlsx, если не нужны в репо)
git add app components lib public scripts supabase docs
git add package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs tailwind.config.ts
git add .gitignore .env.example
git add *.md

# Проверить список (не должно быть .env, .env.local, node_modules)
git status

# Закоммитить
git commit -m "Проект: каталог, графики, портфолио, API цен ЦБ, подготовка к Vercel"
```

**Важно:** Папки **`public/data`** и **`public/image`** должны быть в репозитории — на Vercel мы не запускаем скрипты экспорта из MySQL (нет доступа к БД), поэтому каталог монет и картинки берутся из того, что закоммичено. Если `public/data` или `public/image` в .gitignore — убери их оттуда для этого проекта или добавь вручную.

---

## Шаг 2. GitHub — репозиторий и первый push

1. Зайди на [github.com](https://github.com), залогинься или зарегистрируйся.
2. **New repository**: имя, например `omonete-app`, приватный или публичный — на твой выбор.
3. **Не** создавай README / .gitignore в репозитории (у тебя уже есть).
4. В терминале в папке `omonete-app`:

```bash
git remote add origin https://github.com/ТВОЙ_ЛОГИН/omonete-app.git
git branch -M main
git push -u origin main
```

Если репозиторий уже был привязан (`git remote -v` показывает origin), просто:

```bash
git push -u origin main
```

---

## Шаг 3. Vercel — аккаунт и импорт проекта

1. Зайди на [vercel.com](https://vercel.com), войди через **GitHub** (Sign in with GitHub).
2. **Add New…** → **Project**.
3. Выбери репозиторий **omonete-app** (если не видно — нажми **Configure GitHub** и дай доступ к репозиторию).
4. **Import**:
   - **Framework Preset**: Next.js (определится сам).
   - **Root Directory**: оставь пустым (корень репо = корень проекта).
   - **Build Command**: обязательно смени на **`next build`** (без скриптов `data:rectangular` и `data:export` — они требуют MySQL и нужны только при локальной сборке). Данные каталога уже лежат в `public/data` и `public/image` в репозитории.
   - **Output Directory**: не трогай.
5. **Environment Variables** — добавь (можно сразу при импорте или в Settings → Environment Variables после создания проекта):

| Name | Value | Где взять |
|------|--------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbG...` | там же |

Переменная `DATABASE_URL` для Vercel **не нужна** — она используется только локально в скриптах (экспорт монет и т.д.). Графики работают через API ЦБ без ключей.

6. Нажми **Deploy**. Дождись окончания сборки.

---

## Шаг 4. Проверка на домене Vercel

1. После деплоя открой ссылку вида `omonete-app-xxx.vercel.app`.
2. Проверь:
   - главная, каталог, монетные дворы;
   - **Графики** (/charts/) — загрузка данных ЦБ;
   - **Портфолио** (/portfolio/) — виден таб, вход через Supabase;
   - карточка монеты, авторизация, добавление в коллекцию.
3. Если что-то падает — смотри **Vercel → Project → Deployments → последний деплой → Logs / Functions**.

---

## Шаг 5. Подключить свой домен omonete.ru

1. В Vercel: **Project → Settings → Domains**.
2. Добавь домен: `omonete.ru` и при желании `www.omonete.ru`.
3. Vercel покажет, что прописать в DNS (A-запись или CNAME, либо смену NS).
4. В панели управления доменом (Reg.ru или где куплен домен):
   - либо смени **NS** на те, что даст Vercel;
   - либо создай **A-запись** для `omonete.ru` на IP Vercel (или CNAME для `www` — как подскажет Vercel).
5. Подожди 5–60 минут (иногда до 24 ч). В Vercel статус домена станет «Valid».

После этого весь трафик на omonete.ru пойдёт на Vercel. Файлы на Reg.ru останутся на диске, но сайт оттуда уже не отдаётся.

---

## Шаг 6. (По желанию) Регулярные обновления

- Вносишь изменения локально → коммит → `git push origin main`.
- Vercel сам сделает новый деплой. Либо настроить деплой из ветки `develop` (в Vercel → Settings → Git можно выбрать ветку для Production).

---

## Краткий чеклист

- [ ] Шаг 1: Git add + commit в `omonete-app`
- [ ] Шаг 2: Репозиторий на GitHub, push
- [ ] Шаг 3: Vercel — импорт проекта, env-переменные Supabase, Deploy
- [ ] Шаг 4: Проверка на *.vercel.app
- [ ] Шаг 5: Домен omonete.ru в Vercel, правки DNS
- [ ] Готово: сайт на Vercel, Reg.ru только как регистратор домена (файлы на хостинге можно не трогать или потом удалить)
