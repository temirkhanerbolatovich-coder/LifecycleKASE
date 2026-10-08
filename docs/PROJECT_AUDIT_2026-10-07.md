# LifecycleKASE: аудит и оставшиеся работы — 7 октября 2026

Дата проверки: 2026-10-07, Asia/Qyzylorda (UTC+5). Основа сравнения — [утверждённые продуктовые требования](requirements/PRODUCT_REQUIREMENTS.md), [технические требования](requirements/TECHNICAL_REQUIREMENTS.md), [текущий checklist](deployment/DEVNET_TO_MVP_CHECKLIST.md), код, тесты и доступные live-сервисы.

## Вывод

Работает существенная основа локального MVP: авторизация, первый срез реестра инвесторов, четырёхфазный выпуск, корпоративные действия и snapshot, сохранение расчётов и application review, подготовка/подтверждение финансирования тестового treasury. Полный продукт пока не работает: отсутствуют on-chain entitlement/approval, выплаты инвесторам, атомарное погашение, execution receipts, полная reconciliation и финализация действия.

GitHub соответствует локальному HEAD, но не всему рабочему дереву. Render доступен как staging; актуальные локальные функции там не подтверждены. Основной security gate сейчас красный из-за новой High-уязвимости зависимости. Найден отдельный дефект восстановления неподписанного funding-плана в UI.

В ходе аудита исходный код и существующие owner-записи не изменялись; подписи, выплаты, upgrade, Git push и deploy не выполнялись. Добавлен этот отчёт. Тестовые базы, ключи и валидатор были отдельными временными ресурсами. Исторические документы не переписывались.

## Границы доказательства

- **Текущая проверка кода/тестов** подтверждает поведение локального рабочего дерева, включая незакоммиченные функции.
- **Изолированный HTTP/PostgreSQL/validator** подтверждает автоматизированные сценарии на синтетических данных, а не состояние сохранённого выпуска владельца.
- **Историческая owner-приёмка** записана в runbooks 2–3 октября. Постоянная база и RPC при начале аудита были остановлены; эти факты не переобъявляются текущими.
- **GitHub CI** подтверждает опубликованный SHA на момент запуска; он не проверял текущие незакоммиченные файлы и появившиеся позже advisories.
- **Render health** подтверждает доступность служб и API readiness, а не работоспособность финансового процесса или синхронизацию с Localnet.
- Это инженерный аудит, а не независимый pentest, правовое заключение или аудит mainnet-контракта. Полная история Git на секреты и нагрузочный p95-тест не проверялись.

## Что реализовано и что осталось

