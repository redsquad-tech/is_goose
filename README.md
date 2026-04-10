# is_goose

Standalone desktop-проект Goose на Electron/React.

Основной runtime-бэкенд `goosed` живёт в отдельном репозитории `redsquad-tech/is_goosed`. Для локальной разработки можно подключаться к уже запущенному внешнему серверу, а Windows bundle / MSI собираются с вложенным `goosed.exe`, скачанным из GitHub Releases backend-репозитория.

## Что нужно заранее

- внешний `goosed`, уже запущенный отдельно
- `node` 24.x
- `npm` 11.x

Проверенные значения:

- `node`: `24.10.0`
- `npm`: `11.6.1`

## Установка с нуля

```bash
npm install
```

## Запуск против внешнего goosed

Для локального сервера на `https://127.0.0.1:3000`:

```bash
GOOSE_EXTERNAL_BACKEND=true \
GOOSE_PORT=3000 \
GOOSE_SERVER__SECRET_KEY=qwerty \
npm run start-gui
```

Что делают переменные:

- `GOOSE_EXTERNAL_BACKEND=true` отключает запуск встроенного backend
- `GOOSE_PORT=3000` направляет desktop на `https://127.0.0.1:3000`
- `GOOSE_SERVER__SECRET_KEY` должен совпадать с секретом вашего `goosed`

Запуск в debug-режиме:

```bash
GOOSE_EXTERNAL_BACKEND=true \
GOOSE_PORT=3000 \
GOOSE_SERVER__SECRET_KEY=qwerty \
npm run start-gui-debug
```

## Windows bundle / MSI

Для CI используется workflow [`bundle-desktop-windows.yml`](.github/workflows/bundle-desktop-windows.yml), локально команда такая:

```bash
npm run bundle:windows
```

Workflow Windows-сборки:

- скачивает `goosed-windows-x86_64.zip` из release репозитория `redsquad-tech/is_goosed`
- распаковывает `goosed.exe` в `src/bin`
- собирает `ddg-search.exe` через Go и кладёт его в `src/bin`
- собирает bundled Python 3.12 runtime в `src/bin/python-runtime`
- устанавливает `crawl4ai==0.8.6` в этот runtime
- скачивает браузерные бинарники Playwright/Patchright в `src/bin/ms-playwright`
- добавляет Windows wrapper `crwl.cmd` в `src/bin` для запуска `crawl4ai` через bundled `python.exe`
- собирает portable zip и `msi`

Эти CLI-бинарники едут в `resources/bin` рядом с `goosed.exe`, поэтому встроенный backend может вызывать:

- `ddg-search.exe` для `search_web`
- `crwl.cmd` для `read_web_page`

Версия backend выбирается так:

- если при ручном запуске workflow передан `goosed_version`, используется он
- иначе, если задан repository variable `GOOSED_VERSION`, используется он
- иначе workflow берёт **latest release tag** из репозитория `redsquad-tech/is_goosed`

Если `redsquad-tech/is_goosed` приватный, в репозитории `is_goose` нужен GitHub Actions secret `IS_GOOSED_RELEASE_TOKEN` с доступом на чтение релизов/contents backend-репозитория.

Локальный dev-запуск по-прежнему можно делать против внешнего backend:

- через env `GOOSE_EXTERNAL_BACKEND`, `GOOSE_PORT`, `GOOSE_SERVER__SECRET_KEY`


## Если сервер не на localhost

Env-переменная `GOOSE_PORT` работает только для `127.0.0.1`, поэтому текущий dev-сценарий с внешним backend рассчитан на локальный сервер или SSH-port-forwarding до localhost.

## Важная особенность

В этом проекте создание новой сессии захардкожено со scope:

```ts
['croc_test_260325']
```

Это сделано в [`src/sessions.ts`](src/sessions.ts).
