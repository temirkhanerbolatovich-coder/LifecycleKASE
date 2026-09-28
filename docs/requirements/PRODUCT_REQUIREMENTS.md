# LifecycleKASE — окончательное техническое задание на MVP

Версия: 1.0
Дата: 28 сентября 2026
Статус: утверждённая основа для разработки MVP
Контекст: KASE Side Track / Superteam Kazakhstan

## 1. Назначение документа

Документ определяет обязательное поведение MVP Corporate Action Engine for Tokenized Securities on Solana. Он заменяет предыдущие черновики ТЗ в части противоречащих или неоднозначных требований.

Подробная реализация, интерфейсы, модель данных, Solana accounts, безопасность и тестирование описаны в [TECHNICAL_REQUIREMENTS.md](TECHNICAL_REQUIREMENTS.md).

## 2. Продукт и цель MVP

LifecycleKASE — B2B-платформа для управления корпоративными действиями после выпуска токенизированной ценной бумаги.

Основной инструмент MVP — токенизированная облигация. Основной пользователь — администратор инструмента: биржа, эмитент, депозитарий, transfer agent или оператор токенизированной инфраструктуры.

MVP должен доказать работоспособность следующего процесса:

```text
Tokenized Bond
    ↓
On-chain Ownership
    ↓
Record Date and Finalized Snapshot
    ↓
Eligibility and Entitlement Calculation
    ↓
On-chain Settlement
    ↓
Burn / Redemption
    ↓
Verifiable Corporate Action Record
```

Ключевой результат MVP: администратор может воспроизводимо провести coupon payment, maturity redemption и early redemption, а независимый проверяющий может подтвердить исходные данные, расчёт и результат через интерфейс, API и Solana Explorer.

## 3. Пользователи и роли

### 3.1. Administrator

Авторизованный administrator может:

- создавать инструмент и корпоративные действия;
- распределять demo bond tokens;
- формировать и подтверждать snapshot;
- запускать расчёт entitlements;
- подтверждать settlement и redemption;
- завершать или отменять допустимые действия;
- просматривать audit trail и blockchain evidence.

Авторизация в UI не заменяет on-chain authority checks.

### 3.2. Viewer

Viewer может просматривать инструменты, snapshots, расчёты, транзакции и audit trail, но не может изменять состояние.

### 3.3. Investor

Investor идентифицируется связкой:

- внутренний Investor ID;
- Solana wallet address;
- один или несколько token accounts.

Личный кабинет инвестора, реальный KYC и самостоятельное подписание операций инвестором не входят в MVP.

## 4. Границы MVP

### 4.1. Обязательно реализовать

- tokenized bond на Solana Devnet;
- тестовый settlement token;
- три зарегистрированных demo-инвестора;
- holder registry из on-chain token accounts;
- record date как UTC timestamp;
- snapshot на finalized Solana slot;
- canonical snapshot и SHA-256 hash;
- coupon entitlement calculation;
- on-chain coupon settlement;
- maturity redemption;
- partial early redemption;
- controlled token burn;
- защита от повторного исполнения;
- on-chain corporate action и redemption records;
- audit trail и transaction history;
- web-интерфейс администратора;
- воспроизводимые тесты и demo flow.

### 4.2. Явно не входит в MVP

- production-интеграция с KASE;
- юридическая регистрация ценных бумаг;
- реальный KYC/AML provider;
- банковская интеграция, SWIFT и реальные USD/KZT;
- production custody;
- secondary trading, order book и exchange matching;
- автоматическое восстановление исторического snapshot после пропущенного record date;
- mobile application;
- mainnet deployment;
- NFT, DeFi и lending-функции;
- сложные bond conventions: floating rate, callable/puttable bonds, amortization schedule, day-count conventions и business-day calendars.

## 5. Канонический demo dataset

Все acceptance tests и demo-расчёты используют один согласованный набор данных.

### 5.1. Облигация

