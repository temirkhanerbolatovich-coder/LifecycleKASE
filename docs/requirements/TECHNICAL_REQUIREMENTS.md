# LifecycleKASE — технические требования к разработке MVP

Версия: 1.0
Дата: 28 сентября 2026
Статус: обязательная техническая спецификация
Продуктовые требования: [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)

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

Не допускаются скрытые моки, hardcoded результаты, float arithmetic и перевод локального статуса в `COMPLETED` до finalized blockchain confirmation.

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

Bond и USD-Test создаются через Token-2022.

Bond mint:

- `decimals = 0`;
- supply canonical demo = 35;
- permanent delegate = Instrument Authority PDA;
- mint authority безвозвратно отключается после выпуска 35 tokens;
- freeze authority отсутствует.

USD-Test mint:

- `decimals = 6`;
- используется только на Devnet;
- treasury token account принадлежит administrator wallet;
- программа переводит settlement tokens через CPI только при наличии administrator signature.

Permanent delegate не получает доступ к SOL, USD-Test или другим mint.

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

Одна transaction обслуживает один entitlement. Это обеспечивает понятную idempotency, bounded account list и честный `PARTIALLY_COMPLETED` для нескольких holders.

### 2.6. Snapshot policy

Snapshot создаётся на актуальном finalized context slot. Ретроактивный snapshot по произвольному прошлому slot не поддерживается.

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
authority_wallet: base58 pubkey
face_value_minor: bigint
currency: USD_TEST
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
schema_version: snapshot-v1
instrument_id: UUID
corporate_action_id: UUID unique
record_at: UTC timestamp
network_genesis_hash: string
solana_slot: bigint
block_time: UTC timestamp
canonical_json: jsonb
snapshot_hash: 32-byte hex
holder_count: integer
total_balance: bigint
mint_supply: bigint
status: FINALIZED
```

### 5.4. Entitlement

```text
id: UUID
corporate_action_id: UUID
snapshot_holder_id: UUID
holder_wallet: base58 pubkey
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

Unique constraint: `(corporate_action_id, holder_wallet)`.

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
["entitlement", action_pda, holder_wallet]

Redemption Record PDA:
["redemption", action_pda, holder_wallet]
```

Seeds, bump и relationships проверяются Anchor account constraints.

### 7.2. Instrument account

```text
version
instrument_id
authority_wallet
issuer_wallet
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
holder_count
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
holder
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
holder
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

Проверяет administrator signer, mint, decimals, Token-2022 program, supply и permanent delegate. Создаёт Instrument PDA.

#### `create_corporate_action`

Проверяет instrument authority, action type, dates и action-specific parameters. Создаёт on-chain action в `SCHEDULED`. Статус `DRAFT` существует только в database до подписания этой transaction.

#### `register_snapshot`

Принимает hash, slot, holder count, total balance и mint supply.

Проверяет:

- signer = instrument authority;
- action = SCHEDULED;
- Clock timestamp >= record_at;
- snapshot ещё не зарегистрирован;
- total balance = mint supply;
- hash не равен нулю.

После instruction action = `SNAPSHOT_CREATED`. Hash изменить нельзя.

#### `register_entitlement`

Создаёт entitlement PDA для holder.

Проверяет:

- action = SNAPSHOT_CREATED или CALCULATED;
- entitlement PDA ещё не существует;
- balance > 0;
- amount соответствует on-chain формуле для типа action;
- tokens to redeem соответствует формуле;
- cumulative counters не переполняются.

Первый успешно зарегистрированный entitlement переводит action из `SNAPSHOT_CREATED` в `CALCULATED`. Следующие entitlements добавляются только в `CALCULATED`.

#### `finalize_calculation`

Проверяет registered entitlement count, total balance и total amount. Переводит action в `READY_FOR_EXECUTION`.

#### `execute_coupon`

В одной transaction:

1. проверяет administrator signer и treasury authority;
2. проверяет `READY_FOR_EXECUTION | PROCESSING | PARTIALLY_COMPLETED`;
3. проверяет entitlement `READY`;
4. переводит USD-Test через Token-2022 CPI;
5. устанавливает entitlement `PAID`;
6. увеличивает processed count;
7. устанавливает `PARTIALLY_COMPLETED`, если обработана только часть entitlements; финальное завершение выполняет `finalize_action`.

#### `execute_redemption`

В одной transaction:

1. проверяет on-chain clock >= maturity;
2. переводит principal + final coupon;
3. выполняет `BurnChecked` bond tokens через Instrument Authority PDA;
4. создаёт Redemption Record PDA;
5. устанавливает entitlement `REDEEMED`;
6. обновляет counters.

#### `execute_early_redemption`

Аналогично redemption, но сжигает только `tokens_to_redeem`; нулевое количество запрещено.

#### `finalize_action`

Разрешена только когда processed count равен числу исполнимых entitlements. Устанавливает `COMPLETED` и timestamp.

Для полного redemption дополнительно проверяет mint supply = 0 и устанавливает instrument `REDEEMED`.

#### `cancel_action`

On-chain разрешена только из `SCHEDULED`, до snapshot. Database draft отменяется без blockchain transaction.

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
READY_FOR_EXECUTION
  ▼
PROCESSING
  ├── some complete ─→ PARTIALLY_COMPLETED ─→ PROCESSING
  ├── retryable ─────→ FAILED_RETRYABLE ────→ PROCESSING
  ├── terminal ──────→ FAILED_FINAL
  └── all complete ──→ COMPLETED
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

### 9.3. Holder service

Holder service:

