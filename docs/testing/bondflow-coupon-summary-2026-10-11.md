# BondFlow coupon summary — 2026-10-11

## Область

Первый этап [нового ТЗ](../requirements/KASE_BondFlow_TZ.md) выполнен на основе `8368d68`: domain/API read-only summary, RU/EN представление и QA. [Аудит и следующий scope](../features/bondflow-implementation-plan.md). Изменение не меняет payout amounts, persisted inputs, formula version, schema, canonical receipts или Rust программу.

## Проверки

| Проверка | Фактический результат |
| --- | --- |
| `npm run check` | PASS: scaffold 34 paths, Markdown links/fences 107 files, Prisma schema, typechecks всех workspaces и 410 tests (API 166, web 113, domain 30, Solana client 54, root 47); failed/skipped 0 |
| Финальные API regression tests после review: `npm run test --workspace @lifecycle-kase/api` | PASS 168/168, failed/skipped 0; два дополнительных теста mixed zero/positive и сохранения gross entitlement после hold/settlement |
| `npm run build` | PASS API, production Next.js web, domain и Solana client |
| `git diff --check` | PASS |
| Independent source review | Блокирующих замечаний нет; рекомендации по двум дополнительным regression tests реализованы и проверены |
| Browser QA на production build, `127.0.0.1:3020/qa` | English desktop 1440×1000 и Russian mobile 390×844: начислено/theoretical 1750 KZT-Test, residual 0, policy/tax тексты видны; document/client width 1425/1425 и 375/375, page-wide overflow отсутствует |
| Keyboard refresh | Enter на «Обновить начисления» сохранил результат и показал успешное обновление без повторной финансовой операции |
| Browser error/warn log | Пустой в проверенном QA-сценарии |

Итог актуального набора после двух дополнительных API tests: **412 tests** (168 + 113 + 30 + 54 + 47). Общий `check` прошёл перед добавлением этих двух tests; затем весь API suite был повторён, остальные исходники не менялись. Это 412 уникальных tests, а не сумма повторных запусков.

Проверены: canonical 10/20/5, остаток более одной минимальной единицы, смешанные 0/1 начисления, отсутствие расчёта, corrupted amount/inputs/snapshot metadata/coverage/totals, drift текущих instrument terms, блокировка кошелька и уже исполненные gross rows, precision выше Number-safe range, RU/EN exact rational formatting и совместимость с API без нового optional metadata. При отсутствии summary интерфейс не выдумывает theoretical/residual totals. Ненулевой дробный residual проверен автоматическими тестами; browser fixture этой итерации имеет residual 0.

Локальная production QA запускалась отдельно только для браузерной проверки и остановлена после неё. Temporary browser tab закрыта, viewport override сброшен. Сохранённые screenshots показывают синтетические QA-данные:

- [Desktop English](evidence/bondflow-2026-10-11/coupon-desktop-en.jpg)
- [Mobile Russian](evidence/bondflow-2026-10-11/coupon-mobile-ru.jpg)

Изменения сохранены локально. Commit/push/deployment не выполнялись.

## Ограничения

Этот этап не закрывает enforceable record-date, exact-target partial redemption, Devnet execution, worker orchestration или full operator wizard. Fresh wallet/Solana/HTTP-PostgreSQL execution не требуется для derived metadata и не заявляется. Owner ledger, программа, wallets и deployments не изменялись.