| Поле | Значение |
|---|---|
| Name | KASE Demo Bond 2026 |
| Ticker | KDB26 |
| Asset Type | BOND |
| Face Value | 1,000.00 USD-Test |
| Annual Coupon Rate | 10.00% / 1,000 bps |
| Coupon Frequency | SEMI_ANNUAL / 2 payments per year |
| Issue Date | 2026-01-01T00:00:00Z |
| Maturity Date | configurable demo timestamp |
| Total Supply | 35 bond tokens |
| Token Decimals | 0 |
| Network | Solana Devnet |
| Initial Status | ACTIVE |

`Total Supply = 35` является обязательным значением canonical demo. Это устраняет расхождение между supply, распределением и ожидаемым coupon. Другие значения допускаются вне canonical acceptance scenario.

### 5.2. Распределение

| Investor | Bond balance |
|---|---:|
| Investor A | 10 |
| Investor B | 20 |
| Investor C | 5 |
| Total | 35 |

После распределения issuer treasury не содержит KDB26. Сумма balances зарегистрированных holders должна равняться on-chain mint supply.

### 5.3. Settlement token

| Поле | Значение |
|---|---|
| Symbol | USD-Test |
| Decimals | 6 |
| Economic meaning | demo-only settlement asset |
| Real-world claim | отсутствует |

UI обязан постоянно обозначать USD-Test как тестовый токен без реального требования к USD.

## 6. Источники истины

### 6.1. Solana является источником истины для

- bond mint и total supply;
- token accounts и balances;
- settlement transfers;
- burn и уменьшения supply;
- on-chain corporate action state;
- snapshot commitment;
- entitlement execution receipts;
- redemption records;
- transaction signatures, slots и confirmation status.

### 6.2. PostgreSQL является источником истины для

- пользователей и ролей;
- investor profiles и связи wallet → investor;
- UI metadata;
- canonical snapshot dataset;
- расчётных пояснений;
- локального audit trail;
- индекса транзакций;
- кэшированных blockchain projections.

База данных не может объявить action или entitlement завершёнными, если соответствующее on-chain состояние не подтверждено.

## 7. Инструменты

### 7.1. Создание инструмента

Administrator задаёт:

- name;
- ticker;
- asset type;
- face value в minor units;
- currency;
- annual coupon rate в basis points;
- coupon frequency;
- issue date;
- maturity date;
- total supply.

После подтверждения система должна:

1. создать или связать Token-2022 mint;
2. проверить `decimals = 0`;
3. установить program PDA как permanent delegate bond mint;
4. выпустить ровно заявленный supply и распределить его holders;
5. безвозвратно отключить mint authority и freeze authority;
6. создать Instrument PDA после проверки supply, authorities и permanent delegate;
7. сохранить mint, program и transaction references;
8. установить `ACTIVE` только после finalized confirmation и supply reconciliation.

### 7.2. Статусы инструмента

```text
DRAFT
ACTIVE
MATURED
REDEEMED
CANCELLED
```

`REDEEMED` разрешён только когда circulating supply равен нулю и все redemption entitlements подтверждены.

## 8. Holder Registry

Holder Registry строится из всех token accounts bond mint и агрегирует balances по wallet.

Для каждого holder отображаются:

- Investor ID;
- wallet address;
- token accounts;
- balance в base units;
- percentage of current supply;
- registration status;
- eligibility status.

Требования:

- zero-balance accounts не считаются holders;
- несколько token accounts одного wallet агрегируются;
- duplicate wallet mappings запрещены;
- сумма balances должна совпадать с mint supply;
- неизвестный wallet отображается как `UNREGISTERED`;
- наличие `UNREGISTERED` holder блокирует финализацию snapshot;
- secondary transfers и transfer restrictions вне MVP.

## 9. Record Date и Snapshot

### 9.1. Record Date

Record date хранится как UTC timestamp `record_at`, а не как локальная календарная дата.

Snapshot разрешено создавать только когда:

- action имеет статус `SCHEDULED`;
- текущее время не раньше `record_at`;
- record date ещё не был пропущен;
- RPC вернул finalized context;
- все holders зарегистрированы;
- on-chain balances согласованы с mint supply.

