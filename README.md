# is_goose

Минимальный standalone-проект desktop-приложения Goose для подключения к уже запущенному внешнему `goosed`.

В проекте нет Rust-бэкенда и нет CLI. Здесь только Electron/React desktop app.

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

## Windows bundle

Windows bundle собирает только desktop-клиент. Внутрь пакета не вкладывается `goosed.exe`.

Для CI используется workflow [`bundle-desktop-windows.yml`](.github/workflows/bundle-desktop-windows.yml), локально команда такая:

```bash
npm run bundle:windows
```

Собранный клиент нужно запускать только против внешнего backend:

- либо через env `GOOSE_EXTERNAL_BACKEND`, `GOOSE_PORT`, `GOOSE_SERVER__SECRET_KEY`
- либо через настройки `Use external server`

## Если сервер не на localhost

Env-переменная `GOOSE_PORT` работает только для `127.0.0.1`.

Если сервер на другом хосте:

1. запустите приложение
2. откройте `Settings`
3. перейдите на вкладку `Session`
4. в блоке `Goose Server` включите `Use external server`
5. укажите полный URL и `Secret Key`
6. перезапустите приложение

## Важная особенность

В этом проекте создание новой сессии захардкожено со scope:

```ts
['croc_test_260325']
```

Это сделано в [`src/sessions.ts`](src/sessions.ts).
