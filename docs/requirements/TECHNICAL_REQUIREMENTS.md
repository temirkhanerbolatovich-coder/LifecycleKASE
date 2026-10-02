# LifecycleKASE — технические требования к разработке MVP

Версия: 1.3
Дата: 1 октября 2026
Статус: обязательная техническая спецификация
Продуктовые требования: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)

Приоритет выполнения с 01.10.2026: localhost web/API, локальная PostgreSQL и Solana validator; публичная Devnet отложена до одобрения MVP. Ссылки на Devnet ниже сохраняются как последующий acceptance gate. Локальная конфигурация должна быть явной и сохранять genesis/network, подписи, роли, finalized confirmation, replay protection и atomic pay/burn; нельзя отключать эти проверки ради демо. Snapshot HTTP/UI adapter принимает только Localnet или Devnet, требует соответствия cluster и wallet-network и выбирает Wallet Standard chain из проверенного серверного плана. Это не заменяет live Localnet acceptance. См. [ADR-014](../decisions/ADR-014-local-mvp-before-public-network.md).

Сравнительное основание версии 1.2: [исследование платформ и блокчейнов](../research/tokenized-securities-landscape-2026-09-30.md). Это целевая спецификация; наличие пункта здесь не означает его реализацию в текущем repository.

## 1. Цель и инженерные принципы

Система должна реализовать минимальный, воспроизводимый и проверяемый lifecycle tokenized bond на Solana Devnet.

Приоритеты:

1. корректная business logic;
2. безопасность полномочий;
3. атомарность исполнения одного entitlement;
4. idempotency и восстановление после ошибок;
5. проверяемое on-chain evidence;
6. прозрачный UX;
7. визуальная полировка.

Не допускаются скрытые моки, hardcoded результаты, float arithmetic и перевод локального статуса в `FINALIZED` до finalized blockchain confirmation, reconciliation и Action Receipt.

## 2. Зафиксированные архитектурные решения

### 2.1. Blockchain-first, не blockchain-only

Solana хранит ownership, execution receipts и критические commitments. PostgreSQL хранит workflow, metadata, canonical snapshot datasets и индекс on-chain состояния.

### 2.2. Custom Anchor program

Собственная программа оправдана требованиями к:

- corporate action state machine;
- authority checks;
- replay protection;
- snapshot commitment;
- entitlement receipts;
- controlled burn;
- redemption records.

### 2.3. Token standard

Bond и KZT-Test создаются через Token-2022. KZT-Test — `SIMULATED ASSET`, не выпущен Национальным Банком Казахстана.

Bond mint:

- `decimals = 0`;
- supply canonical demo = 35;
- permanent delegate = Instrument Authority PDA;
- mint authority безвозвратно отключается после выпуска 35 tokens;
- freeze authority отсутствует.

KZT-Test mint:

- `decimals = 6`;
- используется только на Devnet;
- treasury token account принадлежит administrator wallet;
- программа переводит settlement tokens через CPI только при наличии administrator signature.

Permanent delegate не получает доступ к SOL, KZT-Test или другим mint.

Порядок создания bond фиксирован:

1. клиент заранее вычисляет адрес будущего Instrument Authority PDA;
2. administrator создаёт Token-2022 mint с permanent delegate = этот PDA;
3. administrator mint-ит ровно 35 tokens и распределяет 10/20/5;
4. administrator отзывает mint authority;
5. `initialize_instrument` проверяет `mint_authority = None`, `freeze_authority = None`, supply 35, decimals 0 и ожидаемый permanent delegate;
6. после finalized confirmation и reconciliation инструмент становится `ACTIVE`.

### 2.4. Signing model

Production-like demo не хранит administrator private key на backend.

```text
Backend prepares transaction
→ UI displays exact effects
→ Administrator wallet signs
→ Transaction is submitted
→ Backend observes finalized result
→ Database projection is updated
```

Ephemeral local keypairs разрешены только в automated tests и seed scripts. Они не используются в публичном deployment.

### 2.5. Execution granularity

Одна transaction обслуживает один investor entitlement. Это обеспечивает idempotency, bounded account list и честный `PARTIALLY_SETTLED` для нескольких инвесторов.

### 2.6. Snapshot policy

Snapshot создаётся на актуальном finalized context slot. Ретроактивный snapshot по произвольному прошлому slot не поддерживается. В Devnet demo `record_at` открывает окно capture, а `snapshot.solana_slot` и `snapshot.block_time` задают **effective record point** для entitlement. Эти два времени не отождествляются. Строгое право на заранее заданную секунду `record_at` требует отдельного checkpoint/transfer control/исторического индексера и не заявляется в MVP. Обычный `getProgramAccounts` с `finalized` не является запросом состояния на произвольный прошлый slot. См. [ADR-002](../decisions/ADR-002-record-date-snapshot.md).

## 3. Технологический стек

### Frontend

- Next.js с TypeScript;
- Tailwind CSS;
- TanStack Query;
- `@solana/kit`;
- Wallet Standard discovery через Kit wallet plugin;
- `@solana/react` для React bindings;
- generated program client, совместимый с Anchor IDL.

Для нового приложения `@solana/web3.js` v1 и `@solana/wallet-adapter-*` не являются базовым выбором. Исключение допускается только при документированной несовместимости выбранной версии Anchor tooling.

### Backend

- Node.js LTS;
- NestJS;
- TypeScript strict mode;
- Prisma;
- PostgreSQL;
- Solana Kit RPC/client utilities.

### Blockchain

- Rust;
- Anchor;
- Token-2022;
- Program Derived Addresses;
- Solana Devnet и local validator для тестов.

### Tooling

- один package manager и lockfile;
- ESLint и formatter;
- Rustfmt и Clippy;
- Docker Compose для PostgreSQL и API;
- CI для lint, typecheck, unit, integration и Anchor tests.

Конкретные версии фиксируются lockfiles. Обновление major version выполняется отдельным изменением с полным test run.

## 4. Рекомендуемая структура repository

```text
apps/
  web/
  api/
programs/
  lifecycle_kase/
packages/
  domain/
  solana-client/
prisma/
  schema.prisma
  migrations/
scripts/
  seed-demo/
  verify-demo/
docs/
  architecture/
  decisions/
  security/
  testing/
  requirements/
```

`packages/domain` содержит только действительно общие enums, schemas и pure calculation functions. Infrastructure code не выносится в абстракции без второго реального потребителя.

## 5. Domain model

### 5.1. Instrument

Обязательные поля:

```text
id: UUID
issuer_id: UUID
name: string
ticker: string
asset_type: BOND
network: SOLANA_DEVNET
program_id: base58 pubkey
mint_address: base58 pubkey
issuer_authority: base58 pubkey
compliance_authority: base58 pubkey
corporate_action_authority: base58 pubkey
settlement_asset_id: UUID
transfers_enabled: boolean
whitelist_required: boolean
issuer_approval_required: boolean
freeze_enabled: boolean
face_value_minor: bigint
currency: KZT_TEST
settlement_decimals: 6
coupon_rate_bps: integer
payments_per_year: 1 | 2 | 4
issue_at: UTC timestamp
maturity_at: UTC timestamp
total_supply: bigint
circulating_supply: bigint
status: InstrumentStatus
```

Invariants:

- `face_value_minor > 0`;
- `0 <= coupon_rate_bps <= 100_000`;
- `issue_at < maturity_at`;
- `total_supply > 0`;
- `0 <= circulating_supply <= total_supply`;
- mint decimals равны 0;
- stored supply периодически сверяется с on-chain mint supply.

### 5.2. CorporateAction

```text
id: UUID
instrument_id: UUID
type: COUPON_PAYMENT | BOND_REDEMPTION | EARLY_REDEMPTION
intent: string
source_type: MANUAL | ISSUER_INSTRUCTION | EXCHANGE_EVENT | EXTERNAL_API | SYSTEM
source_reference: string nullable
source_document: string nullable
source_timestamp: UTC timestamp nullable
created_by_id: UUID
approved_by_id: UUID nullable
approved_at: UTC timestamp nullable
review_note: string nullable
record_at: UTC timestamp
execute_at: UTC timestamp
snapshot_id: UUID nullable
redemption_percentage_bps: integer nullable
redemption_price_minor: bigint nullable
status: CorporateActionStatus
eligible_holders: integer
total_entitlement_minor: bigint
processed_entitlements: integer
failed_entitlements: integer
settlement_type: ON_CHAIN | SIMULATED_FIAT
version: integer
```

Action-type validation:

- coupon запрещает redemption parameters;
- maturity redemption запрещает percentage и использует face value;
- early redemption требует `1..10_000` bps и positive redemption price;
- `record_at <= execute_at`;
- maturity redemption требует `execute_at >= maturity_at`.

### 5.3. Snapshot

```text
id: UUID
schema_version: snapshot-v2
instrument_id: UUID
corporate_action_id: UUID unique
record_at: UTC timestamp
network_genesis_hash: string
solana_slot: bigint
block_time: UTC timestamp
canonical_json: jsonb
snapshot_hash: 32-byte hex
investor_count: integer
wallet_count: integer
total_balance: bigint
mint_supply: bigint
status: PENDING_REGISTRATION | FINALIZED
```

Для `snapshot-v2` `record_at` — начало разрешённого demo-окна, `solana_slot`/`block_time` — effective record point. Договорный/legal record date для реальной бумаги не выводится автоматически из этих полей. Изменение смысла canonical полей требует новой версии схемы, а не тихой переинтерпретации старых hash.

### 5.4. Entitlement

```text
id: UUID
corporate_action_id: UUID
snapshot_investor_id: UUID
investor_id: UUID
settlement_wallet_address: active verified base58 pubkey
balance_at_record_date: bigint
amount_minor: bigint
tokens_to_redeem: bigint
status: CALCULATED | READY | PROCESSING | PAID | REDEEMED |
        NOT_ELIGIBLE_ZERO_ROUNDING | FAILED_RETRYABLE | FAILED_FINAL
execution_attempts: integer
onchain_pda: base58 pubkey
settlement_signature: string nullable
burn_signature: string nullable
last_error_code: string nullable
version: integer
```

Unique constraint: `(corporate_action_id, investor_id)`. Snapshot rows: SnapshotInvestor → SnapshotWallet → SnapshotTokenAccount. SettlementAsset, SettlementLeg и ActionReceipt — отдельные модели. Расчёт хранит `calculation_inputs`, `formula_version` и `eligibility_reason`.

### 5.5. Investor, Wallet и eligibility

`Investor` хранит стабильный ID, display name, `INDIVIDUAL|INSTITUTIONAL`, ISO country code, KYC status, eligibility status и lifecycle status. `Wallet` хранит address, network, owner Investor ID, `PENDING|ACTIVE|BLOCKED|REVOKED`, verified/revoked timestamps. Admin auth wallets могут иметь User ID без Investor ID; для holder registry требуется именно Investor ID.

Отзыв investor wallet — терминальный переход в `REVOKED` с фиксированным reason code, временем, actor/correlation audit и capture-window lock. Он не переписывает eligibility инвестора. Snapshot сохраняет баланс отозванного holder для сверки supply и исторического evidence, но current payout eligibility обязана отклонить wallet status, отличный от `ACTIVE`; автоматический перевод токенов не выполняется.

Eligibility Engine принимает snapshot investor row, статус инвестора на effective finalized snapshot slot, статус его wallets и параметры инструмента. Он возвращает decision, reason и версию правила. Только `ELIGIBLE` допускается к исполнению; `PENDING_REVIEW` и `SUSPENDED` требуют ручного разрешения или нового action. Проверка receiver wallet выполняется непосредственно перед payout, чтобы отзыв кошелька после snapshot не приводил к выплате на него. Это не меняет уже зафиксированный snapshot.

В demo дата eligibility трактуется как effective finalized snapshot slot/time (§2.6). Текущий mutable `Investor`/`Wallet` row не доказывает прошлый статус: до snapshot изменения registry замораживаются либо сохраняются append-only версии с effective time и actor. Wallet verification требует nonce-based доказательства контроля адреса; администраторский ввод адреса без подписи не делает его `verified`.

### 5.6. Settlement Legs и Action Receipt

Каждый settlement содержит ровно по одному CASH и ASSET leg. Для coupon ASSET leg имеет `NOT_APPLICABLE`; для redemption оба leg обязательны. После finalized transaction watcher записывает actual amount и signature для каждого leg. Переход в `SETTLED` допускается только после подтверждения всех required legs. Reconciliation сравнивает expected/actual, on-chain receipt и burn. `MISMATCH` блокирует `FINALIZED`.

Action Receipt содержит action, instrument, source, approval, snapshot hash/slot, список investor entitlements, leg statuses, reconciliation, signatures, timestamps и SHA-256 канонического JSON. Финальный JSON доступен в UI/API; PDF — необязательное расширение. On-chain Action Receipt PDA закрепляет итоговый hash, а per-entitlement receipt PDA остаётся защитой от повторной выплаты.

## 6. Financial calculation engine

Calculation functions являются pure functions и не обращаются к database, RPC или system clock.