MVP не поддерживает ретроактивное восстановление snapshot. Если snapshot не создан в допустимом временном окне, action получает `SNAPSHOT_MISSED` и требует создания нового action.

### 9.2. Snapshot content

Snapshot включает:

- schema version;
- action ID;
- instrument ID;
- cluster и genesis hash;
- mint address;
- record timestamp;
- finalized slot и block time;
- holder wallets;
- исходные token accounts;
- агрегированные balances;
- total holder balance;
- mint supply;
- creation timestamp.

### 9.3. Canonical representation

Canonical snapshot version `snapshot-v1` должен:

- использовать UTF-8;
- хранить amounts как decimal strings в base units;
- сортировать holders по wallet address;
- сортировать token accounts внутри holder по token-account address;
- запрещать необязательные поля и локализованные числа;
- хэшироваться как `SHA-256(canonical_bytes)`.

Canonical JSON доступен через API и скачивание из UI. Hash, slot, holder count и total balance фиксируются в CorporateAction PDA.

После on-chain регистрации snapshot становится `FINALIZED` и не изменяется. Любая корректировка создаёт новый action и новый snapshot.

## 10. Corporate Actions

### 10.1. Типы MVP

```text
COUPON_PAYMENT
BOND_REDEMPTION
EARLY_REDEMPTION
```

### 10.2. Статусы

```text
DRAFT
SCHEDULED
SNAPSHOT_CREATED
CALCULATED
READY_FOR_EXECUTION
PROCESSING
PARTIALLY_COMPLETED
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
SNAPSHOT_MISSED
CANCELLED
```

Отмена разрешена только до `SNAPSHOT_CREATED`. Повторное исполнение `COMPLETED` или `FAILED_FINAL` запрещено.

### 10.3. Общие поля

- Action ID;
- Instrument ID;
- Action Type;
- Record At;
- Execute At;
- Snapshot ID и hash;
- Status;
- Eligible Holders;
- Total Entitlement;
- Completed/Failed Entitlements;
- Settlement Type;
- Created/Executed timestamps;
- Blockchain transactions.

## 11. Финансовые расчёты

### 11.1. Представление значений

- денежные суммы — integer minor units;
- token balances — integer base units;
- rates — integer basis points;
- percentages early redemption — integer basis points;
- floating point запрещён в коде, API, базе и on-chain state.

### 11.2. Coupon

Для MVP применяется фиксированная demo convention без day-count adjustment:

```text
coupon_minor = floor(
  balance
  × face_value_minor
  × annual_coupon_rate_bps
  ÷ 10_000
  ÷ payments_per_year
)
```

Canonical result:

| Holder | Bonds | Coupon |
|---|---:|---:|
| Investor A | 10 | 500.00 USD-Test |
| Investor B | 20 | 1,000.00 USD-Test |
| Investor C | 5 | 250.00 USD-Test |
| Total | 35 | 1,750.00 USD-Test |

### 11.3. Maturity redemption

```text
principal_minor = balance × face_value_minor
total_minor = principal_minor + final_coupon_minor
```

Maturity redemption разрешён, когда on-chain clock достиг `maturity_at`. Для ускоренного demo используется отдельный инструмент с близким maturity timestamp; системное время не подменяется.

После settlement bond tokens holder сжигаются. Когда supply равен нулю, instrument становится `REDEEMED`.

### 11.4. Early redemption

```text
tokens_to_redeem = floor(balance × redemption_percentage_bps ÷ 10_000)
amount_minor = tokens_to_redeem × redemption_price_minor
```

Результат для каждого holder показывает исходный balance, процент, округление вниз, redeemed tokens, остаток и payment.

Если `tokens_to_redeem = 0`, entitlement получает `NOT_ELIGIBLE_ZERO_ROUNDING` и не исполняется.

## 12. Entitlements и исполнение

На каждого eligible holder создаётся один entitlement с уникальным ключом `(action_id, holder_wallet)`.

Entitlement содержит:

- snapshot balance;
- формулу и её параметры;
- amount в minor units;
- tokens to redeem;
- status;
- execution attempt count;
- settlement, burn и receipt references.

