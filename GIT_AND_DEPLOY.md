# Git и деплой: версии и ветки

Краткий гайд по работе с репозиторием и выкладке на сервер.

---

## Ветки

| Ветка      | Назначение |
|------------|------------|
| **main**   | Продакшен. Сюда попадает только проверенный код. С этой ветки деплоим на сервер. |
| **develop**| Разработка. Текущая «собираемая» версия. Фичи мержим сюда. |
| **feature/название** | Отдельная фича или правка. Ветка от develop, после готовности — merge в develop. |

Правило: в **main** не коммитим с руки. В main попадает только через merge из develop (или через release).

---

## Ежедневный цикл

1. **Начало работы**  
   Переключиться на develop и подтянуть изменения:
   ```bash
   git checkout develop
   git pull
   ```

2. **Новая фича/правка**  
   Создать ветку от develop:
   ```bash
   git checkout -b feature/название-фичи
   ```
   Работать в этой ветке, коммитить по мере готовности.

3. **Фича готова**  
   Переключиться на develop, влить ветку и удалить её:
   ```bash
   git checkout develop
   git merge feature/название-фичи
   git branch -d feature/название-фичи
   ```

4. **Деплой на прод**  
   Когда develop стабилен, переносим в main и деплоим:
   ```bash
   git checkout main
   git merge develop
   git push origin main
   ```
   Дальше на сервере: pull из main и перезапуск приложения (как у вас в DEPLOY_REG_RU.md).

---

## Версии (теги)

Для «релизов» удобно ставить тег на main после merge:
```bash
git tag -a v1.0.0 -m "Релиз: графики металлов, портфолио с ценой металла"
git push origin v1.0.0
```
Так в истории видно, какая версия когда вышла, и при необходимости можно откатиться к тегу.

---

## Первоначальная настройка (один раз)

### 1. Добавить весь проект в Git и первый коммит

Убедитесь, что в корне проекта (omonete-app):
```bash
git status
```
Если много untracked — добавить нужное (не добавлять секреты, большие бинарники, лишние бэкапы):
```bash
git add app components lib public scripts docs supabase
git add package.json package-lock.json next.config.ts tsconfig.json .gitignore
git add *.md
# Не добавлять: .env*, node_modules, .next, out, большие xlsx и т.п.
git status   # проверить список
git commit -m "Проект: каталог, графики, портфолио, API цен ЦБ"
```

### 2. Создать ветку develop

```bash
git branch develop
git checkout develop
# или: git checkout -b develop
```

### 3. Настроить remote (если храните код на GitHub/GitLab/другом сервере)

```bash
git remote add origin https://github.com/ВАШ_ЛОГИН/omonete-app.git
git push -u origin main
git push -u origin develop
```

Если деплой идёт с того же сервера, где крутится сайт, remote может быть репозиторий на этом сервере (по SSH или по HTTPS).

### 4. Деплой на сервер

На сервере в папке проекта:
```bash
git fetch origin
git checkout main
git pull origin main
npm ci
npm run build
# перезапуск приложения (pm2 restart, systemctl, или как у вас)
```

Деплой всегда с ветки **main**.

---

## Что не коммитить

- Файлы с паролями и ключами (`.env`, `.env.local`) — уже в `.gitignore`.
- `node_modules`, `.next`, `out` — тоже в ignore.
- Большие xlsx/бэкапы по желанию оставить только локально или вынести в отдельное хранилище.

---

## Итог

- **main** — только стабильный код, с него деплой.
- **develop** — текущая разработка; фичи мержим сюда.
- **feature/*** — отдельные задачи; после готовности merge в develop.
- Теги на main — для версий (v1.0.0 и т.д.).
- На сервере всегда `git pull origin main` и пересборка/рестарт.

Так у вас будут и версии, и ветки, и предсказуемый процесс деплоя.
