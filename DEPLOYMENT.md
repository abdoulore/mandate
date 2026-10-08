# Stable HTTPS deployment

The repository includes a single-container production process for the Next.js frontend and loopback Fastify API. The API is not directly exposed; only port 3110 should be reachable through an HTTPS reverse proxy. Production requires a persistent PostgreSQL database. The API migrates its ledger on first use; wallet-specific holds and execution attempts must survive web/container restarts. Run one application replica for the hackathon deployment because the recurring-check worker is currently embedded in the API process.

## Build and run

```sh
docker build -t mandate:submission .
docker run --rm --name mandate \
  -p 127.0.0.1:3110:3110 \
  --env-file ./mandate.production.env \
  mandate:submission
```

Set these values in the host's secret manager or a local environment file **outside Git**:

- `MANDATE_APP_ORIGIN=https://your-public-domain` — exact browser origin used for signed wallet sessions.
- `MANDATE_SESSION_SECRET` — unique random value of at least 32 characters.
- `MANDATE_DATABASE_URL` — PostgreSQL connection string for a dedicated persistent database, supplied only to the server. Use the hosting provider's TLS mode and private network where available.
- `BINANCE_WEB3_API_KEY` and `BINANCE_WEB3_API_SECRET` — only if current signed API research is needed. Keep them server-side.
- `MANDATE_BSC_RPC_URL` — a reliable BSC mainnet RPC for wallet reads/simulation if the host requires one.
- `MANDATE_DIRECT_PILOT_WALLETS` — empty in public research mode.
- All `MANDATE_DIRECT_*_ENABLED` and `MANDATE_PLAN_DIRECT_ENABLED` flags — `false` in public research mode.

The container checks HTTPS origin, session-secret length and database configuration before serving. Terminate TLS at the reverse proxy and forward standard `Host`, `X-Forwarded-Proto` and cookies. Preserve the same public origin through the wallet challenge/verify flow. Do not expose port 4110. Configure host health checks against `GET /api/v1/health` on port 3110. The health response does not itself prove database access; perform a signed wallet/capital smoke after deployment.

After deployment, run `MANDATE_SMOKE_ORIGIN=https://your-public-domain node scripts/product-journey-smoke.mjs` from a machine with Microsoft Edge; verify the landing, Explore, SPYon Asset/Plan, Portfolio and Activity pages manually in Binance Web3 Wallet's DApp browser. Check stale/closed market behavior and confirm that no wallet transaction can be prepared for an unallowlisted address. The [demo runbook](DEMO-RUNBOOK.md) provides a recorded fallback.

No stable host, domain, database, or secret values are committed to this repository. Publishing requires those external resources and a deployment-specific check; the temporary Cloudflare preview is not a stable submission URL.
