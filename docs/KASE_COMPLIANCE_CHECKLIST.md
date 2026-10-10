# LifecycleKASE — чек-лист соответствия кейсу KASE

Актуальная инженерная проверка: [полный аудит 2026-10-10](PROJECT_AUDIT_2026-10-10.md). В новой проверке 295 Node-тестов; прежние результаты ниже относятся к своим итерациям. Coupon candidate реализован и проверяется отдельно от owner приёмки; early/maturity atomic execution отсутствует. Checklist сверяет предоставленные требования и реализацию, а не удостоверяет официальное одобрение KASE или юридическое соответствие.

Дата проверки: **10 октября 2026 года**. Источник требований — полный текст объявления, присланный пользователем в текущем чате. Редакция объявления, сроки и дополнительные правила организатора в этом тексте не указаны; актуальная страница кейса отдельно не проверялась.

Проверка относится к текущему локальному рабочему дереву, включая незакоммиченные изменения. Базовый commit: `27af655bc3b0354ad067778fed8ebd0e68c61a64`. Это чек-лист участника для подготовки прототипа, а не официальная оценка жюри. Баллы и процент готовности не выставляются.

**Основной вывод:** инструмент, реестр, расчёты и купонный путь уже имеют существенное подтверждение. Все три обязательных сквозных сценария пока не закрыты: исполнение погашения в срок и досрочного погашения отсутствует. Дополнительно нужно разрешить оговорку record date и собрать воспроизводимый пакет сдачи.

## Как читать статусы

- **✅ Подтверждено** — в указанной области есть код и подтверждающие проверки. Указанное окружение ограничивает этот статус.
- **◐ Частично** — часть требования реализована, но остаётся существенная оговорка или отсутствует полное демо.
- **☐ Открыто** — необходимого поведения ещё нет в проверенном коде либо обязательный артефакт ещё нужно подготовить.
- **? Не подтверждено** — данных недостаточно; это не утверждение, что требование нарушено.

Проверки Solana/HTTP/PostgreSQL ниже опираются на существующие датированные журналы acceptance. В этой проверке они не запускались повторно. `npm run check` выполнен заново; его результат приведён в конце.

## 1. Обязательные условия и минимальный прототип

| ID | Требование объявления | Статус LifecycleKASE | Подтверждение и условие закрытия |
| --- | --- | --- | --- |
| K01 | Команда официально зарегистрирована в основном хакатоне Colosseum | ? Не подтверждено | Нужны сведения о регистрации команды именно в основном хакатоне. Доступ к Arena/Copilot и наличие репозитория этого не доказывают. |
| K02 | Основные on-chain компоненты построены на Solana | ✅ Подтверждено | Anchor-программа, Token-2022, PDA инструмента/действия/snapshot/entitlement и купонных receipts; публичная сеть не развёрнута. |
| K03 | Есть тестовый токенизированный финансовый инструмент | ✅ Localnet | В журнале сохранённого owner-окружения принят LKA26R1: ACTIVE, 35 неделимых облигационных токенов, держатели 10/20/5. [Issuance acceptance](testing/localnet-instrument-acceptance.md). |
| K04 | Есть реестр держателей и идентификация eligible holders | ✅ В рамках демо | Связь инвестор → проверенные кошельки → Token-2022 balances, группировка и eligibility; неизвестный положительный holder блокирует snapshot. Реальный KYC не реализован. [Investor Registry](features/investor-registry.md). |
| K05 | Есть механизм record date | ◐ Частично | Работают запланированный `record_at`, окно захвата, finalized slot/time, неизменяемый snapshot и on-chain commitment. Владение на более ранний planned `record_at` не восстанавливается. Нужны точная политика cutoff и демонстрация переводов вокруг неё; подробнее ниже. |
| K06 | Entitlements рассчитываются функционально | ✅ Расчёты трёх типов | Integer arithmetic, coupon/principal/early redemption, округление и overflow checks, сохранённые входы/версии; TypeScript/Rust parity. [Domain contracts](testing/domain-contracts.md), [calculation/review](features/entitlements-and-review.md). |
| K07 | Купон: holders → entitlement → исполнение или показанный settlement flow → on-chain outcome | ✅ Изолированный E2E; ◐ единое пользовательское демо | Реальные Localnet Token-2022 выплаты 500/1000/250, receipts и reconciliation описаны в acceptance. Это проверка disposable candidate, а не выплата на сохранённом owner ledger; owner acceptance и повторяемое пользовательское демо остаются открыты. [Coupon acceptance](testing/coupon-execution-2026-10-10.md). |
| K08 | Погашение в срок: holders → principal → settlement → retirement токенов → on-chain outcome | ◐ Подготовка; ☐ исполнение | Тип действия, scheduling/snapshot и расчёт principal есть. Завершённого redemption settlement и burn/retire/lock/mark-redeemed пути нет. Проверить срок, final coupon при его наличии, прекращение обращения погашенных токенов и on-chain результат. |
| K09 | Хотя бы одно дополнительное корпоративное действие | ◐ Выбрано early/partial redemption; ☐ исполнение | Есть тип действия и расчёт частичного погашения. Нужно исполнить или явно инициировать settlement, погасить рассчитанную часть токенов и зафиксировать результат на Solana. Одного расчёта или SCHEDULE недостаточно для демонстрации действия. |
| K10 | Проверяемая on-chain запись результата | ✅ Для изолированного coupon; ◐ для полного набора | Coupon EntitlementReceipt и ActionReceipt PDA/hash реализованы. Для maturity и early redemption доказательств результата нет. Snapshot commitment подтверждает snapshot, а не состоявшееся погашение. |
| K11 | Entitlement logic и Solana corporate-action flow функциональны, даже если fiat rails simulated | ◐ Частично | Реальная логика и купонный chain flow есть. Два redemption flow ещё нужно завершить. Симуляция внешнего платёжного рельса не заменяет работающий Solana lifecycle. |

