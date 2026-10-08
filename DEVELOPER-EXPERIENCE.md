# Developer experience: building Mandate with Binance Web3 APIs

**Network:** BNB Smart Chain (56) · **Research:** 19–29 September 2026, followed by a bounded mainnet wallet trial on 3 October 2026. This report describes observations from signed API probes and collected source records. The wallet trial used a separately verified PancakeSwap V3 route, **not** Binance Trading API broadcast or Ondo RFQ settlement.

## Setup and first successful request

The first preserved smoke session began 19 September at about 23:08 WAT. Public RWA calls responded, but signed `GET /build/api/v1/dex/market/rwa/platforms` from cloud egress returned HTTP 200 with body code `40304`, `Service not available due to compliance restriction`. The same credentials and signing scheme succeeded from local Nigerian egress on 20 September: HTTP 200, body code `0`, `message: success`. The precise first documentation visit and the first successful local call were not timestamped, so an exact docs-to-first-success duration is unavailable.

For signed `/build` calls, the working prehash was `timestamp + METHOD + requestPath + body`, without separators; the HMAC-SHA256 result was base64. The `requestPath` included `/build` and the raw query string. Requests used `X-OC-APIKEY`, `X-OC-TIMESTAMP` (ISO-8601 UTC) and `X-OC-SIGN`. Omitting `/build` yielded `40102 Invalid signature`; a missing timestamp yielded `40103 Timestamp is required`; an empty key yielded `40101 API Key is required`. Those auth responses used HTTP 401. Because compliance and other application failures can arrive with HTTP 200, clients must also inspect the body code and validate fields.

An early one-shot probe suggested permanent illiquidity. Later 15-minute collection disproved that: route quality and issuer availability changed over time. Mandate treats the first result as a transient observation, not a permanent market property.

## RWA Data API: useful data and sharp edges

The RWA endpoints gave Mandate issuer/platform enumeration, token contracts, underlying tickers, token/share ratios, profile descriptions and reference values. They made a broad research surface possible: a sequential 488-token sweep ran in 8 minutes 12.5 seconds and recorded 323 finite metrics plus 165 errors. This is **not** one simultaneous market snapshot. The initial 108 collector cycles, spaced 15 minutes apart, yielded 19,326 cost rows and 52,262 universe rows.

The fields require careful labeling:

The concrete signed GET paths used by this repository are below. The client prepends `/build` before signing and sending them to `web3.binance.com`.

| Purpose | Request path |
|---|---|
| Issuer/platform list | `/api/v1/dex/market/rwa/platforms` |
| BSC token discovery | `/api/v1/dex/market/rwa/tokens` |
| Token identity and underlying profile | `/api/v1/dex/market/rwa/underlying-profile` |
| Token and reference valuation | `/api/v1/dex/market/rwa/price` |
| Wallet/amount-specific route research | `/api/v1/dex/aggregator/quote` |
| Unsigned route build research | `/api/v1/dex/aggregator/swap` |

The final two paths were used for research; the verified SPYon wallet pilot used independently checked PancakeSwap V3 calldata. `/build` responses were never accepted as permission to transact.

| Observation | Consequence for a developer | Improvement requested |
|---|---|---|
| `/rwa/price` `tokenPrice` equaled `referencePrice × tokenToShareRatio` in the observed NVDA example. Reference values from `/price` and `/underlying-market` differed within one minute (220.875, 220.448442 and 220.48681 across sources). | This is a derived reference/NAV-like value, not the onchain buy price. Computing a premium from the two fields alone is tautologically zero. | Return valuation type, source, as-of time and conversion rules explicitly. |
| `volume24H` in token rows represented underlying-equity volume in the observed data, not wrapper onchain volume. | A “most liquid token” ranking based on this field would mislead. | Rename it `underlyingVolume24H`; add separately sourced token-route volume and depth. |
| TQQQ's structured `assetType: 3` and `tags: ["alpha"]` did not encode 3× leverage. The description supplied the warning, but sampled SOXL/SOXS descriptions were absent. | Risk controls cannot safely infer leverage from the structured schema alone. | Add leverage factor, reset period, inverse flag and mandatory risk code. |
| Requesting token pages 1 and 2 returned the same 442 rows in the observed probe. | Apparently successful pagination cannot be trusted without identity checks. | Return a cursor/total or document the endpoint as a single list. |
| Platform metadata claimed 457/451 Ondo tokens on Ethereum/Solana while the tested token enumerations returned zero. | Platform availability and enumerated chain coverage must be handled separately. | Make platform capabilities and enumeration scope consistent. |
| `statusInfo.nextCloseTime` preceded `nextOpenTime` by ten minutes in a recorded underlying-market response. | A simple open/close timeline parser produces nonsense. | Return explicit exchange sessions with timezone and semantics. |
| Fixed-income samples had `dividendYield: null` while return accrued in the token/share ratio. | Null yield does not imply no economic return. | Expose dated total-return/accrual metrics with provenance. |

