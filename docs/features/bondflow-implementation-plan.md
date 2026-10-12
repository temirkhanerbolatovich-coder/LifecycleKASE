# KASE BondFlow: аудит ТЗ и порядок реализации

Дата: **2026-10-11**. Исходный код до изменений: `8368d68`, ветка `codex/full-project-audit-20261010`; рабочее дерево было чистым. Цель — выполнить [новое ТЗ BondFlow](../requirements/KASE_BondFlow_TZ.md) на основе существующего LifecycleKASE.

Это план расширения прототипа. ТЗ задаёт продуктовые требования; оно не доказывает реализацию, официальный статус KASE или требования организатора. Прежняя [конкурсная матрица](../submission/KASE_REQUIREMENTS_MATRIX.md) и новый BondFlow P0 имеют разные границы приёмки. Название проекта, развёрнутые сервисы и сохранённый owner ledger этим этапом не меняются.

Продолжение **2026-10-12**: [exact-target v2](exact-target-redemption.md) реализован как Localnet-кандидат в domain/API/UI/client/persistence/Anchor. Migration **21** добавляет immutable policy/target и защищает exact terms; legacy v1 не пересчитывается. Три новых instruction и отдельный 50-byte Target PDA сохраняют прежние account layouts; решение закреплено в [ADR-029](../decisions/ADR-029-exact-target-redemption.md). Возобновлённая приёмка завершена в **04:39:13 Asia/Qyzylorda**: 498 Node-тестов, production build, два Rust-профиля по 25 тестов и полный свежий disposable сценарий прошли. Сохранены четыре canonical receipt, runtime/log, source/SBF/IDL hashes; добавлена offline-проверка пакета с 37 тестами. Фактические результаты и границы — в [датированной записи](../testing/bondflow-exact-redemption-2026-10-12.md). Следующий протокольный этап — controlled transfers/capture и резервирование назначенных units; owner/hosted rollout и Devnet execution остаются отдельными.

## Основной вывод

Следующее продолжение **2026-10-12** добавляет [controlled-registry protocol/client](controlled-registry.md): новый instrument v2/default-frozen mint, контролируемый transfer, locked raw capture и резервирование только назначенных units. Старые account layouts и exact-action v2 сохраняются; модель выбрана в [ADR-030](../decisions/ADR-030-controlled-registry-and-unit-reservations.md). Свежая приёмка завершена в **05:46:40 Asia/Qyzylorda**: 63 finalized транзакции, 35 ожидаемых preflight/simulation отклонений, supply 35 → 27 и полный совместимый legacy-прогон до supply 0; 521 Node-тест и два Rust-профиля по 28 тестов прошли. Проверки и граница API/DB/UI интеграции фиксируются в [отчёте этапа](../testing/controlled-registry-2026-10-12.md). Это ещё не hosted/owner/Devnet rollout.

Уже существуют реестр инвесторов с несколькими кошельками, immutable snapshot-v2, целочисленные расчёты, согласование и полный резерв, атомарные Token-2022 выплаты/burn, сохранённые попытки, finalized reconciliation, квитанции и RU/EN операторский интерфейс. Все три финансовых сценария имеют [датированную изолированную Localnet-приёмку](../testing/kase-three-actions-2026-10-10.md). Этот документ сверяет текущий source и сохранённые доказательства; повторного chain-прогона в ходе анализа нет.

