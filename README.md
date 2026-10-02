# Mandate

Mandate is a read-only workspace for researching stock tokens and planning capital. It separates historical quote observations, wallet-specific research, and illustrative plans so that a recorded price or a feasible plan is never mistaken for permission to trade. **Live execution is disabled.**

The public workspace includes:

- Historical $10,000 buy-cost observations with timestamps and links to the exact recorded source lines. A cost is measured against that quote's token reference price, not a completed trade or a current executable fee.
- Token research that keeps discovery, contract identity, market-data freshness, and execution eligibility separate. Stale collector data is labeled and its prices are hidden as current marks.
- Optional Binance Web3 Wallet sign-in for read-only BNB Smart Chain holdings and unsigned route research. No approval or transaction is requested.
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
- No instrument or route is certified for live execution. No signer, approval, broadcast, or trade endpoint is provided.
