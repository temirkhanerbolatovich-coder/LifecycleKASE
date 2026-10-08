# LifecycleKASE: аудит и точка продолжения

Актуальная точка продолжения — 2026-10-03: выпуск LKA26R1 и snapshot купона `464a832a…` приняты; старое действие сохранено. Stage 7 и Localnet funding/budget из Stage 8 реализованы и прошли изолированные проверки. Купон 500/1000/250 KZT-Test (всего 1750) остаётся UNDER_REVIEW. Для владельца сохранён неподписанный план финансирования 1750; treasury/supply ещё 0. Последняя внешняя сверка GitHub/Render относится к опубликованному `112bdb1`; изменения пока не опубликованы. Исторические проверки ниже сохранены, текущая точка дополнена в конце.

Дата проверки: 2026-10-02, Asia/Qyzylorda. Аудит текущего кода, требований, архитектуры, ADR, миграций, тестов, GitHub, Render и локального состояния. Код приложения, существующие незакоммиченные изменения, постоянные записи БД и развёртывания в рамках аудита не изменялись. Интеграционные проверки создавали и удаляли собственные изолированные тестовые базы.

## Основной вывод

Работают основа приложения, первый срез реестров и живой выпуск LKA26R1: все четыре фазы Phantom → Localnet → finalized → PostgreSQL приняты, Instrument PDA и база имеют ACTIVE, supply 35/35, инвесторы 10/20/5, treasury 0. Восстановление истёкшей сессии прошло без повторной отправки DISTRIBUTION. Корпоративные действия/snapshot ещё требуют живой приёмки, выплаты и погашения не реализованы. Полный MVP не готов.

Активный режим: локальный MVP согласно [ADR-014](decisions/ADR-014-local-mvp-before-public-network.md). Публичный Devnet — последующий отдельный этап. Render — доступный демонстрационный стенд приложения; доступность стенда не доказывает исполнение блокчейн-операций.

## GitHub и Render

Исходные разделы аудита ниже сохраняют состояние до исправлений. Последующие результаты находятся в разделах «Продолжение» и [runbook живой приёмки](testing/localnet-instrument-acceptance.md). Главный вывод выше обновлён после ACTIVATE. Локальные исправления и новая приёмка пока не опубликованы в GitHub/Render.

