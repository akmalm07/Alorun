FROM node:24-alpine AS dependencies
WORKDIR /app
COPY server/deploy/package*.json ./
RUN --mount=type=secret,id=npm_ca if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server/index.mjs server/encrypted-api.mjs server/supabase-store.mjs server/chat.mjs server/config.mjs ./server/
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