| Область | Реализовано / подтверждение | Открытая часть |
|---|---|---|
| Архитектура | Next.js web, NestJS API, Prisma/PostgreSQL, TypeScript domain/Solana client, Anchor/Token-2022 | Полная цепочка settlement ещё не соединена |
| Авторизация | Wallet message proof, одноразовый nonce, hashed sessions, роли Administrator/Auditor, Origin, HttpOnly cookie, no-store, ограничение запросов; HTTP-тесты | Ручные recovery/negative варианты; limiter только в процессе, изоляция нескольких issuer отсутствует |
| Реестр инвесторов | Create/list/pagination, pending wallet, доказательство владения, one-time demo eligibility, terminal reasoned revoke, atomic audit и snapshot-window lock | Search/detail/update/close; управляемая коррекция/suspension eligibility и временная блокировка wallet |
| Инструмент | DRAFT и четыре фазы MINT_SETUP → DISTRIBUTION 10/20/5 → INITIALIZE → ACTIVATE, exact-wire и finalized reconciliation | Остальные ручные отрицательные сценарии; полноценный detail/holders/timeline, pause/resume lifecycle |
| Корпоративные действия | DRAFT/list/detail/audit, все три типа, SCHEDULE/CANCEL, exact signed attempts и recovery | Редактирование устаревших DRAFT, автоматическая фиксация SNAPSHOT_MISSED, UI исключений |
| Snapshot | Finalized holder collection, supply coverage, investor aggregation, canonical snapshot-v2/hash, immutable DB rows и on-chain commitment | Защищённая выгрузка canonical JSON, журнал доступа; некоторые ручные варианты. Точной исторической позиции на более ранний record_at нет: используется DEMO_CAPTURE_SLOT |
| Расчёты | Bigint coupon/maturity/early formulas, сохранённые inputs/versions/reasons, 18 общих Rust/TypeScript vectors | Не являются on-chain entitlements; выплаты отсутствуют |
| Review | Application submit/approve/reject/return, CAS версии, author/approver, immutable audit и gate проверки расчётов/получателей | On-chain registration/finalize_calculation/approve_action; полный settlement/rent/fee budget до approval |
| Coupon funding | Localnet exact-deficit KZT-Test mint в treasury, SOL policy reserve, сохранённая попытка, exact message/signature, finalized token delta и atomic audit | Owner funding ещё требует текущей проверки и подписи; дефект stale unsigned plan в UI. Funding не выполняет выплату |
| Solana-программа | Пять instructions: initialize_instrument, create_corporate_action, activate_instrument, cancel_action, register_snapshot | Семь следующих instructions, entitlement/receipt/redemption PDAs и безопасный upgrade |
| Execution | Модели/правила будущего execution и чистые расчёты | Нет executor/worker, coupon transfer+receipt, payment+burn, устойчивого partial completion/restart/reindex |
| Legs/receipt | Prisma-модели и pure domain reconciliation contract | Нет materialization Cash/Asset Legs из реально исполненных транзакций, MATCHED gate, JSON Action Receipt и on-chain финализации |
| Web | Рабочие панели в /dashboard, контролируемые подписи, текущие ошибки/recovery | Обязательные отдельные investor/instrument/action/review/receipt/transactions/audit routes, evidence и exceptions UI |
| Эксплуатация и CI | Liveness, DB readiness, actor/correlation audit; CI unit/type/build/DB/proxy и host Rust | Отдельный RPC degraded status и требуемые metrics отсутствуют; SBF/validator runtime и secret scan не включены в текущий CI; performance targets и restore не приняты |
| Документация | Requirements, ADR, feature/runbook/status документы | Несколько устаревших формулировок; отсутствуют отдельные security-model/data-flow/testing-strategy, полный clean-setup и конечный demo |

Критическая недостающая цепочка: **snapshot → зарегистрированные on-chain entitlements → on-chain approval → atomic settlement → finalized execution receipt → Cash/Asset reconciliation → final Action Receipt**. Наличие моделей в Prisma и статуса APPROVED в приложении не закрывает эту цепочку.

## Постоянная локальная среда и предыдущая точка

При начале аудита localhost:3000, API 127.0.0.1:4000 и RPC 127.0.0.1:8899 не отвечали. Контейнер `lifecyclekase-postgres-1` остановлен (Exited 255, остановка 4 октября); существующий volume `lifecyclekase_lifecycle_kase_postgres` присутствует. Исходная база не запускалась и не пересоздавалась.

Сохранённый WSL ledger `/home/lifecycle-dev/.local/share/lifecycle-kase/localnet-acceptance-20261002B/ledger` и каталог `ledger-stopped-backup-20261002` присутствуют. Это проверка существования каталогов, а не доказательство целостности/успешного restore. Persistent validator не запускался; текущий genesis, balances и retained transaction history не прочитаны.

Последняя документированная owner-приёмка в [instrument runbook](testing/localnet-instrument-acceptance.md), [action runbook](testing/localnet-action-acceptance.md) и [funding feature](features/coupon-funding.md):

- LKA26R1 ACTIVE, supply 35/35, holder balances 10/20/5; все четыре issuance-фазы прошли Phantom и finalized reconciliation.
- Coupon action `464a832a-2c55-4e22-bb7a-6be93b429c78`, snapshot `6a322373-d411-4e6f-b1b6-149925f5ef08`: точные SCHEDULE/REGISTER_SNAPSHOT сообщения и commitment подтверждены.
- Расчёт 500/1000/250 KZT-Test, всего 1750; action UNDER_REVIEW, version 6.
- Funding attempt `8d955803-adbe-4004-8277-4dd1c5aea73d`: PREPARED, без подписи, 1750000000 minor units; документированные treasury/mint supply равны 0.
- Последний записанный genesis: `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`; program `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo`.

Перед продолжением необходимо проверить эти данные в существующей базе/RPC. Не создавать новый выпуск, не выполнять validator --reset и не повторять неизвестные/подписанные транзакции. Старые LKA26 и missed-window action сохраняются как история; отсутствие retained transaction требует отдельной сверки, а не повторной выдачи mint.