```text
calculateCoupon(input): bigint
calculatePrincipal(input): bigint
calculateFinalCoupon(input): bigint
calculateEarlyRedemptionTokens(input): bigint
calculateEarlyRedemptionAmount(input): bigint
```

### 6.1. Numeric rules

- TypeScript использует `bigint`;
- PostgreSQL использует `BIGINT` для допустимых диапазонов MVP;
- Rust использует `u64` storage и `u128` intermediate arithmetic;
- каждое multiplication проверяется на overflow;
- division by zero невозможен через validation;
- API сериализует bigint как decimal string;
- frontend не преобразует amounts в JavaScript `number`.

### 6.2. Coupon

```text
numerator = balance
          × face_value_minor
          × coupon_rate_bps

denominator = 10_000 × payments_per_year

coupon_minor = floor(numerator ÷ denominator)
remainder = numerator mod denominator
```

UI показывает remainder, если он ненулевой. MVP не перераспределяет remainder между holders.

### 6.3. Principal

```text
principal_minor = balance × face_value_minor
```

### 6.4. Early redemption

```text
redeemed_tokens = floor(balance × percentage_bps ÷ 10_000)
amount_minor = redeemed_tokens × redemption_price_minor
remaining_tokens = balance - redeemed_tokens
```

## 7. Solana program

### 7.1. PDA seeds

UUID хранится как 16 bytes.

```text
Instrument PDA:
["instrument", instrument_uuid_bytes]

Instrument Authority PDA:
["instrument-authority", instrument_pda]

Corporate Action PDA:
["action", instrument_pda, action_uuid_bytes]

Entitlement PDA:
["entitlement", action_pda, investor_uuid_bytes]

Redemption Record PDA:
["redemption", action_pda, investor_uuid_bytes]

Action Receipt PDA:
["action-receipt", action_pda]
```

Seeds, bump и relationships проверяются Anchor account constraints.

### 7.2. Instrument account

```text
version
instrument_id
issuer_authority
compliance_authority
corporate_action_authority
bond_mint
settlement_mint
face_value_minor
coupon_rate_bps
payments_per_year
issue_at
maturity_at
total_supply
status
bump
authority_bump
```

### 7.3. CorporateAction account

```text
version
action_id
instrument
action_type
record_at
execute_at
snapshot_hash
snapshot_slot
investor_count
wallet_count
total_balance
total_amount_minor
registered_entitlements
processed_entitlements
status
created_at
completed_at
bump
```

### 7.4. Entitlement account

```text
version
action
investor_id
settlement_wallet
balance_at_record_date
amount_minor
tokens_to_redeem
status
executed_at
bump
```

### 7.5. Redemption record

```text
version
action
investor_id
tokens_redeemed
principal_minor
coupon_minor
total_minor
remaining_balance
executed_at
bump
```

### 7.6. Instructions

#### `initialize_instrument`

Проверяет administrator signer как текущую upgrade authority этой программы через связанный с ней ProgramData account, затем mint, decimals, Token-2022 program, supply и permanent delegate. Создаёт Instrument PDA. Для MVP administrator wallet и upgrade authority совпадают; отдельная issuer delegation требует нового authority design.

#### `activate_instrument`

Требует signer = `Instrument.issuer_authority` и статус `DEPLOYING`. Повторно проверяет bond mint, 0 decimals, fixed supply, отозванную mint authority, отсутствие freeze authority и permanent delegate = Instrument Authority PDA. Принимает 1–64 уникальных положительных Token-2022 holder accounts этого mint; их checked sum должна равняться supply. Только после этого переводит Instrument PDA в `ACTIVE`. Проверка verified wallet → Investor ID и finalized confirmation остаются обязательными задачами backend; on-chain сверка balances не доказывает KYC. См. [ADR-009](../decisions/ADR-009-instrument-activation.md).

#### `create_corporate_action`

Проверяет signer = `Instrument.issuer_authority`, статус инструмента `DEPLOYING | ACTIVE`, action type, будущие даты (`record_at >= Clock`, `record_at >= issue_at`, `record_at <= execute_at`) и action-specific parameters. Coupon запрещает redemption parameters и `execute_at > maturity_at`; maturity redemption запрещает redemption parameters и требует `execute_at >= maturity_at`; early redemption требует `1..10_000` bps, positive price и `execute_at < maturity_at`. Создаёт on-chain action в `SCHEDULED` с нулевыми snapshot fields/counters. Scheduling при `DEPLOYING` — только подготовка: snapshot и исполнение не разрешены до отдельной activation/reconciliation. Статус `DRAFT` существует только в database до подписания этой transaction.

#### `register_snapshot`

Принимает hash, slot, investor count, wallet count, total balance и mint supply.

Проверяет:

- signer = `Instrument.issuer_authority`, instrument = `ACTIVE`, action = `SCHEDULED` и action PDA принадлежит этому instrument;
- on-chain Clock в интервале `record_at..record_at + 300 секунд` (верхняя граница для demo); `SNAPSHOT_GRACE_SECONDS` backend не может быть больше 300;
- snapshot ещё не зарегистрирован, slot ненулевой и не больше текущего on-chain slot;
- investor count > 0, wallet count >= investor count, total balance > 0;
- total balance = переданный mint supply = текущий supply Token-2022 bond mint, supply не больше исходного;
- hash не равен нулю.

После instruction action = `SNAPSHOT_CREATED`. Hash изменить нельзя. Программа не доказывает `finalized` RPC context, block time, verified wallet mapping или preimage hash: backend проверяет их до подготовки transaction и после finalized confirmation сверяет PDA. См. [ADR-010](../decisions/ADR-010-snapshot-registration.md).

`record_at + 300` — только временная граница регистрации, **не** доказательство баланса ровно на `record_at`. Transaction preparation передаёт effective slot/time пользователю. До публичного API подтверждение обязано проверить подписанную transaction (program ID, discriminator, data, accounts, signer), finalized status и read-back PDA; одна signature без этих проверок не меняет статус БД.

#### `register_entitlement`

Создаёт entitlement PDA для инвестора.

Проверяет:

- action = SNAPSHOT_CREATED или CALCULATED;
- entitlement PDA ещё не существует;
- balance > 0;
- amount соответствует on-chain формуле для типа action;
- tokens to redeem соответствует формуле;
- cumulative counters не переполняются.

Первый успешно зарегистрированный entitlement переводит action из `SNAPSHOT_CREATED` в `CALCULATED`. Следующие entitlements добавляются только в `CALCULATED`.

#### `finalize_calculation`

Проверяет registered entitlement count, total balance и total amount. Переводит action в `UNDER_REVIEW`; исполнение требует последующего approval.

#### `approve_action`

