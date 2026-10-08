FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY collector ./collector
COPY scripts/start-production.mjs ./scripts/start-production.mjs
COPY data ./data
COPY research/evidence-manifest.json ./research/evidence-manifest.json
COPY research/passports/launch.json ./research/passports/launch.json
RUN npm ci --include=dev && MANDATE_PRODUCTION_BUILD=1 npm run build
EXPOSE 3110
CMD ["node", "scripts/start-production.mjs"]