## 2. Что именно показать в трёх обязательных сценариях

Номинал демо — **1000 KZT-Test**, ставка — **10%**, частота — **2 выплаты в год**, начальные balances — **10/20/5**, supply — **35**. Это тестовые единицы; пример объявления в USD не требует реальной долларовой выплаты.

| Демо | Ожидаемый расчёт | Наблюдаемый результат для закрытия |
| --- | --- | --- |
| Coupon | `balance × 1000 × 10% / 2` → **500/1000/250**, всего **1750 KZT-Test** | Три показанных settlement результата, on-chain receipt и сверка получателей/сумм. Облигационные balances и supply остаются 10/20/5 и 35. Изолированная реализация уже имеет acceptance. |
| Maturity, независимый сценарий на 35 bonds | Principal **10000/20000/5000**, всего **35000 KZT-Test**, плюс final coupon, если он причитается по условиям | Проверка наступления maturity; settlement; все 35 токенов становятся погашенными через выбранный механизм; при принятом в проекте burn — supply 0 и Instrument REDEEMED; on-chain outcome. |
| Early redemption 20%, независимый сценарий | `floor(balance × 20%)` → **2/4/1 токена**; principal **2000/4000/1000**, всего **7000 KZT-Test** | Частичное погашение ровно 7 токенов, balances **8/16/4**, supply **28** при burn; остаток продолжает обращаться; settlement и on-chain outcome. |

Если показывается последовательный lifecycle **coupon → early → maturity**, maturity рассчитывается по оставшимся **28**, а не по исходным 35 токенам: principal **8000/16000/4000**, всего **28000 KZT-Test**. Final coupon рассчитывается отдельно по применимым условиям и record date. Не смешивать этот сценарий с независимым maturity на исходном supply.

### Проверки для каждого сценария

- [ ] Видны instrument, сеть/genesis, mint, action type, record date/cutoff и execution date.
- [ ] Держатели и balances взяты из зафиксированного snapshot; понятно, кто eligible и почему.
- [ ] Формула и единицы позволяют воспроизвести entitlement без ручной подмены результата.
- [ ] Показано исполнение либо конкретный settlement flow: сумма, получатель, состояние и результат. Надпись PREPARED или APPROVED сама по себе не доказывает settlement.
- [ ] Для погашений показано прекращение обращения соответствующих токенов: burn, retire, lock или иной фактический redeemed marker.
- [ ] Результат проверяется по Solana transaction/PDA и связан с конкретным action/snapshot/entitlement.
- [ ] Повторный запрос не приводит к повторной выплате или повторному погашению.
- [ ] В UI и техническом описании явно названы реальные on-chain операции и симулированные внешние интеграции.

