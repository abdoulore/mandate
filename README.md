# Mandate

**Know what a tokenized stock really costs before you buy it.**

Mandate is a pre-trade decision and execution-control layer for tokenized stocks on BNB Smart Chain. It separates a token's identity, recorded market data, a fresh wallet-specific route, available cash after protections, and the user's explicit transaction authorization. A token listing is not a buy opportunity; a quote is not an approval.

[Read-only demo video](media/mandate-read-only-demo.mp4) · [Developer experience report](DEVELOPER-EXPERIENCE.md) · [Verified 1 USDT SPYon round trip](VERIFIED-PILOT.md) · [Demo runbook](DEMO-RUNBOOK.md) · [GitHub repository](https://github.com/abdoulore/mandate)

## The problem

A tokenized stock can track a familiar security while the onchain route is expensive, unavailable, or unsuitable for a particular wallet. The reference price, recorded token price, executable route, available wallet balance, and amount the user is willing to spend answer different questions. A single green “Buy” button hides those distinctions.

## What Mandate does

The product path is **Explore → Understand → Plan → Verify → Confirm → Track**.

1. **Explore:** Browse sourced Ondo and bStocks token identities. Recorded token prices show their collector timestamp and are never used as executable quotes.
2. **Understand:** Open an asset to inspect its contract, issuer, historical cost evidence, original source line, and unresolved facts.
3. **Plan:** Connect a BNB Smart Chain wallet, protect cash for reserves and commitments, and save investment rules. Sign-in proves wallet ownership; it cannot move funds.
4. **Verify:** For the bounded SPYon path, Mandate obtains a fresh route and reference, checks route and pool identity, wallet balance, allowance, saved rules, and simulation. Other token routes remain research-only until separately certified.
5. **Confirm:** A wallet request is shown only after its checks pass. Exact-amount approvals and swaps each require their own user confirmation.
6. **Track:** Mandate records attempts, blocks uncertain outcomes from automatic retry, and reconciles canonical receipts and token flows.

Historical observations are evidence, not current offers. Planning previews are models, not fund locks. Route verification is not trade authorization.

## BNB Chain and Binance Web3 APIs

Mandate uses BNB Smart Chain mainnet (chain ID 56), BSC USDT, Ondo and bStocks tokenized assets, and a separately verified PancakeSwap V3 route for its SPYon pilot. The Binance Web3 RWA Data API supplies discovery, issuer/platform metadata, token profiles, and reference-price observations. Its Trading API supplies quote and unsigned-build research. Mandate independently checks response identity, age and transaction meaning; API success alone cannot grant market access or authorize a wallet action. See the [developer report](DEVELOPER-EXPERIENCE.md) for endpoint behavior, exact integration findings, and requested API improvements.

## Architecture

```text
Binance Web3 RWA + Trading APIs ──► discovery, reference and route observations
                                          │
                         recorded source lines and hashes
                                          │
Wallet BSC RPC ──► balances and allowances ──► Mandate decision engine
Saved rules ─────► protected cash and limits ─┘         │
                                                       ▼
                                           route identity + simulation
                                                       │
                                              separate wallet prompt
                                                       │
                                         canonical receipt + token flows
```

The Next.js web app proxies an allowlisted API surface to the local Fastify service. Locally, the API uses a durable embedded PostgreSQL-compatible ledger under `.runtime/`; production selects persistent PostgreSQL through `MANDATE_DATABASE_URL`. Runtime state, credentials and recent collector output are ignored by Git. Frozen September research evidence is committed for the historical example.

## Verified pilot and boundaries

On 3 October 2026, one wallet confirmed exact USDT and SPYon approvals plus a SPYon buy and sell. The buy spent **1 USDT** and received **0.00127831014865403 SPYon**; selling that exact quantity returned **0.993895483757431244 USDT**. The cash difference was **−0.006104516242568756 USDT** before **0.000032044657128095 BNB** in four network fees. [All four BscScan transaction links and receipt accounting](VERIFIED-PILOT.md) are public proof of this bounded PancakeSwap V3 route, not a claim that other stock tokens or Binance RFQ routes can execute.

The pilot is wallet allowlisted and off by default. Each stage has a separate flag and size cap. Unknown wallet results are held for reconciliation rather than automatically repeated. Broad execution is disabled. Research-only portfolio proposals use modeled costs and nominal USDT parity; they are not executable orders. Application cash reserves and pending holds do not lock funds onchain.

The captioned [read-only backup demo](media/mandate-read-only-demo.mp4) tours the public product and prior receipt proof. It does not claim to show a new wallet confirmation; the four mainnet receipts above are the execution evidence.

## Try it locally

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3110` for the landing page and `http://127.0.0.1:3110/market` to explore. The Fastify API listens on `127.0.0.1:4110`. The committed historical research can be viewed without credentials. A fresh clone has no live collector frame, so current price cells remain unavailable until data is collected.

For signed API research, copy `.env.example` to `.env` and supply your own `BINANCE_WEB3_API_KEY` and `BINANCE_WEB3_API_SECRET`. Wallet sessions need `MANDATE_SESSION_SECRET` (at least 32 random characters in production) and an HTTPS `MANDATE_APP_ORIGIN` for a phone wallet. Never commit `.env`, `.runtime`, private research, or wallet state. Execution flags default to `false` and should stay off in a public research deployment.

## Verify

```sh
npm run typecheck
npm run test:invariants
npm run build
node scripts/product-journey-smoke.mjs
node scripts/navigation-smoke.mjs
```

The invariant suite runs without credentials; the current run passed **248 tests with one database-server test skipped**. The browser smoke uses installed Microsoft Edge and a running local app/API. On the local optimized preview, six mobile page transitions to fully visible headings/data took **54–335 ms**; network and phone-wallet conditions will vary. The repository also has focused API, route, wallet, ledger and synthetic funded-portfolio tests; synthetic fixtures are not live holdings or transaction proof. CI runs the core checks. The [demo runbook](DEMO-RUNBOOK.md) gives a concise judge path and fallback evidence.

## Technical detail

`/direct-trade` and `/plan/SPYon` expose the same capped direct-route review for the pilot; the plan page does not bypass its wallet checks. A buy can check a user-chosen positive USDT amount up to 10 USDT. Pilot flags restrict actual stages further. A separate SPYon-only trial rule set leaves the main multi-asset plan unchanged. Preparation repeats fresh quote, reference, contract, route, wallet and simulation checks; an exact-amount approval is requested only when needed. The one-use begin step records a durable submission barrier before returning calldata. Reconciliation requires a canonical receipt with 12 confirmations and matching token transfers. An unresolved attempt must be resolved before another wallet request.

The older AAOIB aggregator research is deliberately read-only because its router calldata and wallet market access are not certified. The 488-token collector survey and 14 sourced passports broaden research coverage; they do not broaden live execution coverage.