Mandate uses sourced contracts and checks a profile's chain, issuer, underlying, asset type and ratio before treating it as observed. An old profile becomes stale; a failed refresh cannot silently preserve a green current state. Source timestamps are visible in the UI.

## Trading API: quotes, builds and errors

The signed Trading API supported quote and unsigned-build research. A complete AAOIB `aggregator/swap` request returned unsigned SWAP-shaped data in about 0.5 seconds. The build required `quoteId`, `amount`, `slippagePercent` and `approveTransaction=false` among its fields; the validation surfaced missing fields one at a time. A quote/build pair had to be bound to the exact wallet, chain, token addresses, side, amount and output limit. Quotes expired quickly, so Mandate never reused a research quote for execution.

Specific integration findings:

| Probe | Recorded result | What would help |
|---|---|---|
| Ondo USDon/USDC/WBNB → NVDAon pairs | Body code `40368`; preserved message begins `Ondo asset on chain 56 can only pair with allowed...`. USDT → NVDAon succeeded. `token/top-liquidity` nevertheless showed a USDon pool. | Expose allowed quote pairs and reasons independently of raw pool discovery. |
| Ondo off-hours quote | `40367 The stock market is currently closed.` Some `/rwa/tokens` rows still reported `open` while an issuer-wide window was unavailable. | Distinguish market close, issuer outage and stale listing state with timestamps. |
| Raw-address xStocks quote probes | Recorded `40374 Insufficient liquidity for a quote.` for sampled contracts; `/build` platform listing had only `ondo` and `bstock`. | Publish a supported issuer/chain/contract matrix and distinguish readable addresses from quotable instruments. This finding needs organizer confirmation because raw payloads were not retained in the public record. |
| `chainId=56` instead of `binanceChainId=56` | `40001 Parameter [binanceChainId] is required`. | Make chain parameter naming consistent or publish typed request examples. |
| Ondo RFQ without `userWalletAddress` | `userWalletAddress is required for RFQ (Ondo) quote`. This did not apply to the sampled bStock route. | Declare wallet requirements per execution mode. |
| `/transaction/pre-transaction/simulate`, gas-limit and broadcast capability probes | Recorded code `000002`; no more specific literal message was retained. Gas-price and block-height probes worked. | Publish entitlement and capability discovery before integration; separate unavailable, unsupported and malformed requests. |
| `/b402/supported` | `40104 No permission: B402`. | Expose key scopes and an access path. |
| Candle rows and limits | A recorded row placed timestamp at index 5 without a named schema; `limit=301` returned `40001 invalid limit range`. | Publish a typed candle schema and the 300-row bound. |

The 15-minute collector captured a quoted NVDAon $10,000 buy cost changing from **+133.71%** to **−0.05%** against its token reference between 16:45 and 17:00 UTC on 20 September. The committed source rows are `data/cost-2026-09-20.jsonl:4323` and `:4503`; `scripts/product-journey-smoke.mjs` checks their SHA-256 hashes. This is a historical quote reversal, not two completed trades. A current quote without source time, size, side and route cannot explain when the trade became reasonable.

## Safety lessons from an actual wallet trial

The API can tell a client what it quoted or built; it cannot prove that the connected wallet is eligible, funded, willing to spend, or looking at the exact transaction the client intended. Mandate therefore checked token and router contracts, Pancake V3 pool identity, amount and minimum output, quote/reference freshness, saved cash and trial rules, USDT/SPYon balances, exact allowances, wallet gas, transaction simulation, one-use submission state, and canonical receipt/token flows. An approval was bounded to the exact amount; it was never treated as swap authorization.

The 3 October mainnet pilot completed four separately confirmed wallet actions—buy approval, buy swap, sell approval, sell swap—through PancakeSwap V3. [Receipt and transfer evidence](VERIFIED-PILOT.md) records the exact amounts and BscScan hashes. It validates this one capped SPYon path. It **does not** validate Binance RFQ calldata, Binance transaction simulation/broadcast entitlement, general wallet market access, other tokenized-stock routes, or automated portfolio execution. Those remain gated.

## Highest-value API improvements

1. Return a machine-readable capability/entitlement matrix by key, issuer, chain, pair, wallet requirement and execution mode before a client constructs a transaction.
2. Provide typed, versioned schemas and source timestamps for RWA price, token volume, leverage, yield, market status, candles and quote/build responses.
3. Make application failures unambiguous at the HTTP layer and distinguish market closure, issuer outage, pairing restriction and insufficient depth.
4. Expose route-cost/depth history or a real-time regime signal so clients can explain why a fresh quote differs from the reference and from earlier quotes.
5. Return a complete validation error list for a failed build request, including quote expiry, required fields and slippage parameter semantics.

These recommendations come from observed integration failures. No private API key, secret, wallet session or raw wallet signature is included here.