Replay protection и связанные негативные проверки — инженерные критерии надёжности, выведенные из логики действий; объявление не задаёт их отдельным списком.

## 3. Оговорка record date

В объявлении требуется определить держателей **на указанную record date**. Текущий `DEMO_CAPTURE_SLOT` получает фактическое finalized состояние в окне после planned `record_at` (максимум 300 секунд) и отдельно сохраняет effective slot/block time. Это работающий snapshot, однако если токены переведены между planned временем и capture, состав держателей может измениться.

Код и документация прямо ограничивают это поведение: историческое восстановление ownership не поддерживается, а прямые token transfers не ограничены Transfer Hook. Неизменяемый hash не устраняет различие между planned датой и фактическим capture.

- [ ] Описать точное правило определения ownership cutoff и его связь с указанной record date.
- [ ] Показать перевод до cutoff, перевод после cutoff и попытку позднего capture.
- [ ] Подтвердить, что entitlements относятся к объявленному cutoff, либо явно назвать ограничение демонстрации. Если требуется точная историческая дата, реализовать соответствующую фиксацию/восстановление состояния; UI-переименование не закрывает эту потребность.
- [ ] Для redemption проверить перевод после snapshot: нельзя платить за токены, которые не удалось фактически погасить.

Источник: [snapshot flow](features/corporate-actions.md), [snapshot preparation](../apps/api/src/snapshot-candidate.ts), [snapshot registration decision](decisions/ADR-010-snapshot-registration.md).

## 4. Материалы сдачи

| Требование объявления | Статус | Что нужно для закрытия |
| --- | --- | --- |
| Working prototype | ◐ Частично | Одно воспроизводимое приложение/демо со всеми тремя обязательными действиями. Разрозненные журналы тестов не заменяют доступный прототип. |
| Demo video | ? Не подтверждено | В проверенном репозитории готовый видеоартефакт/ссылка не обнаружены. Подготовить видео, показывающее три сценария, формулы, settlement, redemption и on-chain evidence; внешний уже существующий ролик требует отдельной проверки. |
| Source code repository | ◐ Репозиторий есть; текущий пакет локален | Git remote указывает на [LifecycleKASE](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE). Купонный/UX пакет 10 октября содержит незакоммиченные и untracked файлы; выбранную сдаваемую версию нужно опубликовать и привязать к demo. Доступность репозитория жюри в этой проверке не проверялась. |
| Short technical overview | ◐ Материал для сборки есть | Архитектура, data flow, snapshots, расчёты, settlement и Solana описаны в отдельных документах. Собрать короткий submission overview вокруг фактической сдаваемой версии и всех трёх сценариев. |
| Implemented vs simulated | ✅ Документ есть; ◐ финальный пакет | [Implementation status](IMPLEMENTED_VS_SIMULATED.md) отделяет candidate/owner/staging и test money. Финальное видео и overview должны сохранять те же границы. |

### Состав короткого Technical Overview

- [ ] Архитектура: web → API → domain/Solana client → Anchor + Token-2022; роль PostgreSQL как workflow/projection.
- [ ] Record-date policy: planned дата, ownership cutoff, finalized slot/time, canonical snapshot/hash и ограничения истории.
- [ ] Формулы coupon/principal/partial redemption, decimals, rounding и final coupon.
- [ ] Settlement: что переведено on-chain, что инициировано/симулировано; получатели, reserve, подтверждение и failure/recovery.
- [ ] Redemption: какой механизм выводит токены из обращения и как исключается повторное погашение.
- [ ] Solana: сеть, program/mints, PDA, authority/signing и доказательства результата для каждого action.
- [ ] Воспроизведение: commit, setup, migrations, test data, команды, порядок демо и проверка outcome.

## 5. Критерии жюри

Вес критериев сохранён точно по присланному объявлению. В этой проверке баллы не присваиваются.