Требует corporate action authority signer, `UNDER_REVIEW`, неизменный snapshot hash и совпадение рассчитанного total. Записывает approval commitment и переводит on-chain action в `APPROVED`. Backend записывает actor, timestamp и audit event. `reject` и `return` доступны только до on-chain approval; возврат сохраняет snapshot и требует повторной регистрации изменённых calculations до нового approval. Если перепроведение зарегистрированных entitlement PDAs невозможно без удаления, создаётся новый action; API не обещает in-place перезапись on-chain entitlement.

#### `execute_coupon`

В одной transaction:

1. проверяет administrator signer и treasury authority;
2. проверяет `APPROVED | EXECUTING | PARTIALLY_SETTLED`;
3. проверяет entitlement `READY`;
4. переводит KZT-Test через Token-2022 CPI;
5. устанавливает entitlement `PAID`;
6. увеличивает processed count;
7. устанавливает `PARTIALLY_SETTLED`, если обработана только часть entitlements; финальное завершение выполняет `finalize_action`.

#### `execute_redemption`

В одной transaction:

1. проверяет on-chain clock >= maturity;
2. переводит principal + final coupon;
3. выполняет `BurnChecked` bond tokens через Instrument Authority PDA;
4. создаёт Redemption Record PDA;
5. устанавливает entitlement `REDEEMED`;
6. обновляет counters.

Если snapshot balance и текущие source token accounts разошлись из-за transfer, on-chain исполнение должно fail-closed до payment; permanent delegate не вправе подменять source accounts на токены иного инвестора. Для нескольких wallets одного Investor ID transaction включает все выбранные token accounts и проверяет суммарный burn; превышение account/compute/size limits блокирует один атомарный entitlement и требует отдельного redesign, а не частичного pay/burn.

#### `execute_early_redemption`

Аналогично redemption, но сжигает только `tokens_to_redeem`; нулевое количество запрещено.

#### `finalize_action`

Разрешена только когда processed count равен числу исполнимых entitlements и все обязательные Cash/Asset Legs подтверждены. После сверки expected/actual записывает hash финального Action Receipt в Action Receipt PDA и устанавливает `FINALIZED` и timestamp. Backend сохраняет тот же canonical JSON/hash и проверяет finalized signature. Несовпадение блокирует финализацию.

Для полного redemption дополнительно проверяет mint supply = 0 и устанавливает instrument `REDEEMED`.

#### `cancel_action`

On-chain разрешена только из `SCHEDULED`, до snapshot, по подписи `Instrument.issuer_authority` и при совпадении action → instrument/PDA. Инструкция сохраняет terminal timestamp в `completed_at`; повторная отмена отклоняется. Database draft отменяется без blockchain transaction.

### 7.7. Program security checks

Каждая instruction проверяет:

- expected signer;
- program IDs;
- PDA seeds и bumps;
- account ownership;
- instrument/action relationship;
- mint и decimals;
- token account mint и authority;
- amount, balance и overflow;
- allowed state transition;
- replay protection;
- Clock timestamp;
- отсутствие duplicate mutable accounts.

### 7.8. Custom errors

```text
Unauthorized
InvalidInstrument
InvalidMint
InvalidTokenProgram
InvalidTokenDecimals
InvalidPermanentDelegate
InvalidActionType
InvalidActionState
InvalidStateTransition
RecordDateNotReached
SnapshotAlreadyRegistered
SnapshotNotRegistered
SnapshotSupplyMismatch
EntitlementAlreadyExists
EntitlementAlreadyProcessed
InvalidEntitlementAmount
InvalidRedemptionAmount
MaturityNotReached
InsufficientSettlementBalance
InsufficientBondBalance
ArithmeticOverflow
ActionNotComplete
DuplicateExecution
```

## 8. Corporate action state machine

```text
DRAFT ───────────────→ CANCELLED
  │
  ▼
SCHEDULED ───────────→ CANCELLED
  │
  ├── missed window ──→ SNAPSHOT_MISSED
  ▼
SNAPSHOT_CREATED
  ▼
CALCULATED
  ▼
UNDER_REVIEW ──→ REJECTED
  ├── return ──→ RETURNED_FOR_REVISION ──→ CALCULATED
  ▼
APPROVED
  ▼
EXECUTING
  ├── some complete ─→ PARTIALLY_SETTLED ─→ EXECUTING
  ├── retryable ─────→ FAILED_RETRYABLE ────→ EXECUTING
  ├── terminal ──────→ FAILED_FINAL
  └── all legs confirmed ──→ SETTLED ──→ RECONCILING ──→ FINALIZED
```

`DRAFT`, `SNAPSHOT_MISSED`, `FAILED_RETRYABLE` и `FAILED_FINAL` являются orchestration statuses в database. On-chain state использует только состояния, подтверждающие выполненные transitions. On-chain entitlement остаётся неизменённым, если transaction не была выполнена.

Переход выполняется через compare-and-set по `version`. Невалидный переход возвращает conflict и не изменяет состояние.

## 9. Backend architecture

### 9.1. Модули

```text
auth
users
issuers
investors
instruments
holders
snapshots
calculations
corporate-actions
entitlements
settlements
solana
transactions
audit
execution-jobs
```

### 9.2. Auth

MVP использует wallet challenge flow:

1. backend выдаёт random nonce с expiry;
2. wallet подписывает domain-bound message;
3. backend проверяет signature, nonce, origin и expiry;
4. nonce помечается использованным;
5. создаётся short-lived session в secure, HttpOnly, SameSite cookie.

Authorized administrator wallets задаются конфигурацией или seed data. Mutation endpoint повторно проверяет role.

Investor wallet verification использует отдельный challenge, связанный с Investor ID, wallet address, chain genesis hash, origin, nonce и expiry. Подпись проверяется до установки `verified_at`; nonce одноразовый. Admin может начать привязку, но не может объявить произвольный чужой wallet подтверждённым без доказательства контроля или документированной ручной процедуры с audit evidence.

### 9.3. Holder service

Holder service:

1. вызывает Token-2022 `getProgramAccounts` с mint filter и `withContext`;
2. использует `finalized` commitment;
3. проверяет returned context slot;
4. декодирует все token accounts;
5. исключает zero balance;
6. агрегирует balances по owner wallet;
7. связывает только verified wallets с investors и агрегирует по Investor ID;
8. сверяет сумму с mint supply.

Collector фиксирует effective slot и block time. `withContext` обеспечивает контекст ответа, но не запрос к произвольному историческому slot; `minContextSlot` не используется как подмена historical checkpoint. `block_time` должен быть не раньше planned `record_at` и не позже времени capture; verified wallet должен быть подтверждён не позже этого effective point. Иначе snapshot отклоняется. Текущие registry rows сами по себе не доказывают исторический статус на slot: до публичных mutation routes изменение registry в окне capture должно блокироваться или версионироваться. Если RPC не даёт полный согласованный набор accounts, операция fail-closed и не создаёт entitlement.