Текущий этап **2026-10-12** подключает controlled instrument v2 к API/PostgreSQL/UI: versioned issuance, сохранённые capture begin/record/reserve/finish, immutable raw evidence, assigned-unit settlement и новые canonical receipts. Migration **22** сохраняет legacy policy; новая capability по умолчанию выключена. 640 Node-тест, типы, Prisma, production build и production proxy прошли. Полная disposable v2 runtime-приёмка завершена в **14:19:06 Asia/Qyzylorda**: HTTP issuance и coupon → percentage partial → exact partial → maturity, supply **35 → 35 → 28 → 20 → 0**, PostgreSQL со всеми 22 migrations и четыре canonical receipt. Проверены recovery исходной signature после finalized burn и закрытия source account, затем неизменность исторических квитанций при supply 0. Сохранены [runtime, receipts и fingerprints](../testing/evidence/controlled-workflow-2026-10-12/README.md); все 29 executed source/helper hashes совпали с диском при упаковке восстановленного runtime. Последующее усиление browser receipt verifier и повторная проверка сохранённых receipts учитываются отдельно от financial runtime. [Отчёт интеграции](../testing/controlled-workflow-integration-2026-10-12.md) и [ADR-031](../decisions/ADR-031-controlled-workflow-integration.md) фиксируют результаты и границы. Normal 64-tick run исключает отдельный legacy zero/mixed coupon prelude; его прежняя приёмка не выдаётся за новую.

Новый P0 целиком не закрыт: controlled capture и assigned-unit settlement приняты на disposable Localnet. Последующий [операторский этап](../testing/operator-continuation-2026-10-12.md) реализовал six-step master, JSON/CSV export, complete overview и default-off submitted-signature worker: 684 Node-теста, production build/proxy и disposable PostgreSQL со всеми 23 migrations прошли. DB fixtures проверяют worker leases/fencing/rollback и 10 000 actions + 10 000 investors; новый worker ещё не принят на свежем chain recovery, authenticated financial exports не повторены. Scalable capture, Devnet execution, отдельные final-coupon obligations и дополнительные UX проверки остаются открыты. Exact-target partial allocation имеет отдельную и интегрированную приёмку. Переделывать существующее исполнение с нуля не требуется.

## Модели, зафиксированные аудитом

| Модель | Текущий контракт | Разрыв нового ТЗ |
| --- | --- | --- |
| Ownership | Investor → несколько проверенных wallets → несколько Token-2022 accounts; экономический расчёт по инвестору | Кандидат v2 использует минимальный ASCII base58 owner из положительных snapshot sources инвестора; последующий payment receiver не влияет на tie |
| Record-date | Planned `record_at` открывает capture window; права определяет actual finalized slot/time; v2 блокирует движение при raw capture | Controlled capture принят на disposable Localnet; historical reconstruction и scalable capture отсутствуют, legacy mint остаётся unrestricted |
| Settlement | KZT-Test, полный action reserve, отдельный approver, атомарная выплата на одного получателя; итог после finalized read-back | Реальные KZT, банковские/KYC интеграции отсутствуют; Devnet financial acceptance отсутствует |
| Redemption authority | Instrument PDA — PermanentDelegate; immutable burn sources, payment и burn атомарны; v2 default-frozen mint допускает controlled transfers и резервирует назначенные units | Legacy mint не получает ограничений v2; general holder/operator transfer UI и reservation reversal остаются открыты |
| Recovery | Exact prepared bytes, durable attempts, исходная signature, explicit reconciliation; неизвестный результат не отправляется повторно | Default-off restart-safe submitted-signature worker реализован с DB/unit приёмкой; свежий chain recovery, general execution/reindex и sweeper пропущенных окон ещё нужны |
| Finality | `finalized`, проверка точного сообщения, accounts, payment/burn history и totals | Public Devnet необходимо проверить отдельно; `APPROVED` и signature не означают settlement |

См. [snapshot ADR](../decisions/ADR-002-record-date-snapshot.md), [redemption ADR](../decisions/ADR-025-atomic-redemption.md), [entitlements](entitlements-and-review.md), [reserve](action-approval-and-reserve.md), [redemption](redemption-execution-and-receipts.md).

## Матрица нового P0

Статус «есть» означает текущий source или явно датированное доказательство. Он не означает fresh runtime acceptance этого изменения.

