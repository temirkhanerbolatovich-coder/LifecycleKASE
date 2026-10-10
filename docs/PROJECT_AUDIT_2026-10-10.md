# Полный аудит LifecycleKASE — 2026-10-10

Дата проверки: 10 октября 2026. Это текущая техническая оценка репозитория, требований, тестов, сохранённой базы и доступных сервисов. Датированные записи предыдущих проверок сохраняют историческое значение; этот документ и [план поставки](deployment/DEVNET_TO_MVP_CHECKLIST.md) задают актуальные границы и следующие задачи.

**Результат: работающий Localnet прототип с реализованной купонной цепочкой в изолированном кандидате. Полный MVP по ТЗ ещё не завершён.** Досрочный выкуп и погашение пока имеют расчёты, создание событий и review, но не атомарное on-chain исполнение payment/burn/receipt. Успех изолированного кандидата не означает установку или приёмку на сохранённом owner Localnet.

## Метод и границы

Проверены product/technical requirements, ADR, API controllers и финансовые workflow, доменные формулы, Solana builders/decoders, Anchor instructions, Prisma schema/миграции/триггеры, operator UI, proxy allowlist, CI, deployment/runbooks и результаты доступных проверок. Требования не переписаны и критерии приёмки не снижены. Это внутренний инженерный аудит, а не независимый аудит безопасности или подтверждение юридического соответствия KASE.

До публикации локальный HEAD и `origin/master`: `27af655bc3b0354ad067778fed8ebd0e68c61a64`. Его [GitHub CI 37844394400](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/37844394400) повторно проверен: success. В рабочем дереве находился накопленный неопубликованный пакет upgrade maintenance, approval/reserve, coupon/receipt, UI, тестов и документации. Новая публикация проводится отдельной веткой/PR; она не обновляет программу owner Localnet и не закрывает финансовые gates.

## Что уже есть

