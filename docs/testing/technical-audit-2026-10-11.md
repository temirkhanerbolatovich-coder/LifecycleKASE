# Технический аудит — 2026-10-11

## Область и границы

Проверены текущие API controllers, authentication/authorization, instrument/action/snapshot workflows, integer calculations, Solana builders/decoders, Anchor instructions, Prisma schema/migrations, конфигурация, CI и связанные документы. Основа репозитория: `eb7a602`, ветка `codex/full-project-audit-20261010`; существующие незакоммиченные UI/QA изменения сохранены и вошли в Node-проверки. Application code, owner ledger, wallet, программа и deployment этим аудитом не изменялись.

Текущий source содержит атомарное исполнение coupon, early redemption и maturity redemption, reconciliation и receipts. Изолированная runtime-приёмка трёх действий от 2026-10-10 остаётся датированным доказательством в [записи приёмки](kase-three-actions-2026-10-10.md). Она не заменяет сохранённую owner-среду или public network. Отсутствие повторного runtime-теста сегодня не является обнаруженным отказом финансового кода.

## Проверки, выполненные сегодня

| Проверка | Результат |
| --- | --- |
| `npm test` | PASS: 330 tests; API 126, web 76, domain 27, Solana client 54, root 47; failures/skipped 0. Web включает 10 новых QA-model tests. |
| `npm run typecheck` | PASS всех workspaces. |
| `npm run build` | PASS API/web/domain/client; web содержит `/`, `/dashboard`, `/health/live`, `/qa`. |
| `npm run test:web:proxy` | PASS production Origin/body/cookie transport, фиксированные routes и unknown-route isolation; harness использует отдельную копию web. |
| `npm run validate` | PASS 34 required paths; Markdown links/fences 91 файлов на момент запуска; повторная link/fence проверка после audit-документов PASS 95 файлов. |
| `npm run prisma:validate` | PASS schema. Это не запуск миграций или проверка сохранённых rows. |
| `npm audit --omit=dev` и полный `npm audit --json` | Root deployed и полный root graph: 0 vulnerabilities; обе команды audit exit 0. |
| `npm audit --omit=dev --prefix tools/solana-integration --json` | Exit 1: 12 vulnerable packages, 5 high / 7 moderate / 0 critical; отдельный legacy integration graph. Автоматические major/downgrade fixes не применялись. |
| `cargo +1.98.1 test -p lifecycle_kase --locked` в WSL Ubuntu | PASS 18 tests, doc tests 0. |
| Та же команда с `--features devnet` | PASS 18 tests. Это второй профиль тех же тестов, а не 36 уникальных tests. |
| `cargo +1.98.1 fmt --all -- --check` | PASS. |
| Clippy default и Devnet: `--all-targets --locked -- -D warnings` | PASS обоих профилей. |
| `git diff --check` | PASS на момент проверки. |
| `docker compose config --quiet` | PASS конфигурации; Docker daemon не требуется для этого результата. |
| Два диагностических probes | Stale revoked-wallet session принят production auth function; integer mixed coupon `0/1` и Anchor status mismatch подтверждены. Probes не входят в 330 Node или 18 program tests. |

Docker Desktop Linux daemon недоступен: pipe `dockerDesktopLinuxEngine` отсутствует. Disposable PostgreSQL/HTTP suites, fresh SBF build и `demo:verify` с отдельным validator/DB сегодня не повторялись. Owner-среда не запускалась и не изменялась. Датированные database/SBF/runtime результаты сохраняются в [аудите 2026-10-10](../PROJECT_AUDIT_2026-10-10.md).

## Подтверждённые дефекты

### P2 — Отзыв operator wallet не инвалидирует уже выданную сессию

[auth.ts](../../apps/api/src/auth.ts), строки 286–304: `readOperatorSession` читает session/user, проверяет expiry, session revocation и текущую роль, но не перечитывает wallet status, verification, revocation или принадлежность тому же User. [Controller actor gate](../../apps/api/src/corporate-action.controller.ts), строки 31–42, доверяет этому результату. Аналогичный gate используется реестрами и журналами.

Production-function probe с синтетическими in-memory adapters: непросроченная Administrator cookie, underlying wallet `REVOKED`, `revokedAt` установлен; вызов принят и wallet queries = 0. Поэтому блокировка/отзыв/удаление operator wallet отдельно от session revocation оставляет reads и разрешённые actor operations доступными до session expiry. Это не обход wallet signature: новые on-chain сообщения по-прежнему требуют подпись. Сейчас интерфейс не предоставляет полноценное управление operator lifecycle, но access rule следует закрыть до его добавления или внешней эксплуатации.

Минимальное исправление: в общем session gate проверять актуальное соответствие address → User и ACTIVE/verified/not-revoked wallet, либо гарантировать атомарный revoke всех связанных sessions при каждом lifecycle transition и запретить иной путь. Regression cases: BLOCKED, REVOKED, deleted/reassigned wallet; действующая active wallet; отдельная session revocation.

### P2 — Coupon с частью начислений, округлённых в ноль, расходится между API и Anchor

[entitlements.ts](../../apps/api/src/entitlements.ts), строки 104–114 и 194–198, помечает **любой** zero cash amount как `NOT_ELIGIBLE_ZERO_ROUNDING`. [onchain-entitlements.ts](../../apps/api/src/onchain-entitlements.ts), строки 140–143, отправляет `eligible: true`; строки 255–262 требуют тот же zero-rounding status при finalized projection. [Anchor checked_status](../../programs/lifecycle_kase/src/entitlement.rs), строки 157–162, возвращает этот status только для EarlyRedemption с zero tokens; zero coupon возвращает `Ready`.