| ТЗ | Статус | Доказательство / условие закрытия |
| --- | --- | --- |
| §3: серверная и программная авторизация | Есть основа | Общий session gate перепроверяет актуальный operator wallet; issuer/approver/signature проверки есть. Полная ролевая и issuer-scoped матрица остаётся P1/отдельным security этапом |
| §5–6: инструмент, держатели, несколько wallets | Есть основа | Registry, instrument drafts, snapshot aggregation; поля day-count/schedule/versioned economic terms и часть карточек требуется расширить |
| §7: immutable canonical snapshot и supply reconciliation | Есть | snapshot-v2 и hash/relational integrity; источник и actual slot/time сохраняются |
| §7: controlled transfers и capture lock | Protocol и application приняты на disposable Localnet | Новый default-frozen mint, transfer/capture и assigned-unit reservations прошли protocol runtime; HTTP issuance/locked capture/settlement подключены к PostgreSQL/UI и прошли [четыре действия](../testing/controlled-workflow-integration-2026-10-12.md). General holder/operator transfer UI, scalable capture и public rollout остаются открыты |
| §8.1: полугодовой coupon и per-investor floor | Есть | TS/Rust integer vectors; 10/20/5 → 500/1000/250 KZT-Test |
| §8.1: theoretical total, aggregate residual, tax disclosure | Первый этап | Read-only `couponSummary` и RU/EN представление, описанные ниже |
| §8.1: arbitrary day-count convention | Открыто | Сейчас фиксированная payments-per-year формула; неподдерживаемые периоды нельзя выдавать за Actual/365 |
| §8.2: atomic maturity payment/burn | Принят на disposable Localnet | Legacy и controlled v2 maturity проверены: cash/burn legs, reservations, supply 0, canonical receipt и closed-source recovery через исходную signature. [Интегрированная приёмка](../testing/controlled-workflow-integration-2026-10-12.md); Devnet и owner acceptance отдельно |
| §8.2: final coupon отдельным обязательством без period replay | Частично | v1 объединяет principal и final coupon; для period-level uniqueness нужен версионированный контракт |
| §8.3: exact-target largest remainder | Принят на disposable Localnet v2 | Explicit integer target, immutable snapshot-owner tie, global TS/Anchor validation, migration 21 и API/UI. Controlled application резервирует и исполняет назначенные units; exact 8 из 28 дал 2/5/1 и supply 20. При 1/1/1 и target 1 назначается 1/0/0; legacy percentage v1 сохраняется. [Формула и ограничения](../testing/bondflow-exact-redemption-2026-10-12.md), [интеграция](../testing/controlled-workflow-integration-2026-10-12.md) |
| §8–9: мастер и состояния | Реализован; synthetic browser принят | [Six-step master](operator-action-master.md) сохраняет mounted forms/signatures/history и существующие signing controls; production fixture acceptance не заменяет human wallet/usability |
| §10: повторное исполнение запрещено | Принят на disposable Localnet | Entitlement PDA/replay guard, DB attempts, exact-wire и repeated-submit/payment проверки прошли controlled application runtime; Devnet отдельно |
| §10: RPC timeout → reconciliation | Принят interactive workflow на disposable Localnet | Исходная операция/signature сохраняется при missing history и rollback; closed-source recovery принят. Default-off original-signature observer реализован; fresh chain worker recovery, general execution/reindex остаются открыты |
| §10: проверяемые Devnet результаты | Открыто | API settlement сейчас Localnet-only; Devnet build/идентичность не заменяют deployment/execution |
| §11: totals, очередь, финансирование | Реализованы полные DB aggregates; финансирование частично | [Complete overview](operator-overview.md) читает полный реестр и asset totals; unknown amounts не заменяются нулём. Disposable 10 000-record fixture принят; live financing/fee facts остаются отдельно |
| §14: JSON/CSV evidence | Реализован; API/browser helper tests | [Evidence export](action-evidence-export.md) сохраняет original canonical bytes, captured terms/obligations/unresolved rows, hashes и reversible CSV. Stored evidence без live RPC; fresh authenticated financial downloads ещё не приняты |
| §15–19: Quiet Capital, responsive и accessibility | Частично | Зелёный responsive workspace и RU/EN есть; полный UI kit, AA/keyboard/zoom/reduced-motion matrix не закрыты |
| §20: локализация | Частично | RU/EN есть; KK и полная проверка терминов/дат ещё нужны |
| §21: durable worker | Реализован ограниченный observer; DB/unit принят | [Worker](durable-reconciliation.md) наблюдает исходные submitted payment/finalization signatures, leases/fencing/atomic audit; не подписывает/не отправляет. Fresh chain recovery, general execution/reindex и missed-window sweeper открыты |
| §22: измеренные performance/10 000 registry records | Synthetic DB fixture принят | [Operator checkpoint](../testing/operator-continuation-2026-10-12.md): 10 000 actions + 10 000 investors; overview 198.71 ms, first/next pages 26.40/37.34 ms, search 36.75 ms в одном local run. Не percentile/capacity/chain benchmark |
| §23: five-user usability 4/5 | Открыто | Expert browser QA не является исследованием пяти новых пользователей |
| §24–26: три evidence сценария и demo | Частично | Четыре controlled Localnet HTTP prepare → sign → submit → confirm сценария и canonical receipts приняты с independent browser validators; read-only Auditor video есть. Human wallet operator demo и Devnet evidence остаются открыты |

