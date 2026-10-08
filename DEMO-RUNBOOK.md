# Mandate judge demo runbook

**Target:** 3–4 minutes. Start from the product decision, then show evidence. Do not promise live execution outside the capped SPYon wallet pilot.

| Time | Screen | Narration / proof |
|---|---|---|
| 0:00–0:20 | Landing | “A tokenized stock can track a real asset and still be a bad onchain buy. Mandate separates the token, route, wallet and money rules.” |
| 0:20–0:45 | Explore → SPYon | Show sourced Ondo contract and the explicitly **recorded** token price. Say that neither is a current executable offer. |
| 0:45–1:10 | SPYon Cost history, then NVDAon history | Show a measured line and source proof. The NVDA $10,000 quote moved from +133.71% to −0.05% in 15 minutes on 20 September. Label it historical. |
| 1:10–1:45 | Plan SPYon → connect wallet | Explain sign-in proves ownership only. Show the fresh route, reference, wallet USDT/BNB and allowance for a small amount. If a market is closed, show the blocked state rather than improvising a price. |
| 1:45–2:20 | Portfolio and saved rules | Show protected cash, available USDT and the separate SPYon-only trial limit. A plan is an app record, not an onchain lock or order. |
| 2:20–2:55 | Review / wallet request | Show the pass/fail summary and expandable evidence. Explain that exact approvals and swaps are different wallet prompts. For the live demo, **do not initiate another transaction just to reproduce the earlier proof**. |
| 2:55–3:25 | Public `/proof` page and Activity | Open the four BscScan links on the public proof page, then show private wallet Activity if connected. One USDT bought 0.00127831014865403 SPYon; selling it returned 0.993895483757431244 USDT before separate BNB fees. The same links are in [verified pilot evidence](VERIFIED-PILOT.md). |
| 3:25–3:45 | Developer report | Show one concrete Binance API finding: the quoted NVDA cost reversal, and the distinction between reference price and executable route. End with the product's four questions. |

## Fallbacks

- If the live collector is stale, keep prices hidden and use the committed historical source rows. Never present an old frame as current.
- If Binance's market is closed or the quote errors, show the blocked route. The verified round-trip receipts remain an independent proof of the bounded direct path.
- If a wallet is unavailable, play the [captioned read-only backup demo](media/mandate-read-only-demo.mp4) and open the [four BscScan transactions](VERIFIED-PILOT.md). The backup shows the product and past receipts, not a new wallet confirmation.
- If the preview tunnel fails, run the local app on `127.0.0.1:3110`; a stable HTTPS deployment remains the intended judging URL.

Before a live recording, check `/`, `/market`, `/asset/SPYon`, `/plan/SPYon`, `/portfolio`, `/activity`, `/proof`, and the public report link at the deployed origin. Record the browser at a readable mobile or 1440-pixel width. Keep wallet addresses and any local API credentials out of screen captures unless already public in the transaction receipts. The read-only video is a fallback; add wallet footage only when the owner deliberately authorizes a fresh wallet request.