| Объект | Проверенное состояние |
|---|---|
| Локальная ветка | `master`, HEAD `112bdb14edd04fd0a76f153e627e14ebb857b850` |
| GitHub master | Тот же SHA, проверен через `git ls-remote` |
| GitHub CI | [Run 36985707987](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/36985707987), `success`; `repository-checks` и `program-checks` успешны |
| Render API | `Live`, тот же SHA; [deploy dep-davmujk9v7es738ds4d0](https://dashboard.render.com/web/srv-datqbh3ncjis739kg5ag/deploys/dep-davmujk9v7es738ds4d0), ручной запуск, 1m11s |
| Render web | `Live`, тот же SHA; [deploy dep-davmunrncjis73f0kvng](https://dashboard.render.com/web/srv-datqc83ncjis739kipqg/deploys/dep-davmunrncjis73f0kvng), ручной запуск, 1m12s |
| Render API build | Текущий лог сообщает `All migrations have been successfully applied`; отдельный SQL-доступ к staging и пересчёт миграций там не выполнялись |
| Локальные изменения | До аудита: 20 изменённых tracked-файлов, 2 untracked-файла; эти изменения ещё отсутствуют на GitHub и Render |

Таким образом, GitHub и оба Render-сервиса синхронизированы с последним **коммитом**, но не с текущим рабочим деревом. В частности, новый Localnet `deploy/submit` и восстановление истёкших попыток ещё не опубликованы.

Публичные проверки:

- API `/api/v1/health/live`: HTTP 200, `{"status":"live"}`.
- API `/api/v1/health/ready`: HTTP 200, `{"status":"ready"}`.
- Web `/health/live`: первый запрос превысил 45 секунд, последующий HTTP 200, `{"status":"live"}`. Панель Render предупреждает о задержках при пробуждении free instance; первый тайм-аут сам по себе не доказывает постоянный сбой.
- Web `/dashboard`: HTTP 200.
- Web `/api/v1/instruments` и `/api/v1/auth/session` без cookie: HTTP 401, `SESSION_REQUIRED`.

Эти проверки подтверждают доступность, связь с БД и защиту указанных маршрутов. Реальный вход с Phantom, роли внутри браузера и транзакции на Render в этом аудите не повторялись. Значения секретов и environment settings Render не читались.

## Где остановились

Последний коммит завершил приложение для `INITIALIZE` и `ACTIVATE`, после ранее добавленных `MINT_SETUP` и `DISTRIBUTION`.

В незакоммиченном продолжении:

1. Для Localnet Phantom использует `solana:signTransaction` вместо самостоятельной отправки в сеть.
2. API `POST /api/v1/instruments/:id/deploy/submit` проверяет сохранённый message, единственного signer и Ed25519-подпись, затем передаёт точные байты в настроенный RPC.
3. Неопределённая попытка с истёкшим blockhash и отсутствующей в истории подписью становится `FAILED / BLOCKHASH_EXPIRED_UNCONFIRMED`. Видимая в RPC истории подпись остаётся доступной для восстановления.
4. Попытка из другого genesis становится `FAILED / NETWORK_GENESIS_CHANGED`.
5. Добавлены тесты, обновления описаний и helper подготовки синтетических инвесторов.

Историческая первая подпись `MINT_SETUP` из [инструкции приёмки](testing/localnet-instrument-acceptance.md) не является подтверждением успешного выпуска.

Фактическая БД `lifecycle_kase_acceptance_20261002`:

| Данные | Текущее состояние |
|---|---|
| Инструменты | 1, статус `DRAFT` |
| Попытки MINT_SETUP | 1 `PREPARED`, 2 `FAILED` |
| Причины FAILED | `NETWORK_GENESIS_CHANGED`, `BLOCKHASH_EXPIRED_UNCONFIRMED` |
| Инвесторы | 3 `ACTIVE / ELIGIBLE` |
| Кошельки | 5 `ACTIVE` суммарно; этот агрегат включает разные назначения, не означает пять инвесторов |
| Corporate Actions | 0 |
| Snapshots | 0 |

Текущий validator отвечает на `http://127.0.0.1:8899`, genesis `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`. Новая `PREPARED` попытка относится к этому genesis; историческая инструкция содержит более ранний `B7rv...`. Программа `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` существует как executable account, owner — upgradeable loader. Upgrade authority и хэш текущего загруженного бинарника независимо не сверялись.

Локальные web `3000` и API `4000` на момент проверки не запущены: соединение отклонено. PostgreSQL работает на loopback `55433`, тогда как стандартный пример и default тестов используют `55432`. В основной локальной БД применены все 16 миграций. При продолжении нужно использовать фактический порт и правильную acceptance-базу, не заменяя пользовательский `.env` шаблоном.

## Что работает и на каком уровне это доказано

| Функция | Доказательство | Граница |
|---|---|---|
| Сборка web/API/domain/client | Локальные `npm run check`, `npm run build` успешны | Не доказывает каждый браузерный сценарий |
| Health и PostgreSQL readiness | Реальные публичные HTTP-проверки | Solana readiness не проверяется этим маршрутом |
| Wallet login, session, logout | Реальные локальные HTTP/Ed25519/PostgreSQL тесты, unit tests | Реальный Phantom ранее принят владельцем по документам; сейчас не повторялся |
| Роли и защита изменений | Administrator/Auditor, Origin, session, rate-limit проверки по HTTP | Один demo workspace; multi-tenant доступ не реализован |
| Реестр инвесторов | Создание, список, cursor pagination, pending wallet attachment | Нет поиска, полного detail, update/close |
| Владение кошельком | Точная подпись сообщения, одноразовый challenge, активация, replay rejection | Это доказательство владения кошельком, не KYC |
| Eligibility и revocation | Одноразовое решение, терминальный отзыв, причины/время/аудит, capture-window lock | Нет исправления eligibility, suspension или временной блокировки |
| Черновик инструмента | Реальный HTTP/PostgreSQL тест: роли, invariants, atomic audit | Создание `DRAFT` само по себе не выпускает токены |
| Четыре фазы выпуска | Unit/fixture проверки транзакций, счетов, PDA, eligibility и 10/20/5 | Полная живая приёмка отсутствует |
| Localnet API broadcast | Тесты точной подписи/message, wrong signer/network, отправки | Новый незакоммиченный код; реальный Phantom-сценарий не завершён |
| Финансовые расчёты | TypeScript integer/BigInt tests: coupon, principal, early redemption и округления | Нет matching Rust calculation/execution flow |
| Holder collector, snapshot-v2 | Тесты supply, mapping, finalized slot, canonical bytes/hash | Не завершён живой snapshot через UI |
| Snapshot persistence | Реальная изолированная Prisma/SQL проверка child rows, CAS и duplicate rejection | Нет завершённой application-chain приёмки |
| Snapshot prepare/confirm | API/UI, exact finalized message/PDA verification, fixture tests | Требует заранее существующего action UUID |
| Anchor instructions | 5 инструкций в коде; Rust host tests 8/8 в каждом профиле | Текущий isolated-validator запуск заблокирован портом; прошлый runtime pass — историческая запись |
| Audit и ограничения БД | Immutable audit, transaction rollback и network/status guards в HTTP/SQL интеграции; SQL guard suite успешен в CI данного коммита | Таблицы receipts/settlement не являются реализацией соответствующих workflow |

Пять существующих Anchor-инструкций: `initialize_instrument`, `activate_instrument`, `create_corporate_action`, `cancel_action`, `register_snapshot`.

## Что не работает, не реализовано или не принято

### Воспроизводимые проблемы

- Прежний путь Phantom `signAndSendTransaction` не доставил `MINT_SETUP` в нужный Localnet. Исправление подготовлено, но требует живой проверки.
- `scripts/test-web-operator-proxy.mjs` падает на строке 64: ожидает `404` для `/api/v1/investors`, фактически получает `200` от synthetic upstream. Маршрут теперь реализован; старое отрицательное ожидание неверно. Этот скрипт не запускается основным `npm run check` или CI. После ошибки также выведено Windows Node assertion при завершении; причина этого сообщения отдельно не установлена.
- Изолированный validator integration не стартует: `Unable to bind faucet to 0.0.0.0:9900`, порт занят работающей средой. Другой RPC-порт не устраняет конфликт faucet. Работающий validator не останавливался.
- Локальный web/API сейчас остановлены. Это состояние процессов, а не доказанный дефект приложения.

### Реализовано частично, но нельзя объявлять работающим целиком

- Нет `FINALIZED` выпуска четырёх фаз и итогового `ACTIVE` в acceptance-базе.
- Snapshot UI продолжает использовать wallet `signAndSendTransaction`; исправление Localnet transport применено к instrument flow. Совместимость snapshot с тем же Phantom/Localnet требует отдельного решения/проверки, иначе возможна та же проблема маршрутизации.
- При перезагрузке и потере ответа нужно принять recovery вручную; доступность recovery-кода и fixture tests недостаточна.
- Runtime валидатора ранее проверен по документации, но полный текущий browser → API → chain → DB сценарий не доказан.

### Отсутствующие функциональные срезы MVP

- Создание/планирование/list/detail/cancel корпоративных действий через приложение. On-chain create/cancel есть, HTTP/UI orchestration нет.
- Расчёт и сохранение entitlements как workflow, TypeScript/Rust parity, review/approve/reject/revision, approval gate перед исполнением.
- Funding тестового settlement asset, `execute_coupon`, finalized payments и on-chain execution receipts.
- Maturity/early redemption: атомарные payment + burn + receipt, остатки, supply reconciliation, replay protection исполнения.
- Завершённая Cash/Asset Legs reconciliation, MATCHED по реальным chain facts, экспорт проверяемого Action Receipt и snapshot provenance.
- Полные страницы instrument/action/entitlement/detail/audit; сейчас фактические страницы — `/`, `/dashboard`, `/health/live`.
- Сквозные coupon, early redemption и maturity redemption acceptance и материалы демонстрации.

### Отложено или за пределами MVP

Публичный Devnet deployment отложен владельцем. Mainnet, реальные средства, юридический выпуск, KYC/AML, банк, цифровой тенге, KASE/CSD, production custody, multisig, Transfer Hook/whitelist и многоарендность не реализованы и не входят автоматически в следующий локальный шаг.

## Валидация этого аудита

Успешно выполнены:

- `npm run check`: scaffold, 42 Markdown-файла/ссылки/fences до добавления этого отчёта, Prisma schema, typecheck и все запущенные Node suites.
- `npm run build`: deployable workspaces и Next.js production build.
- `npm run test:api:database` с явным loopback портом `55433`: все 16 миграций в собственной тестовой БД, snapshot persistence/nested rows/CAS/duplicate rejection.
- `npm run test:registry:database` на том же порту: real HTTP login/signature/session/roles/Origin, draft, registry, ownership/replay, eligibility/revocation/audit, concurrency/rollback/immutability, capture lock, pagination/rate limit/logout.
- `cargo test -p lifecycle_kase --locked --offline`: 8/8; тот же запуск с `--features devnet`: 8/8.
- `cargo fmt --all -- --check` и `cargo clippy -p lifecycle_kase --all-targets --locked --offline -- -D warnings`.
- `npm audit --omit=dev`: 0 vulnerabilities в deployable graph.
- `docker compose config --quiet`, `git diff --check`.
- GitHub remote SHA, CI runs/jobs и Render deploy history/log, перечисленные live HTTP и read-only DB/RPC проверки.

Не прошли:

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-initialize-instrument.ps1 -WslUser lifecycle-dev -Profile localnet`: faucet port conflict, выполнение сценариев не началось.
- `node scripts/test-web-operator-proxy.mjs`: устаревшее ожидание `404`, фактически `200`.

Отдельный `npm audit --prefix tools/solana-integration` сообщает 12 advisories: 5 high, 7 moderate. Это изолированный legacy Anchor/web3/SPL test graph, не зависимости Render. Автоматическое обновление зависимостей не выполнялось.

Прямой локальный запуск `npm run test:database` в постоянной базе не выполнялся: suite проверяет также fixture `KZT_TEST`, которая может конфликтовать с сохранёнными demo-данными. Его pass подтверждён в GitHub CI данного HEAD; локальные HTTP/SQL интеграции запускались в собственных изолированных БД.

## Конкретный порядок продолжения

1. **Сохранить текущие изменения и завершить живой выпуск.** Не начинать заново и не очищать acceptance-базу/ledger. Проверить текущие genesis, program/upgrade authority, миграции, issuer wallet и срок blockhash. Запустить API/web с acceptance-базой на `55433`. Получить свежий план при необходимости и выполнить `MINT_SETUP → DISTRIBUTION 10/20/5 → INITIALIZE → ACTIVATE` с подписью пользователя в Phantom.
2. **Принимать каждую фазу по данным.** Записать finalized signatures, bond/settlement mint, treasury/holder balances, mint-authority revocation, Instrument PDA/статус и matching DB projection. `ACTIVE` разрешён только после последней сверки. Проверить отказ подписи, истечение blockhash, wrong signer/genesis, reload и потерю ответа.
3. **Закрыть два дефекта проверки.** Дать isolated-validator harness отдельный faucet port без остановки живого validator. Заменить устаревший unknown-route пример smoke-теста на действительно неразрешённый путь, добавить проверку новых deployment routes. Не трактовать ошибку самого теста как дефект реестра.
4. **Сохранить принятый результат в Git.** После code self-review, тестов и синхронизации документации закоммитить Localnet correction и evidence. Отдельно решать публикацию/Render: localhost validator недоступен из облачного Render, поэтому локальная приёмка не создаёт облачный chain deployment.
5. **Сделать action vertical slice.** Создание/планирование/list/detail/cancel в API/UI, future record window, prepare/sign/confirm по on-chain action PDA, роли/audit/ошибки.
6. **Завершить живой snapshot.** Проверить транспорт Phantom Localnet, capture window, effective finalized slot/time, canonical hash, Action PDA, DB immutability, idempotency и recovery.
7. **Entitlements и approval.** Реализовать application persistence, Rust/TypeScript parity и review/approval gate с actor audit.
8. **Coupon vertical slice.** Funding KZT-Test, on-chain execution, finalized balances/receipt, replay rejection и Cash Leg reconciliation.
9. **Redemption slices.** Maturity и partial early redemption, payment/burn/receipt атомарно, current source balances, остатки и supply, повторное исполнение отклоняется.
10. **Evidence/UI и финальная приёмка.** Receipts/export/provenance/audit/detail views; пройти полный Definition of Done из требований. Только затем возвращаться к отдельно утверждаемому public Devnet этапу.

## Актуальность документации на момент исходного аудита

Сохраняемые требования описывают целевой MVP, а не текущую реализацию. Текущие implementation/checklist документы в основном правильно отделяют fixtures от live acceptance, но есть рассинхронизация:

- [render-staging.md](deployment/render-staging.md) и строка Public staging в [IMPLEMENTED_VS_SIMULATED.md](IMPLEMENTED_VS_SIMULATED.md) ещё указывают `6dd98fe`/14 миграций вместо фактически наблюдаемого deploy `112bdb1`.
- [localnet-instrument-acceptance.md](testing/localnet-instrument-acceptance.md) сохраняет ранний genesis; новые текущие public identities/results следует дописывать с датой, не стирая историю.
- [API README](../apps/api/README.md) описывает prepare/confirm, но новый незакоммиченный submit endpoint требует дополнения при завершении исправления.
- [ADR-014](decisions/ADR-014-local-mvp-before-public-network.md) содержит историческое утверждение о prior staging revision; текущую синхронизацию нужно читать по этому аудиту и deployment history.
- Dashboard сообщает о реализованном выпуске без завершённой live acceptance. При следующем UI изменении следует явно отличить реализацию фаз от принятого выпуска.
- Production proxy smoke script устарел относительно allowlist.

Этот отчёт фиксирует новую проверку и не переписывает исторические свидетельства. Перед следующей сессией сначала перечитать его, Git status и текущие DB/RPC facts: validator genesis, срок transaction plan и running processes могут измениться.

## Продолжение после аудита — 2026-10-02

По разрешению владельца начата работа с приоритетами выпуска. Исправлены и локально проверены production proxy smoke (включая registry/deploy routes) и отдельные faucet/gossip ports тестовых валидаторов. Проверка proxy добавлена в CI; удалён устаревший отрицательный пример `/investors`.

API/web подняты на 4000/3000 с сохранённой acceptance-базой на 55433. По finalized RPC проверены ProgramData/Phantom upgrade authority и 100 test SOL. Владелец показал ошибку подписи: 827 байт вместо подготовленных 775. После сверки с официальной документацией Phantom сериализатор стал задавать compute limit/price до подписи. Строгая проверка message/подписи сохранена; тест также отклоняет валидно подписанный, но изменённый priority price.

Дополнительно исправлена сверка KZT-Test mint authority: требование её отсутствия противоречило созданному mint и будущему тестовому funding. Требуется точный issuer, тогда как bond authority остаётся отозванной. API-тесты с регрессией — 70/70.

Изолированный validator suite прошёл: четыре новые группы отправляют реальные v0 планы клиента приложения и сверяют finalized bytes/mint/distribution/Deploying/Active; далее прошли существующие 25 runtime groups. Это disposable signer/ledger, не пользовательский Phantom/acceptance draft. Отдельный validator smoke также прошёл после устранения конфликта gossip 8000 с другой локальной службой. Основной validator не останавливался.

Полная приёмка пользовательского инструмента остаётся открытой до успешных подписей и DB/chain сверки. Следующий пользовательский шаг — обновить dashboard, получить свежий MINT_SETUP plan и повторить подпись/finalized. Подробности находятся в [инструкции приёмки](testing/localnet-instrument-acceptance.md). GitHub/Render в ходе исправлений не обновлялись.

### Продолжение после подписи Phantom: короткая история validator

Подпись нового MINT_SETUP для `LKA26` получена, но первый confirm был вызван ещё до finalized. Позже RPC уже не предоставлял транзакцию: блоки были очищены коротким стандартным лимитом test-validator (10 000 shreds). При этом finalized аккаунты показывают созданные bond/KZT-Test mints и treasury 35. Поэтому старый выпуск нельзя объявить принятым по строгому контракту exact-message confirmation и нельзя повторно создавать те же mint. Попытка сохранена как `UNKNOWN_CONFIRMATION / TRANSACTION_UNAVAILABLE`; автоматическая замена этой попытки заблокирована. Диагностика теперь отличает pending от отсутствующей истории, UI объясняет дальнейшую сверку.

Persistent ledger остановлен, сохранена локальная копия после остановки и выполнен restart без reset с лимитом 10 000 000 shreds. Genesis, старые mints и treasury сохранились. Live retention probe прошёл: успешная finalized транзакция доступна спустя ещё 326 finalized slots. Через обычный audited draft service создан отдельный `LKA26R1`, UUID `c9a1648f-f896-4135-bb19-63bedff119f3`, с теми же условиями и новыми детерминированными адресами. Следующий пользовательский шаг относится только к этому новому draft. Старый LKA26, его попытки и on-chain эффекты остаются сохранёнными; `ACTIVE` не заявляется. API-тесты — 72/72, web typecheck прошёл. Подробные signatures/state/restart evidence добавлены в [runbook](testing/localnet-instrument-acceptance.md). GitHub/Render не обновлялись.

**MINT_SETUP для LKA26R1 принят:** пользовательская Phantom-подпись finalized без ошибки в slot 12439, штатный confirm сверил точный message и mint/authority/treasury и записал projection/audit. Bond mint `QZYBisMjqfcWA2Vk4Ygvt8SZ4Vt9rTXfnmu6DkrKFh6`, KZT-Test `HgyDrHmGX6frycUDokctWddqEPTvQQoLsTMmnbVr7nrc`, treasury 35. Instrument остаётся DRAFT с circulating supply 0; следующий шаг — пользовательская подпись DISTRIBUTION 10/20/5. `npm run check` прошёл полностью. Все четыре live-фазы ещё не завершены.

**DISTRIBUTION подписан и finalized в chain (slot 15349):** точный message совпал, treasury 0, investor accounts 10/20/5. Подтверждение через API остановилось на SESSION_REQUIRED; DB projection пока не принята. Исправлено восстановление входа тем же кошельком без размонтирования workflow и без автоматического повтора mutation. При полном reload API возвращает исходные status/signature pending attempt; UI восстанавливает только проверку, отключая новую отправку. API 73/73 и web 16/16 passed, typecheck прошёл. Следующий шаг — пользовательская подпись сообщения входа и повтор защищённого confirm для попытки `4792bfc2-e8b1-41f1-b838-1809d3d77793`, затем INITIALIZE/ACTIVATE. Auth TTL/роль/Origin/signature проверки не ослаблялись. Подробности в [runbook](testing/localnet-instrument-acceptance.md).

### Принятый результат: LKA26R1 ACTIVE

После обычного входа тем же Phantom-кошельком защищённый confirm принял исходную DISTRIBUTION-попытку без повторной отправки. Затем пользователь подписал и подтвердил INITIALIZE и ACTIVATE. Независимая сверка всех четырёх successful finalized транзакций проверила полные сообщения против сохранённых планов; Instrument PDA совпал с UUID, authorities, mints, условиями, датами и supply в базе. Финальное состояние: ACTIVE, DB version 4, supply 35/35, держатели 10/20/5, treasury 0. В базе ровно четыре FINALIZED-попытки с соответствующим audit. UUID, signatures, slots и адреса сохранены в [runbook](testing/localnet-instrument-acceptance.md).

Полный `npm run check` прошёл: API 73/73, web 16/16, Solana client 26/26 и root 18/18, остальные workspace/type/schema/documentation проверки также успешны. Исправления не ослабляли аутентификацию или exact-message verification. Дополнительные ручные отрицательные сценарии перечислены в runbook. Старый LKA26 и его unavailable-history попытка сохранены; новый MINT_SETUP для старого инструмента выполнять не нужно.

Следующий функциональный приоритет: создание/планирование/list/detail/cancel корпоративного действия, затем живой snapshot этого инструмента. Платежи, funding KZT-Test, burn/receipts и полный MVP ещё не приняты. GitHub/Render остаются на опубликованном `112bdb1`; локальные исправления и новая приёмка туда не отправлялись.

### Следующий срез: корпоративные действия и snapshot

Реализованы API/UI создания, списка, detail/audit, планирования и отмены всех трёх типов действий. Создание DRAFT идемпотентно по UUID запроса; подготовка требует ACTIVE инструмента, кошелька issuer и будущего record time. SCHEDULE/CANCEL меняют статус только после проверки exact finalized message и всех условий Action PDA. Snapshot встроен в выбранное действие; Localnet использует проверенную API отправку подписанных байтов, подписанная попытка восстанавливается для подтверждения. Pending отмена и capture исключают друг друга. Добавлена миграция 17 без удаления прежних записей.

Исправлена обнаруженная HTTP-проверкой ошибка хронологии входа: challenge/session используют явное время приложения вместо смешивания часов PostgreSQL и Node. Проверки nonce, подписи, TTL, роли и Origin сохранены. Решение описано в [ADR-016](decisions/ADR-016-action-lifecycle-boundary.md), ограничения и команды — в [описании функции](features/corporate-actions.md).

Успешны `npm run check`, API regression suite (81/81), web 20/20, Solana client 29/29, root 18/18, production `test:web:proxy` для 23 маршрутов и отдельный HTTP/PostgreSQL action suite: роли/Origin, даты/суммы, конкурентное создание, list/detail, отмена DRAFT и откат при ошибке audit. Совмещённая HTTP/PostgreSQL/validator приёмка также прошла: три типа SCHEDULE/CANCEL, настоящий 10/20/5 capture, SHA-256/PDA commitment, FINALIZED snapshot/SNAPSHOT_CREATED action, immutable DB и recovery старой подписи. Начальная ошибка теста объяснялась тем, что finalized время отставало примерно на 15 секунд, а тест ждал только 12,5 секунды после record date; bounded ожидание теста исправлено, window/finalized правила приложения не ослаблены. Точные публичные данные отдельного тестового snapshot записаны в [feature evidence](features/corporate-actions.md#isolated-acceptance--2026-10-02).

Пользовательская Phantom-приёмка на постоянном LKA26R1 остаётся открытой; владельцу доступны новые формы в dashboard. Постоянные issuer-ключи, инструмент, ledger и история выпуска не изменялись. В acceptance-базе проверены 17 миграций, LKA26R1 ACTIVE 35/35 и отсутствие созданных от имени владельца action/snapshot. Публикации GitHub/Render в этом срезе не было.

## Повторная сверка контекста и чек-листа — 2026-10-02, после 22:39 UTC+5

Эта секция уточняет текущую точку продолжения после исторических записей выше. Приложение, постоянная база/ledger и публикации при повторном аудите не изменялись. Обновлены только документы статуса.

### Проверенное локальное состояние

Повторно прочитаны PostgreSQL и finalized RPC. LKA26R1 остаётся ACTIVE, supply 35/35, Instrument PDA и все неизменяемые условия совпадают с базой. Все четыре успешные транзакции выпуска доступны и полные сообщения совпадают с сохранёнными планами. Bond mint authority отозвана; реальные положительные holder balances 10/20/5. Supply KZT-Test равен 0: funding/выплат не было. В базе 17 применённых миграций, 3 инвестора, 1 действие, 0 snapshots, 0 entitlements.

Владелец создал и подписал COUPON_PAYMENT `09d229a4-4ce9-48bb-bd3d-617c693a0511`. SCHEDULE FINALIZED в slot 37251, exact message, issuer и все условия Action PDA проверены независимо. Но snapshot не создан ни в базе, ни в Action PDA: действие остаётся SCHEDULED. Record time 22:28, окно capture закончилось в 22:33 UTC+5. Пользовательский ответ «Snapshot FINALIZED» не подтверждён данными; последующий скриншот также показывал только SCHEDULED. Автоматического перехода в SNAPSHOT_MISSED пока нет. Нельзя продлевать/задним числом заполнять это окно; для следующей live snapshot-приёмки нужен новый action UUID с будущим record time, без повторного выпуска инструмента. См. [runbook](testing/localnet-action-acceptance.md).

В этой повторной сверке заново прошёл `npm run check`: API 81/81, web 20/20, Solana client 29/29, root 18/18, остальные workspace/type/schema проверки успешны. После обновления документов прошли `npm run validate` (46 Markdown файлов) и `git diff --check`. Production proxy, совмещённый HTTP/PostgreSQL/validator harness и Rust suites повторно в этом аудите не запускались; их успешные результаты выше относятся к предшествующей реализации.

### Все этапы плана

| Этап | Сделано | Осталось / граница |
| --- | --- | --- |
| 1. Подготовка deployment | Toolchain, identities, authority plan, read-only preflight и проверка расшифровки backup | Последняя owner custody-проверка и Devnet funding; публичный этап отложен |
| 2. Program build | Отдельный Devnet профиль, SBF/IDL/hash gates и local-validator acceptance | Это локальный build/runtime, не public deployment |
| 3. Public Devnet | Подготовлен план | Deployment и on-chain assignment не выполнялись; deferred по ADR-014 |
| 4. Investor Registry | Create/list, proof of ownership, eligibility/revoke, Administrator/Auditor, audit и capture lock | Update/close, eligibility correction/suspension, временная блокировка |
| 5. Instrument | Четыре живые Phantom-фазы LKA26R1, ACTIVE PDA/DB, 35/35 и 10/20/5, session recovery | Остальные ручные negative/reload проверки; старый LKA26 сохраняется без повторного MINT_SETUP |
| 6. Actions/snapshot | API/UI всех трёх типов, create/list/detail/audit, signed schedule/cancel, trusted broadcast/recovery; полный изолированный HTTP/DB/validator snapshot pass; live Phantom SCHEDULE | Постоянный Phantom snapshot не принят, старое окно пропущено; ручные cancel/lost-response и Auditor action UI; автоматический missed-window статус |
| 7. Entitlements/approval | Чистые TypeScript расчёты, transition contracts и схема БД | Persistence/API/UI, Rust parity, review/approve/reject/revision, author/approver audit и execution gate |
| 8. Coupon settlement | Требования и schema boundaries | KZT-Test funding, execute_coupon, finalized payments/receipts и replay prevention |
| 9. Redemptions | Integer math и программное планирование типов | Atomic payment + burn + receipt, current holder checks, supply reconciliation и retry/replay |
| 10. Reconciliation/evidence | Чистые leg contracts и таблицы | Actual Cash/Asset Legs, MATCHED, verifiable Action Receipt export/provenance |
| 11. Operator UI | Dashboard, login/recovery, investor/instrument/action панели, selected action detail/audit | Entitlements, approval, execution/reconciliation/receipt screens и оставшиеся детальные страницы |
| 12. Final acceptance | CI infrastructure и пройденные промежуточные проверки | Полные coupon/early/maturity workflows, clean setup, полный manual/security/recovery набор и материалы demo |

### GitHub и Render: текущие обновления

`git ls-remote` и GitHub API подтвердили `master` на `112bdb14edd04fd0a76f153e627e14ebb857b850`, как и локальный HEAD. Последний коммит — завершение INITIALIZE/ACTIVATE от 13:43:49 UTC+5. Новых опубликованных коммитов нет. Последние четыре доступных CI runs успешны; текущий [run 36985707987](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/36985707987) имеет success, оба jobs repository-checks/program-checks успешны. Open PRs — 0. Это CI опубликованного SHA, а не локальных незакоммиченных функций.

До изменений документов этого аудита рабочее дерево содержало 49 изменённых tracked и 24 новых файлов: выпуск/Localnet transport/recovery, корпоративные действия, snapshot submission, миграция 17, тесты и evidence. Они ещё не закоммичены/отправлены. Новые proxy/action проверки добавлены в локальный CI YAML, но этот YAML ещё не выполнялся на GitHub.

Render Dashboard нужного workspace LifecycleKASE независимо показал API и web Live на том же SHA: [API deploy](https://dashboard.render.com/web/srv-datqbh3ncjis739kg5ag/deploys/dep-davmujk9v7es738ds4d0), [web deploy](https://dashboard.render.com/web/srv-datqc83ncjis739kipqg/deploys/dep-davmunrncjis73f0kvng). Последние deploy были Manual; более новых не видно. В API build log есть успешное применение миграций, build/startup и Live. Прямой SQL-пересчёт staging migrations не выполнялся; локальную миграцию 17 нельзя считать применённой на этом старом SHA.

Публичные HTTP-проверки: API live/ready, web live/dashboard — 200 с ожидаемым JSON/HTML; auth/session и instruments без сессии — 401 SESSION_REQUIRED. Первый ответ free instances занял 33–44 секунды, повторные — 0,6–0,8 секунды. Новый `/api/v1/corporate-actions` на web возвращает 404: action slice отсутствует в опубликованной версии. Health проверяет API/PostgreSQL, а не Solana/выплаты. Localnet RPC localhost пользователя не доступен облачному Render; публикация UI сама по себе не переносит ledger или live acceptance в облако. Секреты и cookies не читались, push/deploy не запускались.

### Следующий порядок

1. Закрыть постоянную Phantom snapshot-приёмку на новом coupon action с будущим record time, сохранив пропущенное действие и history.
2. Сверить и сохранить exact finalized message, effective slot/time, canonical hash/PDA, DB immutability и signed-attempt recovery.
3. Сохранить проверенные изменения/evidence в Git и отдельно синхронизировать GitHub/Render с учётом границы Localnet/cloud; публичный Solana Devnet не включать автоматически.
4. Реализовать persistence/parity/approval entitlements; для 10/20/5 ожидаемые coupon amounts 500/1000/250 KZT-Test являются расчётными векторами, не выполненными выплатами.
5. Funding и coupon execution, затем early/maturity redemption, reconciliation/receipts и полный demo acceptance.

## Продолжение: snapshot принят, Stage 7 реализован

Поздняя проверка 2026-10-02 (23:48 UTC+5) подтвердила новый coupon action `464a832a-2c55-4e22-bb7a-6be93b429c78`: оригинальные Phantom SCHEDULE и REGISTER_SNAPSHOT FINALIZED, точные messages совпадают с сохранёнными планами. Snapshot `6a322373…` имеет canonical SHA-256 `799e44c7…dff9b76a`, effective slot 44222/time 23:12:36, 3 инвесторов/кошелька и баланс 35. Capture уложился в первоначальное окно 23:10–23:15. Задержанное подтверждение БД восстановлено через явно разрешённую Localnet OS-команду существующим backend verifier; новая подпись или повторная отправка не выполнялась. Постоянный ledger/выпуск и старое действие `09d229a4…` сохранены. Полные публичные идентификаторы и границы доказательства — в [live runbook](testing/localnet-action-acceptance.md).

Реализованы stored investor entitlements, API/UI calculate/submit/approve/reject/return, проверка канонического snapshot, текущего допуска/receiver и версии, неизменяемый audit, execution gate и Rust/TypeScript parity на 18 общих векторах. Используются существующие schema/domain; новых зависимостей, миграций или deployment программы нет. Явный допуск synthetic Localnet не меняет KYC и не переносится на Devnet. APPROVED — состояние приложения; текущий Action PDA остаётся SNAPSHOT_CREATED. Решение и ограничения записаны в [ADR-017](decisions/ADR-017-stored-entitlements-and-demo-approval.md) и [feature](features/entitlements-and-review.md).

По разрешению владельца техническая подготовка выполнена самостоятельно: купон сохранён 500/1000/250 KZT-Test, всего 1750; три проверенных получателя, status UNDER_REVIEW/version 6. Audit отмечает CONTROLLED_LOCALNET_CLI и исходного authenticated issuer actor; HTTP сессии/роль/Origin не обходятся. Повторная подготовка не создала строк или событий, несовместимые operator/genesis отклонены. Настоящее решение владельца, выплаты и подписи этой командой не выполняются.

Проверки: полный `npm run check` — 188 тестов (API 86, web 24, domain 27, client 29, root 22), schema/types/docs; production web build/26 маршрутов; отдельный HTTP/PostgreSQL suite всех трёх типов с concurrency/rollback/zero/tampering/revocation; combined реальный disposable-validator snapshot → coupon calculation/review и сохранённые 25 runtime groups; Rust 9/9 в обоих профилях, format/Clippy. Эмуляционные FINALIZED fixtures отдельно помечены и не подменяют chain proof. Владелец/отдельный Auditor ещё не подтвердили новый UI согласования.

Текущий следующий шаг: решение владельца по сохранённым начислениям, затем Stage 8 test funding + reviewed on-chain coupon execution, после этого redemptions/receipts/reconciliation. GitHub/Render не публиковались в этом этапе; внешние SHA/health выводы выше относятся к предыдущей live-сверке `112bdb1`. Облачный Render по-прежнему не имеет доступа к пользовательскому localhost-validator. Публичный Devnet остаётся отложенным.

## Продолжение: Stage 8 budget/funding — 2026-10-03

Реализован первый срез купонного settlement: finalized-бюджет всего купона, treasury/mint/SOL, точный дефицит, неподписанный план, Phantom → проверка Ed25519/exact wire → loopback submit → finalized token-delta → атомарный audit. API/UI восстанавливают подписанную попытку без повторного wallet prompt; неизвестные Token-2022 layouts, другой issuer/genesis/Origin/роль и caller amount отклоняются. Резерв SOL — заданный запас, не escrow или доказательство комиссий будущего execution. Миграция 18 требует сохранённые wire/pins и одну незавершённую попытку funding на issuer. Решение — [ADR-018](decisions/ADR-018-localnet-coupon-funding.md), описание — [funding](features/coupon-funding.md).

Изолированная реальная сеть/HTTP/PostgreSQL выпустила ровно 1750 KZT-Test, подтвердила delta, concurrency, rollback audit на prepare/confirm, resume/replay и неизменность UNDER_REVIEW/CALCULATED. Сохранились проверки реального snapshot/review и 25 program runtime groups. `npm run check` прошёл 197 тестов (90 API, 25 web, 27 domain, 32 client, 23 root), schema/types/50 Markdown; production proxy/build — 30 маршрутов; отдельные HTTP/PG проверки всех трёх action types прошли. Rust/program binary в funding-срезе не изменялись.

На сохранённую acceptance-базу после read-only проверки 17 миграций применена только 18-я. План владельца `8d955803-adbe-4004-8277-4dd1c5aea73d` PREPARED без signature: 1750 KZT-Test в treasury `HmVxPK3DfwHh4YuQr59fECNWGaRDw55f7HAGyAsMkx6P`. Exact wire, issuer/genesis/mint, original authenticated actor и CONTROLLED_LOCALNET_CLI audit проверены независимо. Snapshot/выпуск/история сохранены; action UNDER_REVIEW/version 6, три CALCULATED entitlement, mint supply/treasury 0. Backend и dashboard отвечают, новые protected routes без сессии дают 401. Все детали/суммы/границы доказательства — в [live runbook](testing/localnet-action-acceptance.md).

Следующие обязательные шаги: подпись funding владельцем → finalized-сверка; явное решение по начислениям; reviewed on-chain entitlement/approval/execution с повторной проверкой бюджета и receipt; затем redemption/reconciliation. Контролируемая CLI умеет подтвердить уже подписанный audited funding без повторной отправки, но не подписывает и не согласовывает. Owner Phantom funding/отдельный Auditor UI ещё не приняты. GitHub/Render в этом этапе не обновлялись; публичный Devnet остаётся отложенным.