1. вызывает Token-2022 `getProgramAccounts` с mint filter и `withContext`;
2. использует `finalized` commitment;
3. проверяет returned context slot;
4. декодирует все token accounts;
5. исключает zero balance;
6. агрегирует balances по owner wallet;
7. связывает wallets с investors;
8. сверяет сумму с mint supply.

Запрещено использовать только `getTokenLargestAccounts`, потому что он не гарантирует полный registry.

### 9.4. Snapshot service

`createSnapshot(actionId)`:

1. блокирует action через database transaction/version;
2. проверяет time window и state;
3. получает registry на finalized context;
4. требует отсутствие unregistered wallets;
5. формирует `snapshot-v1`;
6. сериализует canonical bytes;
7. вычисляет SHA-256;
8. сохраняет snapshot, raw token accounts и aggregated holders;
9. готовит `register_snapshot` transaction;
10. после wallet signature и finalized confirmation обновляет projection.

Окно snapshot задаётся `SNAPSHOT_GRACE_SECONDS`; default для demo — 300 секунд. Пропущенное окно не восстанавливается автоматически.

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

### 9.6. Confirmation and reconciliation

- signature сохраняется сразу после отправки;
- `PROCESSING` не означает success;
- confirmation watcher ждёт `finalized`;
- timeout создаёт `UNKNOWN_CONFIRMATION`, а не `FAILED_FINAL`;
- watcher повторно проверяет signature и on-chain PDA;
- confirm endpoint принимает signature только после проверки program ID, instruction data, signer, accounts и ожидаемого изменения PDA/token balances;
- reconciliation job сравнивает database projection с chain state;
- подтверждённое on-chain исполнение восстанавливает projection после backend crash.

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
POST /instruments/:id/deploy/prepare
POST /instruments/:id/deploy/confirm
POST /instruments/:id/reconcile
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
POST /corporate-actions/:id/execute/prepare
POST /corporate-actions/:id/execute/confirm
POST /corporate-actions/:id/finalize/prepare
POST /corporate-actions/:id/finalize/confirm
POST /corporate-actions/:id/cancel
```

`POST /corporate-actions` создаёт database draft. `schedule/prepare` создаёт on-chain action. `calculate` выполняет pure off-chain расчёт и сохраняет draft entitlements. `calculation/prepare` формирует transaction с `register_entitlement` instructions и `finalize_calculation`; при превышении transaction limits создаётся упорядоченная последовательность transactions. `calculation/confirm` проверяет entitlement PDAs и action counters до перехода database projection в `READY_FOR_EXECUTION`.

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
instruments
corporate_actions
snapshots
snapshot_token_accounts
snapshot_holders
entitlements
settlements
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
- unique `(snapshot_id, wallet_address)`;
- unique `(corporate_action_id, holder_wallet)` entitlement;
- unique blockchain signature;
- unique `(scope, idempotency_key)`;
- all foreign keys enforced;
- nonnegative balance/amount/supply checks;
- `record_at <= execute_at`;
- immutable finalized snapshot fields;
- enum/check constraints aligned with domain states.

### 11.3. Indexes

- instruments by status and maturity;
- actions by instrument/status/record_at/execute_at;
- entitlements by action/status;
- transactions by action/signature/status;
- audit logs by entity and created_at;
- jobs by status/next_attempt_at.

### 11.4. Immutability

После `FINALIZED` application layer запрещает UPDATE snapshot и snapshot holder rows. Database trigger либо restricted repository method является дополнительной защитой. Canonical JSON и hash изменяются только созданием нового snapshot для нового action.

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
metadata_json
created_at
```

Metadata не содержит private keys, raw sessions, full signed challenges или sensitive personal data.

## 12. Frontend

### 12.1. Routes

```text
/dashboard
/instruments
/instruments/new
/instruments/[id]
/instruments/[id]/holders
/corporate-actions
/corporate-actions/new
/corporate-actions/[id]
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

### 12.3. Calculation presentation

UI показывает integer inputs и человекочитаемое форматирование:

```text
10 bonds
× 1,000.00 USD-Test
× 1,000 bps / 10,000
÷ 2
= 500.00 USD-Test
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
docs/IMPLEMENTED_VS_SIMULATED.md
```

README включает requirements, setup, configuration, migrations, Solana deployment, seed, start, tests, demo и troubleshooting.

## 19. План разработки

### Milestone 0 — Decisions and scaffold

Owner: Tech Lead.
Acceptance: четыре ADR утверждены; repository, CI и local validator test запускаются.

### Milestone 1 — Token and program core

Owner: Blockchain Developer.
Acceptance: Token-2022 bond/USD-Test, Instrument PDA, Action PDA и authority tests работают локально.

### Milestone 2 — Registry and snapshot

Owner: Backend + Blockchain.
Acceptance: registry агрегирует 10/20/5, supply reconciles to 35, canonical hash воспроизводится и регистрируется on-chain.

### Milestone 3 — Coupon vertical slice

Owner: Full team.
Acceptance: API и минимальный UI проводят 500/1,000/250 payments, показывают proofs и отвергают duplicate execution.

Это первый обязательный demo gate. До него не выполняется broad UI polishing.

### Milestone 4 — Maturity redemption

Owner: Backend + Blockchain.
Acceptance: atomic payment + burn + record; maturity and replay checks проходят.

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
- coupon, redemption и early redemption имеют finalized signatures;
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
- USD-Test не имеет денежной стоимости;
- fixed-period coupon formula не является полной bond-calculation library.

## 22. Post-MVP gates

Перед pilot/mainnet необходимы:

- legal/compliance review;
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

Проверено 28 сентября 2026:

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