## Первый интегрированный этап: прозрачный купонный расчёт

GET `/api/v1/corporate-actions/:id/entitlements` получает дополнительное read-only поле `couponSummary`. Оно равно `null` до расчёта и для redemption. Для купона содержит фактический rounded total, точные рациональные theoretical total/rounding residual, `FLOOR_PER_INVESTOR`, `TREASURY`, `NOT_IMPLEMENTED` tax treatment.

Источник — сохранённые `calculationInputs` и entitlements. Сервер заново проверяет формулу/версию, balance, amount, remainder/denominator, coverage и aggregate total. Текущие редактируемые условия инструмента не должны подменять captured inputs. Повреждённый расчёт возвращает явную ошибку, не приблизительную сводку.

Связь величин: `theoreticalTotal = sum(rounded amounts) + sum(remainders / denominator)`. Денежные величины остаются bigint/rational; плавающая точка не используется. Остаток означает невыплаченную разницу начисления, а не результат чтения текущего treasury balance или реально зачисленный отдельный платёж. Налоговая надпись: «До удержаний; налоговый модуль не реализован».

Это metadata вне существующих on-chain commitments. Не меняются stored inputs, `integer-entitlements-v1`, canonical receipt JSON/hash, payouts, schema, ABI или программа. Поэтому изменение не требует миграции ledger или установки новой программы.

Приёмка этапа:

- fixture 10/20/5 → rounded 1750 KZT-Test, theoretical 1750, residual 0;
- mixed zero/positive и fractional minor-unit rows → точное равенство суммы, без перераспределения остатка;
- zero-total расчёт имеет явную нулевую сводку; отсутствие расчёта даёт `null`;
- неподдерживаемая/повреждённая сохранённая формула и расходящиеся totals отклоняются;
- RU/EN отображают суммы, treasury policy и tax boundary; длинные числа не ломают mobile layout;
- QA использует ту же арифметику и сохраняет обозначение Simulation;
- tests, typechecks, production build и doc links проходят; fresh chain/DB execution для read-only metadata не заявляется.

## Пройденные и следующие проверяемые этапы