Запрещено использовать только `getTokenLargestAccounts`, потому что он не гарантирует полный registry.

### 9.4. Snapshot service

`createSnapshot(actionId)`:

1. блокирует action через database transaction/version;
2. проверяет time window и state;
3. получает registry на finalized context;
4. требует отсутствие unregistered wallets;
5. формирует `snapshot-v2` с Investor ID, eligibility, wallets, token accounts и агрегированными balances;
6. сериализует canonical bytes;
7. вычисляет SHA-256;
8. атомарно сохраняет snapshot, investor rows, wallet rows и raw token accounts в `PENDING_REGISTRATION`;
9. готовит `register_snapshot` transaction;
10. после wallet signature, finalized confirmation и проверки on-chain commitment переводит snapshot в `FINALIZED`; после этого payload и дочерние rows неизменяемы.

Окно snapshot задаётся `SNAPSHOT_GRACE_SECONDS`; default для demo — 300 секунд. Пропущенное окно не восстанавливается автоматически.

Для Devnet сначала сохраняется `PENDING_REGISTRATION`, затем из **этой же** canonical записи готовится unsigned instruction. Повторная попытка использует pending запись и новый blockhash, не перечитывает holders и не изменяет hash. В read-only audit выводятся оба времени: planned `record_at` и effective `block_time`; `snapshot-v2` не расширяется без новой версии canonical формата. Пока отдельная instruction для `SNAPSHOT_MISSED` не реализована, backend/UI фиксируют блокирующий missed-state только в orchestration и не имитируют on-chain terminal transition.

### 9.5. Transaction preparation

Backend возвращает:

- serialized unsigned transaction/message;
- recent blockhash и expiry;
- human-readable effects;
- required signer;
- network, program ID и mint addresses;
- expected balances before/after;
- idempotency reference.

Frontend проверяет network и connected wallet перед подписью.

Для `register_snapshot` backend возвращает проверенный instruction plan и сериализованную Solana v0 wire transaction с пустым signature slot issuer wallet. Это не означает submission или confirmation. Клиент обязан повторно показать hash, action, effective slot, issuer signer, program/mint, blockhash expiry и предупреждение о тестовом активе; stale transaction нельзя молча переподписать после expiry или record window.

### 9.6. Confirmation and reconciliation

- signature сохраняется сразу после отправки;
- `EXECUTING` не означает success;
- confirmation watcher ждёт `finalized`;
- timeout создаёт `UNKNOWN_CONFIRMATION`, а не `FAILED_FINAL`;
- watcher повторно проверяет signature и on-chain PDA;
- confirm endpoint принимает signature только после проверки program ID, instruction data, signer, accounts и ожидаемого изменения PDA/token balances;
- reconciliation job сравнивает database projection с chain state;
- подтверждённое on-chain исполнение восстанавливает projection после backend crash.

Snapshot confirmation переводит DB row в `FINALIZED` только после сопоставления finalized transaction с сохранённым hash/counts/slot и read-back action PDA. При timeout или RPC расхождении остаётся `PENDING_REGISTRATION`/`UNKNOWN_CONFIRMATION`, а повторная проверка не создаёт новый snapshot. Для redemption дополнительно сопоставляются source token accounts, burn, recipient settlement и отсутствие payout при failed burn.

## 10. REST API

Base path: `/api/v1`.

### 10.1. Общие правила

- JSON;
- UTC ISO-8601 timestamps;
- bigint передаётся decimal string;
- request validation на server side;
- `X-Correlation-ID` принимается или генерируется;
- ошибки имеют стабильный `code`, понятный `message` и correlation ID;
- internal stack traces не возвращаются;
- list endpoints поддерживают `cursor` и `limit`;
- mutation endpoints требуют authenticated administrator;
- execute endpoints требуют `Idempotency-Key`.

### 10.2. Auth

```text
POST /auth/challenge
POST /auth/verify
POST /auth/logout
GET  /auth/session
```

### 10.3. Instruments

```text
GET  /instruments
POST /instruments
GET  /instruments/:id
GET  /instruments/:id/holders
GET  /instruments/:id/timeline
POST /instruments/:id/deploy/prepare
POST /instruments/:id/deploy/confirm
POST /instruments/:id/reconcile
GET  /investors
POST /investors
GET  /investors/:id
POST /investors/:id/wallets
POST /investors/:id/wallets/:walletId/verify
POST /investors/:id/wallets/:walletId/revoke
```

`POST /instruments` создаёт database draft и не объявляет instrument on-chain. `deploy/prepare` возвращает последовательность wallet-signed transactions для mint, distribution, authority revocation и Instrument PDA. `deploy/confirm` проверяет каждую signature и итоговые authorities/supply.

### 10.4. Corporate actions

```text
GET  /corporate-actions
POST /corporate-actions
GET  /corporate-actions/:id
POST /corporate-actions/:id/schedule/prepare
POST /corporate-actions/:id/schedule/confirm
POST /corporate-actions/:id/snapshot/prepare
POST /corporate-actions/:id/snapshot/confirm
POST /corporate-actions/:id/calculate
POST /corporate-actions/:id/calculation/prepare
POST /corporate-actions/:id/calculation/confirm
POST /corporate-actions/:id/review/approve
POST /corporate-actions/:id/review/reject
POST /corporate-actions/:id/review/return
POST /corporate-actions/:id/execute/prepare
POST /corporate-actions/:id/execute/confirm
POST /corporate-actions/:id/finalize/prepare
POST /corporate-actions/:id/finalize/confirm
POST /corporate-actions/:id/cancel
GET  /corporate-actions/:id/receipt
GET  /corporate-actions/:id/reconciliation
```

`POST /corporate-actions` создаёт database draft с intent и source provenance. `schedule/prepare` создаёт on-chain action. `calculate` выполняет pure off-chain расчёт и сохраняет draft entitlements. `calculation/prepare` формирует transaction с `register_entitlement` instructions и `finalize_calculation`; при превышении transaction limits создаётся упорядоченная последовательность transactions. `calculation/confirm` проверяет entitlement PDAs и action counters до перехода database projection в `UNDER_REVIEW`. `review/approve`, `review/reject` и `review/return` требуют authenticated operator и сохраняют audit event. `execute` отклоняет action без approval.