Поддерживаемый mixed пример: face value = 1 minor unit, rate = 1 bps, frequency = 1, investor balances = 1 и 10000. Production domain даёт coupon amounts = 0 и 1. У действия существует положительное обязательство, но регистрация zero row создаёт Anchor `Ready`, тогда как confirmation ожидает `NOT_ELIGIBLE_ZERO_ROUNDING` и возвращает `ENTITLEMENT_ACCOUNT_MISMATCH`; downstream approval также проверяет этот статус.

Host-only диагностический тест в отдельной ignored source copy `.local-technical-probe-20261011` подтвердил фактический Anchor status `Ready`. Оригинальные `.rs` файлы и owner SBF artifacts не редактировались. Программа не запускалась на owner validator. Existing Rust zero-rounding test проверяет EarlyRedemption; mixed-zero coupon coverage отсутствует.

Минимальное исправление: согласовать zero coupon semantics в domain/API/program/decoders без изменения финансовых формул. Добавить regression для mixed positive/zero coupon через registration → approval → payouts → receipt и явную политику полностью нулевого действия. Любое изменение программы требует нового isolated SBF/runtime acceptance и отдельного owner rollout.

## Реализованные защитные границы

- Purpose/domain/Origin-bound Ed25519 challenge, одноразовый nonce, hashed session/nonce, HttpOnly/SameSite cookies, expiry/revocation и fail-closed disabled authentication.
- Server-side role/Origin/input validation; mutation rate limits; fixed-origin web proxy allowlist. Administrator writes/Auditor reads реализованы; остальные operator roles пока не дают полного рабочего маршрута.
- Genesis/program/signer binding, сохранённые exact messages, cryptographic signed-wire verification, finalized transaction comparison и account/token delta read-back. Ambiguous/signed attempts сохраняют исходную signature и confirmation-only recovery.
- Immutable finalized snapshots/calculations/receipts, versions/unique attempts, serializable workflow projection и audit rollback.
- Separate on-chain approver, per-action PDA custody reserve, atomic payment/burn/receipt и replay guard существуют в candidate source. Funding, approval и execution — отдельные этапы.
- Upgrade defaults off; loopback Localnet listener, pinned reviewed manifest/artifacts, durable database business-write lock и раздельные EXTEND/UPGRADE phases. Direct wallet/CLI writers этот lock не исключает.
- Settlement/approval/redemption capabilities default off; Localnet-only execution gate. Root npm dependency graph не включает legacy integration dependencies.

## Оставшиеся технические реализации и acceptance

| Приоритет | Работа | Почему это остаётся |
| --- | --- | --- |
| До внешней эксплуатации | Исправить два подтверждённых дефекта выше | Wallet lifecycle access и coupon rounding должны иметь единый проверенный контракт. |
| До заявления owner acceptance | Review/install current candidate, отдельный approver, разрешение старых signatures и wallet acceptance трёх действий | Source/disposable proof не устанавливает новую owner программу. Здесь требуются wallet-controlled действия владельца. |
| Следующий product slice | Полная матрица Issuer Operator / Compliance / Approver / Auditor и issuer-scoped reads | Текущий API разрешает Administrator mutations и Administrator/Auditor глобальные reads. |
| Следующий product slice | Investor edit/correction, suspend/unblock/close и controlled operator lifecycle | Реестр сейчас поддерживает create, wallets, proof/revoke и initial eligibility decision; повторная decision/correction не реализована. |
| Следующий protocol slice | Governed pause/resume, authority/policy rotation и post-approval reserve recovery | Enum/authority fields не являются реализованными инструкциями; текущий release разрешён только до approval. |
| Надёжность | Background missed-window sweep, durable jobs, restart/reindex, unavailable-history/stale-attempt operator recovery | Есть explicit check-window и сохранённые attempts, но нет общего фонового исполнителя или chain indexer. |
| Scale | Paginated commitments/lookup-table review и больше investor/source accounts | Logical 64 investors и 8 redemption sources не гарантируют fit одного Solana packet; ограничения явно описаны и serializer блокирует oversized wire. |
| Public-network gate | Reviewed public deployment и fresh wallet/runtime acceptance | API settlement defaults Localnet-only; Devnet build/identity tests не являются public execution proof. |
| Production operations | Shared rate limits, durable storage/backups/restore drill, metrics/p95, monitoring supervision | Process-local limits и Render application staging с disposable DB не закрывают эти эксплуатационные требования. |
| Delivery hygiene | JS lint/format, SBF/validator CI и замена/обновление legacy integration graph | Host Rust and Node CI существуют; fresh validator/SBF остаётся отдельным harness gate. |
| Integrations | Исторический record-date или enforceable cutoff, real KYC/cash/KASE/CSD и transfer policy | Snapshot authority trusted; ordinary transfers unrestricted; KZT-Test/eligibility synthetic. Это отдельный scope, а не обещанная production capability. |

Historical record-date reconstruction, governance recovery и реальные интеграции не следует добавлять перед submission без отдельного согласования scope. Для заявки нужно честно показать текущие три действия на isolated Localnet, размеры demo, cutoff, synthetic assets и owner/public-network границы.
