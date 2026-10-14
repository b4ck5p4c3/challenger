# challenger

Scanner software for Shuttle+ SG15

### HowTo

```shell
# ∠( ᐛ 」∠)_
pnpm install
pnpm --dir frontend install
# 〜〜(／￣▽)／　〜ф
bunx prisma generate
bunx prisma db push
# _(:3 」∠)_
cat >.env <<'EOF'
DATABASE_URL="postgresql://..."
WEB_SERVER_PORT="8080"
FRONTEND_DIR="frontend/dist"
SHUTTLE_SERVER_PORT="1337"

SHUTTLE_CLIENT_HOST="192.168.1.42"
SHUTTLE_CLIENT_PORT="1337"
EOF
# :3c
bun run start
```

`FRONTEND_DIR` points to the built frontend directory. Relative paths are resolved from the project root; absolute paths are also supported.
If it is omitted, the default value is `public`. Use `bun run start -vvv` to print raw Shuttle scan diagnostics.

## Development

### ~~living~~ existing here

- backend на TypeScript;
- PostgreSQL через Prisma;
- Shuttle+ SG15 via TCP;
- web-scanner;
- CRPT & EDADEAL api grabbers;
- React/Vite frontend;

### structure

```text
src/
  api/
    crpt.ts            API ЧестногоЗнака/CRPT
    edadeal.ts         необязательное описание товара
  application/
    scan-service.ts    основная логика регистрации банки
  domain/
    scanning.ts        типы входа, результаты и парсер кодов
  shuttle/
    adapter.ts         TCP-вход, сканирование и вывод на Shuttle
    protocol.ts        низкоуровневый TCP-протокол Shuttle
  main.ts              сборка процесса, Express и Prisma

frontend/src/
  pages/scanner.tsx    камера и ручной ввод
  pages/items.tsx      карточки продуктов
  pages/history.tsx    учтённые банки
  pages/codes.tsx      GTIN
  pages/record.tsx     просмотр отдельной записи
  utils/api.ts         HTTP-клиент

prisma/schema.prisma  Product, ProductCode, ScanUnit
```

### db

```text
Product
  карточка продукта: бренд, название, объём, алкоголь, кофеин

ProductCode
  один GTIN длиной 8, 12, 13 или 14 цифр
  необязательная связь с Product
  кэш CRPT и Edadeal

ScanUnit
  одна конкретная банка
  обязательная связь с ProductCode
  полный код и ответ ЧестногоЗнака
```

## sequences

### EAN13

```text
EAN13
  -> GTIN
  -> найти или создать ProductCode
  -> при первом появлении попробовать CRPT и Edadeal
  -> сохранить ScanUnit без Product, если GTIN ещё не привязан
  -> всегда создать новую ScanUnit
  -> попросить сканировать ЧестныйЗнак
```

### ЧестныйЗнак

```text
ЧестныйЗнак
  -> проверить минимальную обязательную структуру
    [01 + 14 цифр GTIN + 21 + serial + FNC1] + оставшаяся GS1-часть (не проверяется)
  -> локально извлечь GTIN
  -> найти или создать ProductCode
  -> попробовать получить обогащение CRPT
  -> найти последнюю ScanUnit без ЧестногоЗнака младше пяти минут
  -> дополнить её или создать новую
```

### API

```text
POST /api/scans
GET  /api/products
POST /api/products
GET  /api/products/:id
PATCH /api/products/:id
GET  /api/product-codes
GET  /api/product-codes/:id
PATCH /api/product-codes/:id
GET  /api/scan-units?page=1
GET  /api/scan-units/:id
DELETE /api/scan-units/:id
GET  /api/stats
```

web-scan example:

```json
{
  "adapterId": "web-camera",
  "codeType": "ean13",
  "rawCode": "4601234567890"
}
```
