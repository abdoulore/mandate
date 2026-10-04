# Mandate

Mandate is a workspace for researching stock tokens and planning capital. It separates historical quote observations, wallet-specific research, and illustrative plans so that a recorded price or a feasible plan is never mistaken for permission to trade. The core workspace remains read-only. A separate, wallet-allowlisted SPYon pilot can request a wallet-confirmed approval or swap when explicitly enabled; general live execution remains disabled.

The public workspace includes:

- Historical $10,000 buy-cost observations with timestamps and links to the exact recorded source lines. A cost is measured against that quote's token reference price, not a completed trade or a current executable fee.
- Token research that keeps discovery, contract identity, market-data freshness, and execution eligibility separate. Stale collector data is labeled and its prices are hidden as current marks.
- Optional Binance Web3 Wallet sign-in for BNB Smart Chain holdings and unsigned route research. Sign-in itself requests no approval or transaction.
- Illustrative cash, allocation, rebalance, and exit plans that protect saved reserves and commitments. Planner prices and fees are synthetic; these plans do not move funds.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:3110](http://127.0.0.1:3110) for the landing page. The research workspace starts at `/regime`; the local API listens on `127.0.0.1:4110`. The development command starts both processes. Run `node scripts/check-preview.mjs` to check web/API health and the unsigned access boundary.

The included historical observations are sufficient to explore the recorded cost example without credentials. They are frozen, derived research records from September 2026, not live prices. Only selected dated files in `data/` are committed. Local logs, new collector output, wallet/session state, and credentials remain ignored. A fresh clone will mark the historical catalogue stale until new observations are collected.

To use the optional signed Binance research API, copy `.env.example` to `.env` and set your own `BINANCE_WEB3_API_KEY` and `BINANCE_WEB3_API_SECRET`. Wallet sign-in also uses `MANDATE_SESSION_SECRET`; production requires at least 32 random characters and an HTTPS `MANDATE_APP_ORIGIN`. Keep `.env` local. A phone wallet needs a reachable HTTPS origin in its DApp browser; its `127.0.0.1` is not this computer.

## Verify

```sh
npm run typecheck
npm run test:invariants
npm run build
```

The invariant suite runs without private credentials. A PostgreSQL-server test is skipped unless `MANDATE_TEST_DATABASE_URL` is set; CI supplies a disposable PostgreSQL service for it. The browser checks in `scripts/ui-*.mjs` expect a running local app and Microsoft Edge. Some use synthetic funded fixtures; those are labeled as examples, not wallet holdings.

## Boundaries

- Source line hashes and timestamps show what the collector recorded. They do not prove a fill, current liquidity, market access, or transaction safety.
- Wallet reads and unsigned route checks do not authorize a transaction. The 10 USDT AAOIB route has no matching historical collector-cost observation.
- Reserves and pending holds are application bookkeeping, not on-chain locks. Allocation and cash-raising estimates use synthetic costs and nominal USDT parity.
- The public deployment remains read-only. The separate SPYon pilot is disabled by default; enabling it is a deliberate operator choice and still requires a wallet confirmation for each approval and swap.

## Direct-route research in progress

`npm run probe:roundtrip -- SPYon` checks fresh Binance buy and sell quote/build shapes. `npm run probe:pancake-direct` checks the corresponding Pancake V3 pool, its published router interface and a direct on-chain quote. Both commands are read-only and save sanitized, local-only reports under `data/capabilities/`.

`npm run probe:direct-amounts` checks public-chain SPYon quotes for 0.01, 0.1, 1, 5 and 10 USDT at one block. It makes no wallet request and does not establish a trading minimum.

A connected wallet can open `/direct-trade` or request `POST /v1/routes/SPYon/preflight` with `{"direction":"BUY","buyAmountAtomic":"1000000000000000000"}` (1 USDT) or `{"direction":"SELL","sellAmountAtomic":"..."}`. The buy amount may be any positive amount up to 10 USDT; omitting it retains the original 10 USDT default. The read-only check tests the capped SPYon/USDT pool route, wallet funds and allowance, a current reference-price limit, and simulation when possible. When allowance is below the chosen amount, it also simulates an exact-amount token approval and checks an indicative approval gas budget without requesting approval. It returns no calldata and requests no wallet transaction. The page asks compatible wallets to switch to BNB Smart Chain during connection.

Every SPYon pilot stage requires an exact wallet address in `MANDATE_DIRECT_PILOT_WALLETS`; an empty or malformed list disables them. `MANDATE_DIRECT_APPROVAL_ENABLED=true` permits a separately confirmed exact-amount approval. `MANDATE_DIRECT_SWAP_TRIAL_ENABLED=true` permits only a buy of at most 1 USDT for the allowlisted wallet. `MANDATE_DIRECT_SELL_TRIAL_ENABLED=true`, with `MANDATE_DIRECT_SELL_TRIAL_BUY_HASH` set to a reconciled 1 USDT buy hash, separately permits one exact-amount SPYon approval and sell for only the quantity actually received in that buy. The sell trial closes after a confirmed sell; neither trial flag enables the wider route. `MANDATE_DIRECT_EXECUTION_ENABLED=true` separately opens the wider route, capped at a 10 USDT buy or a 0.02 SPYon sell with quoted output no greater than 11 USDT. `MANDATE_PLAN_DIRECT_ENABLED=true` separately exposes a plan-bound BUY preparation path for the allowlisted wallet. It caps the route and any exact USDT approval at 1 USDT. The allowlisted wallet saves a separate SPYon-only trial mandate (100% SPY, Ondo issuer limit 100%, SPYon contract only, and a chosen maximum route cost of 0–200 basis points); the main multi-asset investment mandate stays unchanged. Preparation checks that trial mandate and the latest saved cash rules, then atomically records the plan, cash hold, and attempt before wallet review. This experimental path remains off until ambiguous wallet-result recovery is verified. A buy requires a fresh capital checkpoint and saved cash policy with at least the chosen USDT amount available after protections. Preparation repeats the quote and contract checks, simulates the action, and records an exact-amount approval or swap attempt. The one-use `/begin` call commits a durable submission barrier before returning calldata for a separate wallet confirmation. A returned hash is recorded and later reconciled against a canonical receipt with 12 confirmations; a successful swap also requires the expected token transfers. Unknown wallet outcomes cannot be retried automatically. All execution flags default to false; a temporary wallet-specific preview enables only the stage under test.

An unresolved plan-bound request with no transaction hash can be checked after its swap deadline and chain-finality delay. Mandate scans the wallet's outgoing USDT transfers across the valid swap window; only a verified no-spend result closes the attempt and releases its plan hold. A request with a known hash must follow receipt reconciliation. This recovery is tested locally; the plan-bound flag remains off pending a phone-based flow check. The direct-trade page exposes the separate trial rules to a signed allowlisted wallet even while the plan-bound execution flag is off. Saving those rules requests no wallet transaction.

After all four wallet actions have confirmed, `/direct-trade` shows a combined round-trip receipt: exact USDT spent and returned, the matched SPYon quantity, the USDT cash difference, and BNB network fees across both approvals and swaps. The cash difference and BNB fees remain separate units.