| Область | Реализация и проверенная граница | Что остаётся |
| --- | --- | --- |
| Архитектура | Next.js 16.4, NestJS, PostgreSQL/Prisma, чистый domain package, Solana client, Anchor/Token-2022; фиксированные серверные proxy routes | Production governance, эксплуатация и внешний program review |
| Operator authentication | Wallet challenge/message signature, одноразовый nonce, session hashes, срок/отзыв, HttpOnly/SameSite, Origin/role checks, rate limits | Распределённые лимиты, полная матрица пяти ролей и issuer isolation |
| Investor Registry | Создание, несколько wallet mappings, ownership challenge/verify/revoke, synthetic eligibility, audit | Редактирование/закрытие инвестора, полный suspend/unblock и корректировка ошибочных данных; реальный KYC исключён |
| Выпуск | MINT_SETUP → DISTRIBUTION → INITIALIZE → ACTIVATE; supply 35, balances 10/20/5, revoked mint/freeze authority, Permanent Delegate PDA | Canonical seed/reset/validation без ручного SQL; повторяемая чистая demo-среда |
| Corporate actions | Draft/schedule/cancel для coupon, early и maturity; даты/terms/версии, точные подписанные транзакции | Полный lifecycle management и терминальные recovery-сценарии |
| Snapshot | Finalized holder collection, полный supply, wallet mapping, canonical snapshot-v2/SHA-256, неизменяемые rows, exact-wire PDA confirmation | Историческое владение на record_at не реконструируется; отдельные canonical-download/detail API и audited issuer scope |
| Пропущенное окно | Защищённый явный check-window и проверка при подготовке; Clock/PDA/CAS/audit | Background sweeper и отдельный on-chain terminal transition отсутствуют |
| Финансовые расчёты | Integer/bigint coupon/principal/early; 18 общих Rust/TS vectors; stored inputs/formula/eligibility versions | Формулы redemption ещё не являются исполнением burn/payment |
| Review | Submit/approve/reject/return, version guards, immutable audit, повторная eligibility-проверка | Полноценное распределение issuer/compliance/approver прав и governance recovery |
| On-chain calculation | REGISTER/RESET/FINALIZE API/UI, complete set/hash/count/total, exact wire, durable recovery | Owner FINALIZE остаётся незавершённым; нельзя подменять его application review |
| Upgrade maintenance | Раздельные EXTEND/UPGRADE, durable attempts, database business-write lock, hash/account/authority read-back | Новый coupon candidate требует отдельного review/rollout; действующий manifest закрепляет предыдущий registration candidate |
| Funding | Расчёт дефицита KZT-Test, exact signed mint transaction, finalized token delta, попытка/audit | Owner funding неподписан; treasury funding не является action reserve или платежом |
| Separate approver/reserve | Isolated candidate: immutable separate authority, PDA vault, полный купон, pre-approval refund, exact APPROVE projection | Default-off; установка/назначение/Phantom-приёмка owner, policy rotation/post-approval recovery |
| Coupon execution | Isolated candidate: атомарные transfer/state/EntitlementReceipt, replay guard, точные recipient/vault deltas | Default-off; owner payout acceptance и негативные Phantom-сценарии |
| Reconciliation/receipt | Coupon Cash Leg CONFIRMED, Asset Leg NOT_APPLICABLE, MATCHED; canonical JSON/hash и ActionReceipt PDA, audited download | Redemption Cash+Asset/burn reconciliation, general reindex; фактический браузерный файл download не подтверждён прежним UI стендом |
| Early redemption | Draft/schedule/snapshot/math/review существуют | Атомарный payment + частичный burn + redemption record; 20% → burn 2/4/1, supply 35→28 |
| Maturity redemption | Draft/schedule/snapshot/math/review существуют | Clock maturity + principal/final coupon + atomic burn + record + REDEEMED при supply 0 |
| Recovery | Сохранённые UUID/signature, signed confirmation-only, unknown states, CAS/uniqueness, audit rollback | Durable workers, general restart/reindex, unavailable-history recovery и stale-attempt operator tooling |
| Operator UI | Семь разделов, responsive layout, текущий шаг, state-safe navigation/session recovery, фильтры/sort/paging, protected Transactions/Audit | Полная приёмка с настоящими Administrator/Auditor/Phantom и RPC outages; native zoom/reduced-motion проверки |
| Monitoring | Отдельный Telegram watchdog: health/RPC/aggregate reads, hourly/incident/recovery; начальное получение исторически подтверждено | Supervised startup, metrics/p95, backup/restore drills и fault acceptance |
| Delivery | Lockfiles, 19 миграций, CI secrets/repository/Rust/database/proxy checks, документация и ADR | SBF/validator CI, JS lint/format, видео и полный submission evidence package |

SIMULATED относится к synthetic eligibility и стоимости KZT-Test. Транзакции Token-2022 в disposable validator настоящие для этого Localnet, но не являются реальными денежными платежами или публичным Devnet proof. Public Devnet отложен по [ADR-014](decisions/ADR-014-local-mvp-before-public-network.md); mainnet, реальные активы, KASE/CSD/банковская интеграция и реальный KYC исключены.

## Текущее сохранённое окружение

Read-only PostgreSQL проверен 2026-10-10 в 15:55 UTC с `SET TRANSACTION READ ONLY`. Применены 19 миграций; сохранены ACTIVE instrument и отдельный DRAFT. Купон `464a832a-2c55-4e22-bb7a-6be93b429c78`: `UNDER_REVIEW`, version 6, eligible holders 3, total `1750000000` minor units (1750 KZT-Test); три Entitlement имеют `CALCULATED`. Upgrade maintenance — `VERIFIED`. Settlement и ActionReceipt rows отсутствуют. Funding остаётся `PREPARED` без подписи; CALCULATION_FINALIZE — `UNKNOWN_CONFIRMATION`. Также имеется историческая UNKNOWN mint-setup попытка: её нельзя считать выполненной или автоматически отправлять заново.