### 12.1. Atomic execution

Для каждого holder одна Solana transaction должна выполнять:

- coupon: settlement transfer + entitlement receipt update;
- redemption: settlement transfer + bond burn + redemption record + entitlement receipt update;
- early redemption: settlement transfer + partial burn + redemption record + entitlement receipt update.

Неуспешная transaction не изменяет on-chain state. Backend фиксирует ошибку и разрешает безопасный retry с тем же entitlement PDA.

### 12.2. Idempotency

- entitlement PDA уникален для action и holder;
- executed entitlement нельзя исполнить повторно;
- API execute требует `Idempotency-Key`;
- повтор с тем же ключом возвращает прежний результат;
- другой ключ для уже выполненного entitlement возвращает conflict;
- action становится `COMPLETED` только после подтверждения всех исполнимых entitlements.

## 13. Settlement modes

### 13.1. ON_CHAIN

Основной acceptance mode. Выплаты производятся USD-Test с program-controlled treasury на investor wallet.

Перед execution система показывает treasury balance, required amount, recipients, network и test-token warning.

### 13.2. SIMULATED_FIAT

Дополнительный демонстрационный режим. Он создаёт external settlement instruction и on-chain record, но не имитирует банковскую интеграцию.

Статусы обязаны содержать префикс `SIMULATED_`; значение `SETTLED` без маркировки запрещено.

SIMULATED_FIAT не используется для прохождения обязательного on-chain coupon acceptance test.

## 14. Web-интерфейс

Обязательные маршруты:

```text
/dashboard
/instruments
/instruments/new
/instruments/:id
/instruments/:id/holders
/corporate-actions
/corporate-actions/new
/corporate-actions/:id
/transactions
/audit
```

UI должен отвечать на шесть вопросов:

- WHAT — какое действие выполняется;
- WHO — кто авторизован и кто получает выплату;
- HOW MUCH — balance, formula и amount;
- WHY — record date, eligibility и rounding rule;
- STATUS — что уже подтверждено;
- PROOF — hash, signature, slot и Explorer link.

Обязательные состояния: loading, empty, validation error, wallet mismatch, insufficient treasury, transaction rejected, transaction pending, partial completion и retryable failure.

UI не показывает `COMPLETED`, пока on-chain confirmation не достигла требуемого commitment.

## 15. Audit и доказательства

Для каждого завершённого действия доступны:

- action ID;
- instrument и action type;
- record timestamp;
- snapshot ID, slot, hash и downloadable canonical JSON;
- entitlement list и calculation explanation;
- settlement type;
- transaction signatures;
- block slots и timestamps;
- burn amounts;
- final on-chain status;
- Solana Explorer links;
- actor и audit timestamps.

Audit log append-only на уровне приложения. Исправление ошибочной metadata создаёт новое audit event, а не перезаписывает историю.

## 16. Безопасность

- mutation endpoints доступны только Administrator;
- on-chain instructions проверяют instrument authority PDA;
- mint, token program, token accounts, holder, amount и action type проверяются явно;
- unknown holder блокирует snapshot;
- private keys, seed phrases и raw secret values не попадают в Git, UI, API responses и logs;
- server signer для demo хранится вне репозитория;
- production custody и mainnet требуют отдельного security review;
- все external input проверяются по type, format, range и allowed values;
- error messages не раскрывают secrets или внутренние stack traces.

## 17. Нефункциональные требования

### Performance

- dashboard initial data: p95 < 3 seconds;
- обычные database-backed API: p95 < 1 second;
- blockchain operations измеряются отдельно от confirmation time;
- списки поддерживают pagination.

### Reliability

- confirmed on-chain state можно повторно проиндексировать;
- временный RPC failure не превращается в business failure;
- transaction signature сохраняется до ожидания confirmation;
- reconciliation job обнаруживает расхождение database projection и chain state;
- повторный запуск worker безопасен.

### Auditability

Каждый критический переход должен восстанавливаться из database audit events и on-chain evidence.

