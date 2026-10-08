# Stable HTTPS deployment

The repository includes a single-container production process for the Next.js frontend and loopback Fastify API. The API is not directly exposed; only port 3110 should be reachable through an HTTPS reverse proxy. Production requires a persistent PostgreSQL database. The API migrates its ledger on first use; wallet-specific holds and execution attempts must survive web/container restarts. Run one application replica for the hackathon deployment because the recurring-check worker is currently embedded in the API process.

## Recommended hackathon host: Railway Hobby

Railway can build this repository's root `Dockerfile`, run the app and PostgreSQL as two services in one project, and assign the app a stable HTTPS `*.up.railway.app` domain. Use one app replica. Railway Hobby has a $5 monthly base that includes $5 of resource usage; actual charges can exceed that amount as usage grows. Set a usage alert. Avoid a sleeping/free web instance for a wallet demo where cold starts would look like a broken connection. See [Railway's pricing](https://docs.railway.com/pricing/plans), [PostgreSQL guide](https://docs.railway.com/databases/postgresql), and [domain guide](https://docs.railway.com/networking/domains/working-with-domains).

1. In Railway, create a project from `abdoulore/mandate` on `main`. Let it build the root Dockerfile. Create a PostgreSQL service in that same project; keep the database private.
2. In the app service, generate a Railway domain and target port **3110**. Set `PORT=3110` and `MANDATE_APP_ORIGIN` to that exact `https://...up.railway.app` origin, with no trailing path. The app deliberately refuses to start without a valid origin, secret and database URL, so configure these variables before expecting the first deployment to pass health checks.
3. Set `MANDATE_DATABASE_URL=${{Postgres.DATABASE_URL}}` as a Railway reference variable. Set a unique `MANDATE_SESSION_SECRET` of at least 32 random characters. Add the Binance Web3 API credentials and a reliable BSC RPC URL as server-side variables if fresh market and wallet checks are needed. Never put these values in the repository or a client-side `NEXT_PUBLIC_` variable.
4. Leave `MANDATE_DIRECT_PILOT_WALLETS` empty and every `MANDATE_DIRECT_*_ENABLED` and `MANDATE_PLAN_DIRECT_ENABLED` flag `false` for the public research launch. No database domain or port 4110 should be public. Set the app health-check path to `/api/v1/health`.
5. After Railway reports healthy, open `/`, `/market`, `/asset/SPYon`, `/plan/SPYon`, `/portfolio`, `/activity`, and `/proof` on the assigned HTTPS origin. Then test wallet sign-in from Binance Web3 Wallet on BNB Smart Chain, a fresh read-only route, private portfolio access, and a restart without losing saved rules. The confirmed historical pilot is already linked from `/proof`; a new transaction is unnecessary for launch validation.
6. Add the verified Railway URL as the GitHub repository homepage and README live-app link. Only after that should a custom domain be considered; it is not required for the submission.

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
