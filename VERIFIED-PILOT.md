# Verified SPYon wallet pilot — 3 October 2026

This is a bounded BNB Smart Chain mainnet proof for **SPYon/USDT through PancakeSwap V3**. The user separately confirmed each wallet request. Mandate reconciled canonical receipts and matching token transfers; none of these observations certifies a different token, a Binance RFQ route, or a future quote.

| Action | BscScan transaction | Confirmed block | Observed effect | BNB network fee |
|---|---|---:|---|---:|
| Exact USDT approval | [0xd6e373a9…](https://bscscan.com/tx/0xd6e373a9ad261c1ba0f2777c801276e3f2b60bb3952f2b96e016ae2e71d17378) | 125467402 | 1 USDT allowance to the Pancake V3 router | 0.000002513469956532 |
| Buy swap | [0xe60e3767…](https://bscscan.com/tx/0xe60e3767e42d7bbcc165b089eb6f5b916b879ee095152ddcbe2f17ab7d42133b) | 125486308 | 1 USDT spent; 0.00127831014865403 SPYon received | 0.000010959817911744 |
| Exact SPYon approval | [0xf2f802e8…](https://bscscan.com/tx/0xf2f802e8779feccf54bb53aad44f57f21ee8f729ecc4b0283155e5abff770570) | 125492006 | Allowance for exactly the received SPYon quantity | 0.000004352192898459 |
| Sell swap | [0xe57cb944…](https://bscscan.com/tx/0xe57cb944021a5cab14d0cb1a725744b971a84792b4ec49f1c297be132b45e98c) | 125493694 | 0.00127831014865403 SPYon spent; 0.993895483757431244 USDT received | 0.000014219176361360 |

The exact received buy quantity was sold in full. The sell's calldata minimum was 0.988926006338644087 USDT; the receipt exceeded it. **Gross cash difference:** −0.006104516242568756 USDT (about 0.61% of the initial 1 USDT), before **0.000032044657128095 BNB** in network fees across the four actions. BNB is a separate unit and has not been converted into the USDT difference. This is a measured round-trip cost, not a performance or future-return claim.

An earlier prepared wallet request was abandoned. Mandate did not infer submission from a button click; uncertain outcomes remained blocked until a hash/receipt or a verified no-spend recovery could resolve them. The pilot's exact-approval, simulation, route, size and allowlist guards remain in place and all execution flags are off by default.