## 18. Demo flow

1. Подключить authorized administrator wallet.
2. Открыть KDB26 и показать mint, supply 35, authority и Devnet.
3. Показать holders 10/20/5 и supply reconciliation.
4. Создать Coupon Action.
5. Дождаться record time и создать finalized snapshot.
6. Показать canonical JSON, slot и hash.
7. Рассчитать entitlements 500/1,000/250.
8. Выполнить три USD-Test выплаты.
9. Показать action `COMPLETED` и Explorer links.
10. Выполнить 20% early redemption и показать balances 8/16/4.
11. Показать atomic payment + partial burn + redemption record.
12. Выполнить maturity redemption оставшихся 28 bonds.
13. Показать atomic payment + full burn, нулевой supply и `REDEEMED`.
14. Показать audit trail и защиту от повторного execute.

## 19. Acceptance criteria

### 19.1. Общие

- приложение запускается по README в чистой среде;
- canonical seed создаёт instrument, tokens и три wallets;
- ни один обязательный экран не использует hardcoded business result;
- все real/simulated operations промаркированы;
- отсутствуют committed secrets;
- unit, integration, Anchor и end-to-end tests проходят.

### 19.2. Coupon

- snapshot создан на finalized slot;
- canonical JSON воспроизводит on-chain hash;
- holder balances равны 10/20/5;
- entitlements равны 500/1,000/250 USD-Test;
- total равен 1,750 USD-Test;
- каждый payment подтверждён on-chain;
- повторный execute не переводит токены повторно;
- action завершается только после трёх receipts.

### 19.3. Maturity redemption

- maturity проверяется по on-chain time;
- principal и final coupon рассчитаны integer arithmetic;
- payment, burn и redemption record атомарны для holder;
- повторное погашение невозможно;
- mint supply уменьшается на точное количество redeemed bonds;
- при нулевом supply instrument становится `REDEEMED`.

### 19.4. Early redemption

- percentage хранится в bps;
- tokens to redeem вычисляются через floor;
- payment соответствует redeemed tokens;
- сжигается только рассчитанная часть;
- остаток продолжает существовать;
- повторное исполнение невозможно;
- результат фиксируется on-chain.

## 20. Submission package

- working web application;
- source repository;
- reproducible README;
- architecture and data-flow overview;
- security model;
- testing instructions and results;
- Devnet program ID и mint addresses;
- минимум по одной проверяемой transaction для coupon, redemption и early redemption;
- demo video;
- таблица `Implemented / Simulated / Out of Scope`.

## 21. Definition of Done

MVP готов только если без ручного изменения database или on-chain accounts выполняется полный сценарий:

```text
Create or load bond
→ distribute 35 bond tokens
→ reconcile holders and supply
→ create action
→ finalize snapshot at record time
→ reproduce snapshot hash
→ calculate entitlements
→ execute on-chain settlement
→ verify receipt
→ execute early redemption
→ preserve remaining balance
→ execute maturity redemption for the remaining supply
→ atomically pay and burn
→ reject duplicate execution
→ inspect final audit trail and Explorer proofs
```

Наличие только UI, моков или заранее подготовленных transaction signatures не удовлетворяет Definition of Done.

## 22. Развитие после MVP

- transfer restrictions и on-chain allowlist;
- KYC/AML integration;
- production custody и multisig governance;
- Digital Tenge/KZT settlement;
- day-count conventions и calendars;
- batch/Merkle entitlements;
- dividends, voting, tender offers и conversions;
- production KASE integration;
- mainnet security audit и operational controls.

## 23. Внешние технические ссылки

Проверено 28 сентября 2026:

- [Solana tokenization](https://solana.com/docs/tokenization)
- [Token Extensions](https://solana.com/docs/tokens/extensions)
- [Burn Tokens](https://solana.com/docs/tokens/basics/burn-tokens)
- [Permanent Delegate](https://solana.com/docs/tokens/extensions/permanent-delegate)
- [Solana RPC getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts)
- [Solana frontend guide](https://solana.com/docs/frontend)