`snapshot/prepare` возвращает `operationId`, planned `record_at` **и** effective slot/time, а также признак `DEMO_CAPTURE_SLOT`. Каждая подготовка сохраняет отдельную попытку с blockhash и `lastValidBlockHeight`; повторная подготовка pending snapshot получает новый blockhash, но не перечитывает balances. `snapshot/confirm` принимает `{ operationId, signature }`: signature обязана принадлежать именно сохранённому transaction message, а finalized transaction, signer, program/instruction/accounts и read-back Action PDA должны совпасть до атомарного перехода transaction → `FINALIZED`, snapshot → `FINALIZED`, action → `SNAPSHOT_CREATED`. Отсутствующая finalized transaction сохраняется как `UNKNOWN_CONFIRMATION`; одна signature не является доказательством успеха. Ошибка вне окна не запускает повторный capture в будущем. `execute/prepare` для redemption проверяет текущие bond source accounts, границы одной transaction и бюджет; mismatch даёт блокирующий conflict/exception, а не новый entitlement на свежих balances.

### 10.5. Entitlements

```text
GET  /corporate-actions/:id/entitlements
GET  /corporate-actions/:id/entitlements/:entitlementId
POST /corporate-actions/:id/entitlements/:entitlementId/retry/prepare
```

### 10.6. Evidence and operations

```text
GET /snapshots/:id
GET /snapshots/:id/canonical
GET /transactions
GET /transactions/:signature
GET /corporate-actions/:id/audit
GET /audit
GET /operations/:id
GET /health/live
GET /health/ready
```

`GET /snapshots/:id/canonical`, investor-level receipts и связь Investor ID ↔ wallet требуют authenticated Administrator/Auditor, проверки issuer scope и audit события скачивания. Публичные evidence endpoints могут отдавать только hash, slot, program ID и signatures без идентичности держателя.

### 10.7. Status codes

- `200/201/202` — success or accepted async confirmation;
- `400` — malformed input;
- `401` — unauthenticated;
- `403` — insufficient role or wrong wallet;
- `404` — entity not found;
- `409` — invalid state transition, duplicate or idempotency conflict;
- `422` — valid format but failed business validation;
- `502/503` — RPC or external infrastructure unavailable;
- `504` — confirmation timeout with unknown final state.

## 11. Database

### 11.1. Tables

```text
users
auth_challenges
sessions
issuers
investors
wallets
settlement_assets
instruments
corporate_actions
snapshots
snapshot_token_accounts
snapshot_investors
snapshot_wallets
entitlements
settlements
settlement_legs
action_receipts
blockchain_transactions
execution_jobs
idempotency_records
audit_logs
```

### 11.2. Required constraints

- unique normalized email where present;
- unique wallet address;
- unique instrument mint address;
- unique snapshot per corporate action;
- unique `(snapshot_id, investor_id)` and `(snapshot_investor_id, wallet_address)`;
- unique `(settlement_id, type)` for CASH/ASSET legs;
- unique `(corporate_action_id, entitlement_id, job_type)` for execution jobs; transaction attempts remain separate records;
- unique `(corporate_action_id, investor_id)` entitlement;
- unique blockchain signature;
- unique `(scope, idempotency_key)`;
- all foreign keys enforced;
- nonnegative balance/amount/supply checks;
- `record_at <= execute_at`;
- immutable finalized snapshot fields;
- запрет неаудированного изменения registry mappings/eligibility в окне capture; для будущих версий — append-only effective-time history;
- enum/check constraints aligned with domain states.

### 11.3. Indexes

- instruments by status and maturity;
- actions by instrument/status/record_at/execute_at;
- entitlements by action/status;
- transactions by action/signature/status;
- audit logs by entity and created_at;
- jobs by status/next_attempt_at.

### 11.4. Immutability

После `FINALIZED` application layer запрещает UPDATE snapshot и investor/wallet/token-account rows. Database triggers являются дополнительной защитой. Canonical JSON и hash изменяются только созданием нового snapshot для нового action.

### 11.5. Audit log

Audit row содержит:

```text
id
actor_id
actor_wallet
event
entity_type
entity_id
correlation_id
corporate_action_id nullable
blockchain_transaction_id nullable
metadata_json
created_at
```

Metadata не содержит private keys, raw sessions, full signed challenges или sensitive personal data.

## 12. Frontend

### 12.1. Routes

```text
/dashboard
/investors
/investors/[id]
/instruments
/instruments/new
/instruments/[id]
/instruments/[id]/holders
/corporate-actions
/corporate-actions/new
/corporate-actions/[id]
/corporate-actions/[id]/review
/corporate-actions/[id]/receipt
/transactions
/audit
```

### 12.2. Transaction confirmation UX

Перед подписью показываются:

- action и holder;
- exact token amounts;
- source/destination accounts;
- payment and burn effects;
- program ID, mint и network;
- test-token/simulation warning;
- current and expected state.

После подписи UI проходит состояния:

```text
AWAITING_SIGNATURE
SUBMITTED
CONFIRMING
FINALIZED
FAILED
UNKNOWN_CONFIRMATION
```

Закрытие страницы не должно терять operation; восстановление идёт по operation ID/signature.

На snapshot и receipt экранах различаются planned `record_at` и effective finalized slot/block time; `DEMO_CAPTURE_SLOT` и отсутствие строгого юридического cut-off видимы. При transfer между этими точками UI не утверждает, что новый holder владел токеном на `record_at`. Full canonical dataset и eligibility скрыты от публичного просмотра.

### 12.3. Calculation presentation

UI показывает integer inputs и человекочитаемое форматирование:

```text
10 bonds
× 1,000.00 KZT-Test
× 1,000 bps / 10,000
÷ 2
= 500.00 KZT-Test
```

### 12.4. Accessibility and responsiveness

- keyboard-accessible controls;
- visible focus states;
- semantic table headers;
- status conveyed by text, not only color;
- wallet addresses copyable and visually shortened без изменения полного value;
- desktop-first B2B layout с usable tablet mode.

## 13. Configuration and secrets

Required non-secret configuration:

```text
DATABASE_URL
FRONTEND_URL
SOLANA_RPC_URL
SOLANA_WS_URL
SOLANA_CLUSTER=devnet
SOLANA_GENESIS_HASH
PROGRAM_ID
BOND_MINT
SETTLEMENT_MINT
SNAPSHOT_GRACE_SECONDS=300
CONFIRMATION_TIMEOUT_SECONDS
AUTHORIZED_ADMIN_WALLETS
```

`DATABASE_URL` является secret в deployment environment, несмотря на присутствие в списке конфигурации.

Запрещённые переменные:

```text
TREASURY_PRIVATE_KEY
ADMIN_SEED_PHRASE
WALLET_MNEMONIC
```

Для automated tests используется `TEST_SIGNER_KEYPAIR_PATH` на временный файл вне Git. Public deployment использует external wallet signing.