1. **Localnet-приёмка exact-target завершена; rollout отдельно.** v2 интегрирован в TS/API/UI/persistence/Anchor; explicit positive target и price задают новое действие. Global finalization проверяет `Σ assigned = target` и `assigned ≤ position`, остатки и tie по immutable snapshot owner. Domain percentage helper остаётся preview; v2 scheduling принимает только явный объём, без процентного параметра. Общие TS/Rust vectors покрывают ties, permutation invariance, zero/full/overflow, а protocol отвергает zero target. Свежий disposable сценарий прошёл coupon, legacy 20%, exact 8 из оставшихся 28 и maturity: `35 → 28 → 20 → 0`. Неверный план 3/4/1 с той же суммой отклонён; корректный 2/5/1 и reset проверены. [Запись приёмки](../testing/bondflow-exact-redemption-2026-10-12.md) содержит runtime и canonical receipts; owner/hosted rollout требует отдельной проверки и не является следующим протокольным шагом.
2. **Controlled protocol и интеграция API/DB/UI приняты на disposable Localnet.** [ADR-030](../decisions/ADR-030-controlled-registry-and-unit-reservations.md) выбирает новый default-frozen mint и per-account reserved counters. [Протокол/client](controlled-registry.md) добавляет controlled transfer, freeze/capture/resume, блокировку только назначенных units и проверки прямых Token-2022 обходов. [Protocol runtime](../testing/controlled-registry-2026-10-12.md) и последующая [HTTP/PostgreSQL/browser приёмка](../testing/controlled-workflow-integration-2026-10-12.md) сохраняются отдельно. Bootstrap/capture/reservation/execution подключены к saved prepare/sign/submit/confirm, исходной signature и atomic projection/audit; coupon, percentage/exact partial и maturity завершены. General holder/operator transfer UI и масштабирование требуют отдельных этапов.
3. **Versioned obligations и durable orchestration.** Отделить final coupon от principal и закрепить period-level idempotency. Durable jobs, restart/reconciliation, pause unsent recipients, full-reserve/finality policies, missed-window handling. При неизвестном результате проверять исходную signature/PDA до rebuild.
4. **Human wallet acceptance, затем согласованный Devnet rollout.** Controlled HTTP/PostgreSQL/browser-validator приёмка завершена на disposable инфраструктуре. Реальная Phantom approval/recovery, mobile keyboard и operator demo остаются отдельными. Для Devnet нужны reviewed deployment IDs/genesis/mints, public funding и реальная wallet prepare/sign/finalized reconciliation. Не отключать Localnet-only guard ради демонстрации. Сохранённая owner-среда — отдельный rollout.
5. **UI kit и six-step master.** Existing components/state сохранения использовать как основу; action route, URL filters/back, autosave, readiness, ясные network/execution/settlement badges, contextual CTA. Инструменты/инвесторы/transactions/evidence затем привести к единой композиции.
6. **Evidence и приёмка продукта.** JSON/CSV verification, отдельный созревший fixture, supply/cash reconciliation, 3–5-минутное operator demo, keyboard/mobile/200% zoom/contrast/reduced motion, 10 000 registry benchmark, five-user usability 4/5. Каждая проверка сохраняет source revision, среду, время и результат.

P1/P2 не должны задерживать эти P0 этапы. Календарная оценка не назначается до проверки нового protocol scope/toolchain и согласованного объёма runtime/UX приёмки.

## Проверки текущего этапа

Первый coupon-summary этап и его ограничения сохранены в [записи 2026-10-11](../testing/bondflow-coupon-summary-2026-10-11.md). Проверки exact-target продолжения — в [записи 2026-10-12](../testing/bondflow-exact-redemption-2026-10-12.md); controlled protocol/client и повторный legacy-прогон — в [отдельном отчёте](../testing/controlled-registry-2026-10-12.md). Текущая application integration имеет [завершённую четырёхсценарную приёмку](../testing/controlled-workflow-integration-2026-10-12.md), [canonical receipts и fingerprints](../testing/evidence/controlled-workflow-2026-10-12/README.md). Старые tests/build/deployment counts из других документов не относятся к новой итерации.