| Критерий | Вес | Что предоставить как доказательство | Текущий главный пробел |
| --- | --- | --- | --- |
| Technical Execution | **30%** | Запускаемый prototype, три функциональных flow, читаемый исходный код, воспроизводимые проверки и recovery | Два redemption execution flow и единое воспроизводимое демо |
| Corporate Action Logic | **25%** | Правильные holders/cutoff, formulas, settlement, token retirement и outcome | Record-date semantics, maturity/early settlement и retirement |
| Product & UX | **20%** | Понятный путь оператора, состояния/ошибки, signer/network/amount review и доступное evidence | UI обновлён; защищённая презентация проверена на synthetic данных, полное пользовательское execution демо ещё не принято |
| Real-World Applicability | **15%** | Объяснение issuer/operator/approver/auditor, границ реестра/chain/settlement, ошибок и возможной интеграции | Нужен связный краткий обзор; реальные KASE/CSD/bank интеграции не доказаны и не заявляются |
| Innovation | **10%** | Объяснение полезного подхода к автоматизации lifecycle и проверяемому результату | Сформулировать пользу snapshot → entitlement → settlement/retirement → receipt; объективная новизна относительно рынка здесь не исследовалась |

## 6. Приоритет закрытия

1. **Завершить maturity redemption.** Наблюдаемый результат: principal/применимый final coupon, settlement, фактическое погашение токенов и проверяемый Solana outcome. Учесть текущие token balances, недостаток средств, невозможность погашения и replay.
2. **Завершить early/partial redemption.** Наблюдаемый результат: 20%, 2/4/1 токена, точные суммы, остатки 8/16/4 и on-chain outcome; проверить округление до нуля и повторное исполнение.
3. **Уточнить и проверить record-date policy параллельно с этими сценариями.** Наблюдаемый результат: однозначный cutoff, тест transfers вокруг него и честная граница historical ownership.
4. **Собрать воспроизводимое демо всех трёх действий.** Отдельное disposable окружение допустимо для инженерного демо; любые изменения сохранённого owner ledger/program и owner подписи остаются отдельными управляемыми действиями. Сохранённый FINALIZE нельзя считать завершённым по тестам candidate.
5. **Подготовить пакет сдачи.** Подтверждение регистрации, demo video, конкретный опубликованный commit, короткий overview и consistent implemented/simulated evidence.

## 7. Что объявление не требует отдельно

Присланный текст требует Solana, но **не указывает обязательность Devnet или Mainnet**, конкретный Explorer, публичный хостинг, полную production эксплуатацию, реальные банковские выплаты, реальный KYC или интеграцию с KASE/CSD. Public Devnet полезен для независимо доступного доказательства, однако это дополнительная цель проекта, а не отдельное процитированное условие этого кейса.

Для redemption допустимы **burn, retire, lock или иной способ пометить токены погашенными**. Atomic payment + burn выбран внутренними требованиями LifecycleKASE как способ обеспечить надёжность; объявление допускает также явно показанную инициацию settlement. При таком варианте всё равно нужны functional entitlement logic, Solana corporate-action flow, фактический redemption mechanism и on-chain outcome.

UI polish, внешний аудит, multisig, production custody, monitoring, workers и market comparison могут улучшить качество решения, но не заменяют обязательные три сценария. Prize pool и места из объявления не являются требованиями к реализации.

## 8. Что проверено сейчас

- Просмотрены Git status/history/remote, текущие требования и implementation status, этапный checklist, архитектура, feature/acceptance документы.
- Просмотрены Anchor instruction surface, coupon execution API, persisted entitlement logic, snapshot preparation и TypeScript financial functions/tests. Coupon execute/finalize присутствуют; redemption execution в проверенной программе отсутствует.
- Повторно выполнен **`npm run check` — успешно**: scaffold, Markdown links/fences, Prisma schema validation, TypeScript typecheck и **294 теста** (API 117, web 54, domain 27, Solana client 49, root 47; failures 0).
- После добавления этого документа выполнены `npm run validate` и `git diff --check` для затронутой документации.
- Изолированные validator/HTTP/PostgreSQL проверки coupon, Rust/SBF build, браузерное execution демо, публичное развёртывание и live owner read-back **не повторялись**. Их существующие датированные результаты указаны как документальное evidence.
- Новых транзакций, подписи owner wallet, изменения ledger/database, публикации исходного кода или отправки заявки в рамках этой проверки не выполнялось.

Основные точки продолжения: [delivery checklist](deployment/DEVNET_TO_MVP_CHECKLIST.md), [coupon acceptance](testing/coupon-execution-2026-10-10.md), [owner entitlements](testing/owner-entitlements-2026-10-09.md), [implementation boundaries](IMPLEMENTED_VS_SIMULATED.md).