Owner API `127.0.0.1:4000` и owner RPC `127.0.0.1:8899` в ходе аудита недоступны. Поэтому сохранённые SQL projections **не выданы за свежий finalized-chain read-back**. Исторически принят обновлённый registration program 344640 bytes/hash `62562a…`, EXTEND/UPGRADE, RESET и три REGISTER; см. [owner record](testing/owner-entitlements-2026-10-09.md). Последний исторический Action PDA — CALCULATED, registered=3, processed=0. Новый coupon artifact не устанавливался на owner, подписи/переводы/отправки/recovery transitions там не выполнялись.

Публичные [API live](https://lifecyclekase-api.onrender.com/api/v1/health/live), [API ready](https://lifecyclekase-api.onrender.com/api/v1/health/ready), [web live](https://lifecyclekase-web.onrender.com/health/live) и [dashboard](https://lifecyclekase-web.onrender.com/dashboard) вернули HTTP 200. Неаутентифицированные instruments/investors/corporate-actions вернули 401; первый cold instruments запрос истёк, повторный вернул 401. `/api/v1/transactions` вернул 404: доступность нового journal API в staging не подтверждена. Это подтверждает доступность процесса/БД/страницы и наблюдаемые access responses, но не SHA, связь с owner RPC или финансовое исполнение. Render-коннектор не имел выбранного workspace; без подтверждённого workspace deployed SHA, deploy logs и metrics в этой проверке не подтверждены. Старые deploy IDs/SHA остаются датированными наблюдениями в [staging record](deployment/render-staging.md).

## Проверки 10 октября

| Проверка | Фактический результат |
| --- | --- |
| `npm run check` | PASS: schema/types/docs и 295 Node tests: API 117, web 55, domain 27, client 49, root 47 |
| `npm run build` | PASS: API/web/domain/client production builds |
| `npm run test:web:proxy` | PASS: production Origin/body/cookies, известные routes и unknown-route isolation |
| Root `npm audit --omit=dev` | 0 vulnerabilities |
| Isolated integration-tool audit | 12 advisories: 5 high, 7 moderate; исключены из deployed root graph. Несовместимые автоматические downgrade/major fixes не применялись |
| Rustfmt, host tests, Clippy | PASS для Localnet и Devnet feature profiles; по 12 тестов в каждом профиле. Два запуска одной логики не считаются 24 разными тестами |
| PostgreSQL | 19 миграций на отдельном временном контейнере; guard SQL и persistence/registry/action/upgrade HTTP/database suites PASS |
| `docker compose config --quiet` | PASS |
| Gitleaks 8.30.1 history | PASS: 74 commits scanned, redacted output |
| Isolated SBF build | PASS: 526624 bytes, SHA-256 `ccc5ebe7841a43fc22f8c687557264f22025a35840ebf1aae10b820df3d84295`, совпадает с coupon-v2; owner artifacts сохранены |
| Real validator + HTTP/PostgreSQL coupon | PASS: полный выпуск/snapshot/funding/registration/approval/reserve → 500/1000/250 payments → MATCHED legs → canonical ActionReceipt; роли/Origin/receiver/wire/replay/recovery/audit rollback |
| Retained → current candidate loader/maintenance | PASS на отдельном validator: combined EXTEND/UPGRADE rollback, separate EXTEND preservation, failed UPGRADE recovery, durable PostgreSQL lock/audit/recovery, verified new hash и прежний Action PDA byte-for-byte |
| Full retained → candidate runtime regression | PASS (exit 0) после исправления stale-slot в стенде: issuance/action/snapshot/REGISTER/RESET/FINALIZE, separate approval, two-action reserve isolation, refund/re-reserve, SOL/authority/replay и incomplete 34/35 coverage |
| Owner SQL preservation | Повторный read-only запрос после isolated acceptance: проверенные projections/attempt status/counts совпадают с исходным запросом |

Свежая купонная проверка выполнена на отдельном validator RPC port 19048 и новом временном PostgreSQL контейнере, с candidate `localnet-candidate-audit-20261010`. Disposable genesis `F5Sw1Na6GuUdDyYJS2SqU3hGmrVqmTYz68EiaQho1hG9`, action `7c6d05dd-cce8-4d5b-9eaf-d0a484acd943`; итоговый receipt SHA-256 `2d7af6d05d69ca927fbb3c61c3e1c4449de48f50950076e5cd8dd76dcb18ed62`, finalized signature `4kihKBUc3AHwsMBMpXesRGTg1A8QKzXtt7vbmR6ZAiD4Zj8oZPe2Y71g9pXL4Qso5TpK8eVCcjmhSF9cbW8jtU5V`. Прежняя [coupon acceptance](testing/coupon-execution-2026-10-10.md) сохраняет собственные signatures/условия. Это Localnet evidence без публичного Explorer; validator/test database удалены штатным harness cleanup. UI fixture/screenshots доказывают controls/layout/recovery, но не подпись Phantom или выплату на owner.

`npm run test:database` использует контейнер `docker compose exec postgres`, а не значение DATABASE_URL. В этом аудите тот же `test/database-guards.sql` выполнен через `docker exec -i lifecycle-audit-20261010 psql` на новом пустом контейнере с отдельным портом. Остальные suites создают и удаляют собственные тестовые базы. Owner database/ledger не сбрасывались.

Дополнительная проверка retained 290136-byte program → current 526624-byte candidate выполнена на disposable RPC port 19058. Первое выполнение остановилось на настройке подключения `::1:55432`; это не успешная программа/БД-проверка. Повторный запуск с новым isolated PostgreSQL контейнером и явно переданным через WSLENV `UPGRADE_TEST_DATABASE_URL` подтвердил раздельные loader phases, maintenance rollback/recovery, hash `ccc5ebe…` и сохранение существующего SNAPSHOT_CREATED Action PDA. Команда в upgrade runbook исправлена; прежние owner artifacts сохраняют исходные SHA-256 `cd502c…` и `62562a…`.

Этот расширенный runtime-прогон затем остановился в direct approval test: сохранённый до schedule transaction slot 1554 уже был удалён validator (`getBlockTime`, -32001, first available block 1572). Loader/maintenance/calculation assertions до этой точки прошли, но весь тот прогон не считается PASS. В `tools/solana-integration/test-action-approval.mjs` после подтверждения schedule теперь заново читается finalized slot. Это минимальное исправление стенда; business/API/program logic и owner ledger не изменены. Повторный **полный** retained→candidate runtime-прогон завершился exit 0: прошли проблемный second-action snapshot, reserve isolation, refund/re-reserve/approval/replay и финальная проверка 34/35 coverage. Ранее успешная HTTP/PostgreSQL coupon acceptance остаётся отдельной проверкой. Оба созданных для аудита PostgreSQL контейнера остановлены; temporary ledgers/test databases очищены самим harness.

## Публикация и документация

Накопленный пакет source/tests/CI/UI/screenshots/Markdown опубликован в ветке `codex/full-project-audit-20261010`, [draft PR №1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1). Исходный implementation/audit commit `fbd98ca0a890ab8a9c4581bf214c26051e21bacb` прошёл все три jobs в [CI run 38066186634](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38066186634). Последующие документальные read-back результаты добавляются в ту же ветку; checks для актуального PR head отображаются в PR. Master/Render и сохранённый on-chain program этим PR не обновлены.

Синхронизированы README приложения/пакетов/program, implementation matrix, architecture/data-flow/persistence, security/testing, toolchain, owner upgrade и Render runbooks, KASE checklist и delivery priorities. Добавлены этот аудит, SECURITY и CONTRIBUTING. Старые результаты и утверждения в датированных continuation records сохранены с указанием их исторического характера; approved requirements и pinned owner manifest не изменены. Publishable source scan и `git diff --check` прошли; Git-ignored local artifacts не включены в PR. Автоматическая проверка запретила cleanup временной ignored-копии публикуемых исходников (`blocked by policy`); копия оставлена локально и не включена в Git.

## Приоритеты реализации и приёмки

1. **P0 — восстановить доступность сохранённого API/RPC и выполнить read-only сверку.** Проверить genesis, program hash/authority, Action/Entitlement PDA, оригинальные signature/history, mint supply, treasury и SQL/audit. Разрешить held FINALIZE только через проверенный recovery по сохранённой подписи; новый owner signing требует отдельного решения владельца. Не заменять UNKNOWN успехом или автоматическим resend.
2. **P0 — закончить owner coupon acceptance.** Отдельно review совместимого нового candidate/upgrade, separate approver, funding, reserve, approval, три выплаты и canonical receipt. Каждый gate требует exact finalized transaction + account/token delta + database/legs/audit. Проверить недостаток средств, replay, изменённые bytes, revoke/pause, lost-response, partial settlement и reload.
3. **P0 — реализовать early redemption и maturity redemption.** Для каждого holder одна атомарная transaction: validated current bond accounts + controlled Permanent Delegate burn + payment + record/replay guard. При post-snapshot transfer/недостатке bond tokens или treasury обе ноги откатываются. Затем API/UI/receipt/reconciliation и canonical 35→28→0 supply сценарий. Нельзя ограничиться формулой или обычным переводом средств.
4. **P1 — durable execution/reindex и операционная устойчивость.** Restart recovery, backoff, missing history, reconcile/reindex, supervisable watcher, backup/restore, RPC degradation и SLA/p95 evidence. Существующие ExecutionJob таблицы не доказывают наличие работающего worker.
5. **P1 — registry и API completeness.** Issuer-scoped evidence, investor correction/suspend lifecycle и transfer-after-snapshot blocking exceptions. Добавить отсутствующие instrument detail/holders/timeline/reconcile, snapshot canonical, entitlement detail/retry, operations и reconciliation interfaces по реальным сценариям. Действующие route names отличаются от схемы ТЗ; сохранить совместимость и явно документировать contract mapping. Полное разделение issuer/compliance/maker/checker ролей и enforced transfer restrictions относятся к развитию после MVP по Product Requirements §22, а не к основанию объявить обязательный финансовый сценарий неготовым.
6. **P1 — воспроизводимая приёмка.** Чистый seed/reset/validate, full three-action demo без ручных DB/account edits, browser Administrator/Auditor/Phantom suite, SBF/real validator в CI и замена vulnerable legacy harness. Browser-only client validation не заменяет API/program guards.
7. **P2 — публикационный пакет.** Demo video, перечень фактически принятых signatures/PDAs, понятные install/config/recovery инструкции. Public Devnet — следующий согласованный этап после Localnet MVP; license выбирает владелец, не аудитор. Добавлены [SECURITY](../SECURITY.md) и [CONTRIBUTING](../CONTRIBUTING.md) entrypoints; они дополняют security/testing/runbooks.

## Решения и ограничения

Сохранены архитектура, backend payloads, подписываемые bytes и pinned owner manifest. Новый финансовый код остаётся opt-in/default-off. Аудит не добавляет бизнес-функции, не устанавливает worker/service, не меняет роли в базе, не сбрасывает ledger, не подписывает и не разворачивает контракт. Накопленные проверенные source/tests/CI/README/Markdown публикуются вместе; ignored local credentials, generated artifacts, ledgers и logs исключены. ADR-022/023/024 объясняют maintenance/custody/coupon решения; нового архитектурного решения сам аудит не требует.

Полный MVP можно объявить готовым только после coupon, early и maturity сквозных сценариев с независимым finalized proof и согласованными Cash/Asset Legs/receipts. HTTP 200, зелёный CI и красивые экраны этих критериев не заменяют.