## GitHub и Render

### GitHub

Текущие `git ls-remote` и GitHub API подтвердили `master` и local HEAD на `112bdb14edd04fd0a76f153e627e14ebb857b850`. Последний опубликованный commit — завершение instrument INITIALIZE/ACTIVATE, 2 октября, 13:43:49 UTC+5. Open PR — 0.

Последний [GitHub Actions run 36985707987](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/36985707987) успешен; последние четыре доступных runs также success. Это результаты опубликованной ревизии, а не будущего запуска с текущими advisories.

До создания этого отчёта: **56 modified tracked + 50 untracked entries = 106** по `git status --short`. Добавления corporate actions, entitlements, funding, migration 18, изменения transport/recovery, тесты и документы не опубликованы. Этот отчёт добавляет ещё один untracked файл. Нужны review полного diff, согласованные commits и новая CI-проверка; старый зелёный CI недостаточен.

### Render

Публичная проверка 7 октября:

| Запрос | Результат |
|---|---|
| [API liveness](https://lifecyclekase-api.onrender.com/api/v1/health/live) | 200, live |
| [API readiness](https://lifecyclekase-api.onrender.com/api/v1/health/ready) | 200, ready |
| API auth/session без входа | 401 SESSION_REQUIRED |
| [Web liveness](https://lifecyclekase-web.onrender.com/health/live) | 200 |
| [Web dashboard](https://lifecyclekase-web.onrender.com/dashboard) | 200 |
| Web /api/v1/corporate-actions | 404; текущий локальный proxy/action workflow там не подтверждён |

Первые запросы заняли примерно 33–35 секунд. Это наблюдение отдельных запросов, а не измеренный p95; бесплатный staging не демонстрирует требуемый быстрый startup/dashboard.

Render dashboard перенаправляет в login. **Текущий deployment SHA, полный build log, env и число staging migrations в этом аудите не проверены.** SHA 112bdb1 был подтверждён в dashboard в историческом аудите 2 октября, а не повторно сегодня.

`render.yaml` задаёт две free Node-службы и free PostgreSQL, status-only staging. AUTH_ENABLED в Blueprint по умолчанию false; публичный 401 показывает защиту проверенного route, но не раскрывает весь live env. Из Render нельзя обращаться к owner localhost RPC. После публикации нужны явный профиль staging, env/role/Origin acceptance, миграции и проверка deployed SHA. Перенос Localnet ledger в Render или public Devnet не входит в текущую задачу автоматически.

Независимая backup/restore-проверка staging отсутствует. Эту конфигурацию нельзя принимать как надёжное хранилище финансовых/персональных данных.

## Выявленные дефекты и риски

### 1. High в основной production dependency graph — исправить перед публикацией

`npm audit --omit=dev` завершился exit 1: одна High, Critical 0. Установлен `source-map-js@1.2.1`, используемый транзитивно через PostCSS/Tailwind/Next. [GitHub advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) указывает patched 1.2.2. Advisory обновлён после последнего зелёного GitHub CI.

Advisory описывает event-loop blocking при обработке специально сформированной indexed source map. Доступность этой атаки через публичные routes проекта не доказана. Но текущий lockfile не проходит уже существующий обязательный CI audit gate.

Нужно минимально обновить совместимый dependency graph/lockfile и повторить audit, build и proxy acceptance. Не применять слепой `npm audit fix --force`.

### 2. UI блокирует refresh неподписанного funding-плана при смене версии/дефицита

В [coupon-funding-panel](../apps/web/app/dashboard/coupon-funding-panel.tsx), строки 27–52, `refreshBudget()` пытается восстановить сохранённый plan через `preparedCouponFunding()` до вызова POST prepare. В [coupon-workflow](../apps/web/app/dashboard/coupon-workflow.ts), строка 29, неподписанный plan должен совпасть с текущими actionVersion и deficitMinor.

Если после первоначального PREPARED изменится версия действия (например, application approval) или дефицит treasury, восстановление старого плана бросает ошибку. И prepare(), и send() прерываются до POST обновления. Reload проходит через тот же refresh и проблему не устраняет.

Воспроизведено на реальной функции validation с сериализованным funding wire: исходная версия 6 проходит; текущая версия 7 либо меньший текущий deficit отклоняют старый неподписанный plan. Порядок UI-вызовов подтверждён исходным кодом. Это не проведённая вручную браузерная приёмка и не дефект уже подписанного owner attempt.

Исправление должно разделить чтение свежего budget и восстановление попытки, показывать stale unsigned plan и разрешать безопасную новую подготовку после проверки сервером. Подписанные/неизвестные попытки нельзя заменять или автоматически отправлять повторно. Добавить regression для версии, дефицита, reload и signed recovery.

### 3. Изолированные Solana test-tools: 12 dependency findings

Отдельный `npm audit` в `tools/solana-integration`: 5 High, 7 Moderate, Critical 0. Это отдельный legacy Anchor/web3/SPL test dependency graph, а не основной Render runtime. Нужно проверить достижимость vulnerable paths, совместимость обновлений/замены test clients и отдельно аудитировать этот lockfile в CI. Использовать только disposable keys/validator. Число findings не равно числу независимых публично достижимых атак.

### 4. Application approval пока не выполняет весь обязательный бизнес-gate

Review хранит решение и защищает расчёты/receiver/version, но не регистрирует on-chain entitlement и не обеспечивает полный budget всех выплат с будущими rent/fees. Funding reserve 0.05 SOL — policy reserve, не рассчитанная стоимость execution и не escrow. Эти проверки обязательны до settlement approval и непосредственно перед каждой transaction.

### 5. Историческая и текущая документация местами смешаны

[solana-client README](../packages/solana-client/README.md) содержит ранние утверждения о непроверенной live integration рядом с поздними passed evidence. В начале [corporate-actions feature](features/corporate-actions.md) funding описан как pending, хотя funding implementation и isolated acceptance уже существуют. Датированный [аудит 2 октября](PROJECT_AUDIT_2026-10-02.md) полезен как история, но его ранние таблицы нельзя читать как текущий статус.

Нужно синхронизировать current-state документы, сохранить датированную историю и добавить security/data-flow/testing документы по требованиям. Не изменять утверждённое ТЗ ради совпадения с неполной реализацией.

### 6. Readiness и CI не покрывают все требуемые эксплуатационные gates

API readiness сейчас выполняет только SELECT 1. Отдельного RPC degraded status и требуемого набора API/RPC/confirmation/retry/mismatch metrics в коде нет. Это допустимо для существующего первого среза, но ограничивает диагностику полного execution.

В текущем CI YAML есть host Rust, unit/type/schema/build, dependency audit и HTTP/DB/proxy tests. Нет SBF build/identity + настоящего validator runtime gate и secret scan. Незакоммиченный YAML также ещё не выполнялся в GitHub. Требуемые p95 dashboard <3s и обычного DB API <1s не измерены; отдельные cold staging запросы занимали 33–35s. Нужно добавить metrics, воспроизводимое измерение в выбранном demo-профиле и соответствующие gates, не называя единичный health-request нагрузочным тестом.

## Проверки, реально выполненные 7 октября

| Проверка | Результат и предел |
|---|---|
| npm run check | PASS: schema/type/scaffold, 197 JavaScript/TypeScript tests; до добавления отчёта проверены ссылки/fences 50 Markdown |
| npm run build | PASS: API, web, domain, Solana client |
| npm run test:web:proxy | PASS: production proxy, 30 allowlisted routes, Origin/body/cookies и unknown-route isolation; backend тестовый |
| Host Rust tests | PASS: 9/9 default и 9/9 devnet profile; fmt и clippy -D warnings PASS |
| Compose | PASS: docker compose config --quiet |
| Fresh PostgreSQL | Все 18 migrations применены к отдельной временной базе; SQL database guards PASS |
| API persistence | PASS: реальные Prisma/PostgreSQL snapshot integrity/CAS/duplicate checks |
| Investor Registry HTTP/DB | PASS: roles, Origin, proof/replay, eligibility/revoke, locking, concurrency, audit rollback/immutability, pagination/rate limits/logout и instrument drafts |
| Corporate actions HTTP/DB | PASS: все три типа, schedule-boundary fixtures, calculation/review, tampering/revoked recipient, concurrency/rollback; fixture finalization не является chain proof |
| Disposable Solana integration | PASS, процесс exit 0: 31 группа program/client runtime сценариев, четыре prepared v0 issuance-фазы, schedule/cancel всех трёх типов, snapshot и authority/replay negatives; дополнительно реальные HTTP/PostgreSQL snapshot/calculation и exact 1750 treasury funding |
| Main npm audit --omit=dev | FAIL: 1 High |
| tools/solana-integration npm audit | FAIL: 5 High, 7 Moderate |

SBF binary в ходе аудита заново не собирался. Изолированный validator использует сохранённый Localnet artifact; это не upgrade существующей программы и не доказательство совпадения будущего нового SBF с текущим исходным кодом. Owner Phantom/manual acceptance, persistent balances/genesis и authenticated Render flows сегодня не выполнялись.

Текущая disposable evidence (это не owner-выпуск и не публичная сеть): genesis `AU63Uso2vJjwo2trVV9tc4uBdQThxQjd67e26kfV5pjp`, action `2751290e-73ce-49ec-b5cc-72f68308bcac`, snapshot hash `da0671da8f0121e0aff2d735162d8b2812e8238c27ae884bf259a5a514274b1f`, effective slot 910, сумма balances 35. Funding operation `13b9c00d-804a-4573-afba-7591302c7bb4` подтверждена с treasury 1750000000 minor units в slot 980. Investor payment отсутствует по контракту этого теста.

Harness завершил cleanup своего validator/ledger и action database. Отдельный созданный для аудита PostgreSQL-контейнер остановлен и автоматически удалён; исходный owner-container по-прежнему Exited, существующий owner volume сохранён. После создания отчёта проверка Markdown links/fences прошла для 51 файла; git diff --check прошёл. Итоговое дерево: прежние 56 modified tracked, прежние 50 untracked entries и новый отчёт.

Локальные ignored evidence logs: `.local-audit-20261007-{check,build,proxy,rust,persistence,registry,actions,validator}.log`. Они не публикуются автоматически и не заменяют публичные receipts.

## Список оставшихся работ в порядке выполнения

| № | Что сделать | Критерий закрытия |
|---|---|---|
| 1 | Восстановить существующую локальную среду без reset; сохранить DB/ledger backup, сверить genesis/program/operator/migrations и текущие attempts | API/web/RPC доступны; owner issuance/snapshot/calculation/funding состояния независимо прочитаны; backup restore проверен на копии |
| 2 | Устранить main dependency High; отдельно разобрать test-tool advisories | Main deployed graph audit PASS, lockfile проверен build/tests; решения по отдельному test graph документированы |
| 3 | Исправить stale unsigned funding recovery и проверить оба пути: approve до funding и funding до approve | Можно безопасно подготовить свежий unsigned plan при новой версии/дефиците; signed/UNKNOWN attempt сохраняется; regressions и браузерная приёмка |
| 4 | Завершить owner funding и явное решение по расчёту | После свежей сверки владелец подтверждает нужные подписи/решение; exact finalized treasury delta + atomic DB/audit; это ещё не payout |
| 5 | Реализовать register_entitlement, finalize_calculation, approve_action и соответствующие API/client plans | Program PDAs/counters связывают immutable snapshot, investor, amount, receiver, formula/version; application и chain read-back согласованы; full-action budget gate |
| 6 | Выполнить безопасный reviewed Localnet program upgrade для новых instructions | SBF/IDL/program identity подтверждены, сохранённые аккаунты совместимы, authority/genesis не изменены, rollback/backup план и isolated acceptance есть |
| 7 | Реализовать execute_coupon и execution receipt | Одна atomic transfer+receipt transaction на entitlement; реальные finalized выплаты 500/1000/250; другой signer/receiver/mint, insufficient funds и duplicate execution отклоняются |
| 8 | Добавить устойчивый executor/attempt lifecycle и DB projection | Signature сохраняется до ожидания; RPC timeout/lost response/DB audit failure/restart/partial completion восстанавливают ту же операцию; нет blind resend; reindex и идемпотентность |
| 9 | Реализовать Cash/Asset Legs, reconciliation, finalize_action и JSON Action Receipt | Для coupon ASSET NOT_APPLICABLE; expected/actual/receipt совпадают; MATCHED + canonical receipt hash/PDA/signature; mismatch блокирует FINALIZED |
| 10 | Реализовать execute_early_redemption | Атомарные pay+partial burn+record+receipt; 20% floor rule даёт burn 2/4/1, остатки 8/16/4 и supply 28; zero-rounding skipped; replay запрещён |
| 11 | Реализовать execute_redemption на maturity | On-chain Clock достиг maturity; principal+final coupon и burn оставшегося supply атомарны; supply 0 и все receipts перед REDEEMED; post-snapshot transfer/size limits блокируют весь entitlement без payout |
| 12 | Закрыть orchestration пробелы: missed window, expired draft, pause/resume по требованиям, exceptions | Пропущенное окно явно блокирует дальнейший capture, история неизменна; stale DRAFT исправляется управляемо; ошибки/ответственный/безопасное действие видны |
| 13 | Завершить required операторский UI и evidence access | Отдельные required routes, holders/timeline, review/receipt/transactions/audit, protected snapshot/receipt JSON и access audit; Auditor read-only; loading/empty/reject/mismatch/partial/recovery проверены |
| 14 | Закрыть оставшиеся Registry lifecycle функции | Search/detail/update/close, reasoned eligibility correction/suspension и временная блокировка; immutable audit, запрет payout и правила snapshot history сохранены |
| 15 | Пройти единый воспроизводимый acceptance от seed до финального погашения | Отдельный ускоренный demo instrument без подмены часов; supply 35 → coupon → early 20% → maturity 0, real receipts/reconciliation; clean setup, replay/security/negative/recovery и manual Administrator/Auditor Phantom gates |
| 16 | Добавить observability, расширить CI и проверить нефункциональные требования | API/RPC/confirmation/retry/mismatch metrics, отдельный RPC degraded status; SBF identity/runtime и dependency/secret gates; p95 измерен на согласованном demo-профиле, restart/backup restore приняты |
| 17 | Синхронизировать docs и release evidence | Current-state README/checklist, security threat model, architecture/data-flow, testing/backup/startup процедуры; доказательства three-action demo, ограничения и release notes |
| 18 | Опубликовать проверенные изменения в GitHub и обновить Render | Полный diff reviewed, commits и CI нового SHA зелёные, migrations/env применены, deployed SHA сверён; authenticated staging routes работают, health не выдаётся за chain acceptance |

Приоритет первого этапа — шаги 1–3. Шаги 4–9 закрывают coupon как один полный вертикальный сценарий. Затем тот же receipt/recovery/reconciliation механизм используется для раннего и полного погашения. UI нужного шага добавляется вместе с backend, а не откладывается до самого конца. Первую публикацию foundation/fixes можно сделать раньше шага 18 после исправления security gate; она не означает готовность всего MVP.

Повторяющийся release gate для любого финансового шага: exact plan/signer/network → finalized transaction → read-back token/PDA → atomic DB/audit → receipt/reconciliation. Approval, подпись, отправка и finalized — отдельные факты.

## Отдельный последующий scope

Public Devnet funding/deployment остаётся отложенным по [ADR-014](decisions/ADR-014-local-mvp-before-public-network.md). После принятия Localnet MVP нужны отдельные network/authority/funding/build/deploy и wallet acceptance gates.

До production/реальных финансов дополнительно нужны юридический оператор/реестр и paying agent, KYC/AML, банк/KASE/CSD, production custody/multisig, строгий record-date checkpoint/transfer policy, privacy/tenant isolation, durable hosting/backup restore, capacity monitoring, независимый security review. Эти пункты не следует смешивать с обязательным локальным demo. Текущий KZT-Test — **SIMULATED ASSET. Not issued by the National Bank of Kazakhstan**.

## Следующий конкретный этап

Обновление после аудита: восстановление среды, dependency/UI fixes и отдельный кандидат on-chain расчётов описаны в [отчёте этапа 7 октября](testing/delivery-stage-2026-10-07.md). Наблюдения выше сохраняют дату аудита; новый funding attempt остаётся неподписанным по решению владельца, выплаты ещё не выполнены.

Сначала восстановить и сверить существующую среду, исправить dependency High и funding UI. Затем завершить funding/decision gate владельца и реализовать on-chain coupon entitlement/approval/execution/receipt. Новое issuance или повторный snapshot существующего action для этого не нужны.