Repository содержит `.env.example` только с placeholders.

## 14. Error handling

Ошибки разделяются на:

- validation;
- authorization;
- business rule;
- invalid state transition;
- insufficient balance;
- wallet rejection;
- RPC unavailable;
- transaction rejected;
- transaction timeout/unknown;
- database/infrastructure failure.

Примеры стабильных codes:

```text
SNAPSHOT_NOT_READY
SNAPSHOT_WINDOW_MISSED
SNAPSHOT_SUPPLY_MISMATCH
UNREGISTERED_HOLDER
ENTITLEMENT_NOT_CALCULATED
ENTITLEMENT_ALREADY_PROCESSED
INSUFFICIENT_SETTLEMENT_BALANCE
MATURITY_NOT_REACHED
WRONG_WALLET
WRONG_NETWORK
TRANSACTION_REJECTED
TRANSACTION_CONFIRMATION_UNKNOWN
INVALID_STATE_TRANSITION
IDEMPOTENCY_CONFLICT
```

Meaningful failures не проглатываются. Logs содержат correlation ID, entity IDs, action/entitlement IDs и error code, но не secrets.

## 15. Testing strategy

### 15.1. Domain unit tests

- canonical coupon 10/20/5;
- zero and maximum supported amounts;
- floor rounding and remainder;
- principal and final coupon;
- early redemption 20%;
- zero-rounding entitlement;
- overflow rejection;
- invalid rate/frequency/percentage;
- state transition matrix.

### 15.2. Snapshot tests

- deterministic canonical serialization;
- ordering independent of RPC result order;
- aggregation of multiple token accounts;
- zero account exclusion;
- duplicate wallet mapping rejection;
- unknown wallet rejection;
- supply mismatch rejection;
- hash reproduction from downloaded canonical JSON;
- snapshot window missed.
- transfer между `record_at` и capture: entitlement относится к effective slot, не подменяется историческим состоянием;
- registry edit во время capture блокируется/версионируется; unauthorized canonical download запрещён;
- подмена canonical JSON при прежнем hash, несовпадение finalized slot/block time и неподтверждённая signature отклоняются.

### 15.3. Anchor tests

- initialize instrument;
- reject wrong mint/decimals/permanent delegate;
- create action;
- register snapshot once;
- reject snapshot before record time;
- register deterministic entitlement;
- reject wrong calculation;
- coupon payment;
- duplicate coupon rejection;
- maturity enforcement;
- atomic redemption payment and burn;
- partial early redemption;
- insufficient treasury rollback;
- redemption after post-snapshot transfer не выплачивает и не сжигает чужие tokens;
- проверка нескольких wallets/token accounts одного инвестора и fail-closed при превышении transaction limits;
- wrong signer rejection;
- finalization only after all entitlements.

### 15.4. Backend integration tests

- wallet challenge replay/expiry;
- role authorization;
- API validation;
- database unique constraints;
- idempotency same-key replay;
- different-key conflict;
- RPC timeout;
- confirmation unknown then reconciliation success;
- worker restart safety;
- audit creation for every transition.
- snapshot confirmation требует finalized transaction + matching instruction + read-back PDA; timeout сохраняет unknown/pending;
- полный бюджет action проверяется до approval, а каждая выплата повторно защищена on-chain балансом;

### 15.5. Frontend tests

- loading/empty/error states;
- wallet connect/disconnect;
- wrong network/wallet;
- calculation rendering;
- rejected signature;
- transaction pending/finalized/unknown;
- partially completed action;
- Explorer link cluster;
- refresh/resume by operation ID.
- раздельное отображение planned/effective record point и блокирующего redemption exception;
- canonical snapshot нельзя скачать без нужной роли и issuer scope.

### 15.6. End-to-end acceptance

Automated или scripted test выполняет canonical demo от seed до coupon, early redemption, maturity redemption оставшегося supply, duplicate rejection и hash verification.

Тест сохраняет только public evidence: program ID, mint addresses, signatures, slots, hashes и statuses. Private keys не сохраняются в отчёте.

## 16. DevOps and deployment

### 16.1. Local environment

Docker Compose поднимает:

- PostgreSQL;
- API;
- optional local validator profile.

Web может запускаться отдельно для fast refresh.

### 16.2. Migrations and seed

- migrations применяются автоматически в CI test database;
- production-like environment использует отдельный explicit migration step;
- seed idempotent;
- canonical demo seed проверяет существующие addresses и не создаёт duplicate assets;
- destructive reseed доступен только для disposable local environment.

### 16.3. CI gates

```text
format check
lint
TypeScript typecheck
Rustfmt check
Clippy
unit tests
database integration tests
Anchor local-validator tests
frontend tests
build
secret scan
```

### 16.4. Health checks

`/health/live` проверяет process liveness.

`/health/ready` проверяет database и конфигурацию, но не должен зависеть от кратковременной доступности Devnet RPC настолько, чтобы вызвать restart loop. RPC health публикуется отдельным degraded status.

### 16.5. Observability

Минимальные metrics:

- API request count/latency/error rate;
- RPC latency/error rate;
- transaction confirmation duration;
- actions by status;
- entitlements pending/failed;
- reconciliation mismatches;
- execution retry count.

## 17. Security requirements

- threat model документируется до публичного demo;
- admin mutation требует session role и wallet signature;
- on-chain program независимо проверяет authority;
- transaction effects отображаются до подписи;
- RPC response считается untrusted input и валидируется;
- base58 addresses проверяются и нормализуются;
- API применяет body/query size limits;
- rate limit применяется к auth challenge и mutation endpoints;
- challenge nonce одноразовый и domain-bound;
- cookies Secure/HttpOnly/SameSite в deployed environment;
- CORS разрешает только configured frontend origin;
- SQL выполняется через Prisma parameterization;
- dependency и secret scans входят в CI;
- upgrade authority program и mint authorities перечисляются в Technical Overview;
- threat model отдельно покрывает право permanent delegate на burn/transfer из любого bond account, смену delegate, program upgrade, ошибочный snapshot hash и злоупотребление issuer signer;
- Investor ID, wallet mapping, KYC/eligibility и canonical dataset не публикуются без role/issuer-scope authorization; на chain не записываются имена, документы, KYC evidence и иной PII;
- администраторский UI не вправе объявлять direct Token-2022 transfer запрещённым, пока действующий on-chain контроль и его тесты не представлены;
- mainnet, реальные деньги и production custody блокируются отдельным release gate.

## 18. Документация

До Definition of Done repository содержит:

```text
README.md
docs/architecture/overview.md
docs/architecture/data-flow.md
docs/security/security-model.md
docs/testing/testing-strategy.md
docs/decisions/ADR-001-token-authority.md
docs/decisions/ADR-002-record-date-snapshot.md
docs/decisions/ADR-003-atomic-entitlement-execution.md
docs/decisions/ADR-004-source-of-truth.md
docs/decisions/ADR-006-investor-identity-and-action-control.md
docs/IMPLEMENTED_VS_SIMULATED.md
```

README включает requirements, setup, configuration, migrations, Solana deployment, seed, start, tests, demo и troubleshooting.

## 19. План разработки

### Milestone 0 — Decisions and scaffold

Owner: Tech Lead.
Acceptance: ADR по authority, snapshot, atomic execution, source of truth и investor identity утверждены; repository, CI и local validator test запускаются.

### Milestone 1 — Token and program core

Owner: Blockchain Developer.
Acceptance: Token-2022 bond/KZT-Test, Instrument PDA, Action PDA и authority tests работают локально.

### Milestone 2 — Registry and snapshot

Owner: Backend + Blockchain.
Acceptance: Investor Registry связывает wallets после proof-of-control, агрегирует 10/20/5 по Investor ID, supply reconciles to 35, canonical snapshot-v2 hash воспроизводится и регистрируется on-chain. UI/API показывают `record_at` как начало demo-окна и effective finalized slot/time как источник прав; finalized transaction и PDA проверены, а приватный dataset не открыт публично.

### Milestone 3 — Coupon vertical slice

Owner: Full team.
Acceptance: API и минимальный UI проводят review/approval после проверки полного бюджета action, затем 500/1,000/250 KZT-Test payments, показывают Cash/Asset Legs, Action Receipt и proofs, отвергают duplicate execution. Нехватка treasury не выдаётся за успешный settlement.

Это первый обязательный demo gate. До него не выполняется broad UI polishing.

### Milestone 4 — Maturity redemption

Owner: Backend + Blockchain.
Acceptance: atomic payment + burn + record; maturity and replay checks проходят. Transfer после snapshot, недостаток текущих source tokens или превышение transaction limits блокируют весь entitlement без payout.

### Milestone 5 — Early redemption

Owner: Backend + Blockchain.
Acceptance: 20% floor rule, partial burn, remaining balances и proof подтверждены.

### Milestone 6 — Complete operator UI

Owner: Frontend.
Acceptance: все маршруты, states, wallet signing, calculations, audit и transaction views работают без hardcoded results.

### Milestone 7 — Hardening and submission

Owner: Full team.
Acceptance: full CI, clean setup, Devnet evidence, demo video и Technical Overview готовы.

## 20. Technical Definition of Done

- canonical demo поднимается по documented commands;
- database migrations и seed воспроизводимы;
- no committed secrets;
- build, lint, typecheck и tests проходят;
- Anchor program deployed to Devnet;
- bond и settlement mints проверяемы;
- snapshot hash воспроизводится из API artifact;
- planned `record_at` и effective finalized slot/time видимы и не смешиваются;
- coupon, redemption и early redemption имеют finalized signatures;
- approval обязателен перед execution и фиксируется в audit/on-chain state;
- Cash/Asset Legs подтверждены; reconciliation = MATCHED; финальный Action Receipt доступен в JSON;
- duplicate execution tests проходят;
- database projection совпадает с PDA и token balances;
- UI не содержит ложных completed/simulated states;
- README и required docs соответствуют фактической реализации;
- известные ограничения перечислены явно.

## 21. Известные ограничения MVP

- snapshot нельзя создать задним числом;
- secondary transfers не ограничиваются on-chain allowlist;
- permanent delegate является сильным полномочием и требует отдельной production governance;
- entitlement dataset доверяет authorized snapshot creator, хотя amounts дополнительно проверяются on-chain;
- per-holder transaction не оптимизирована для большого registry;
- Devnet не предоставляет production SLA;
- KZT-Test — SIMULATED ASSET без денежной стоимости; «Not issued by the National Bank of Kazakhstan»;
- текущий RPC capture не доказывает ownership ровно на заранее назначенную секунду `record_at`; права demo относятся к effective finalized slot;
- прямые transfers не ограничены on-chain и могут сделать redemption неисполнимым; такой entitlement блокируется, а не оплачивается частично;
- on-chain snapshot hash не доказывает идентичность investor и корректность off-chain preimage;
- Devnet demo не создаёт юридически действующую облигацию, KASE-аффилиацию или реальные платежи;
- fixed-period coupon formula не является полной bond-calculation library.

## 22. Post-MVP gates

Перед pilot/mainnet необходимы:

- legal/compliance review;
- назначение юридически авторитетного реестра, operator/transfer agent и paying agent для конкретного выпуска;
- строгий record-date checkpoint или доказуемый transfer-control/indexer механизм;
- защищённое хранение и выдача investor-level данных, сроки retention и процедура исправления споров;
- escrow/резервирование средств либо эквивалентный механизм гарантированного финансирования;
- external security audit Anchor program;
- multisig и upgrade governance;
- production custody design;
- transfer allowlist/ACL;
- archival/indexer strategy;
- Merkle/batch entitlement architecture;
- disaster recovery и key rotation;
- load, scalability и cost tests;
- monitoring, incident response и rollback plan.

## 23. Технические источники

Основные технические ссылки проверены 30 сентября 2026:

- [Solana tokenization and RWA workflow](https://solana.com/docs/tokenization)
- [Token Extensions](https://solana.com/docs/tokens/extensions)
- [Permanent Delegate](https://solana.com/docs/tokens/extensions/permanent-delegate)
- [Burn Tokens](https://solana.com/docs/tokens/basics/burn-tokens)
- [Calling Token Program via CPI](https://solana.com/docs/tokens/advanced/cpi)
- [Solana core transactions](https://solana.com/docs/core)
- [getProgramAccounts RPC](https://solana.com/docs/rpc/http/getprogramaccounts)
- [Anchor PDA constraints](https://www.anchor-lang.com/docs/basics/pda)
- [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints)
- [Solana frontend guide](https://solana.com/docs/frontend)
- `getProgramAccounts` с finalized context не предоставляет произвольный historical slot (ссылка выше)
- [Solana Token ACL](https://solana.com/docs/tokenization/token-acl) и [Permanent Delegate](https://solana.com/docs/tokens/extensions/permanent-delegate) — transfer control и authority boundaries
- [Polymesh Corporate Actions](https://developers.polymesh.network/corporate-actions/) и [Distributions](https://developers.polymesh.network/corporate-actions/distributions/) — checkpoint, funding и exception-сравнение
- [ERC-3643 Identity Registry](https://docs.erc3643.org/erc-3643/smart-contracts-library/onchain-identities/identity-registry) — идентичность отдельно от wallet
