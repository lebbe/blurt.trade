FROM node:26-slim

ENV NODE_ENV=production \
    PORT=3000 \
    MODEL_CACHE_DIR=/app/models \
    OG_CACHE_DIR=/app/og-cache

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY db ./db
COPY public ./public
COPY assets ./assets

# Download the embedding model into the image, so the server never depends on the Hub at runtime.
RUN node src/embeddings.ts && mkdir -p /app/og-cache && chown -R node:node /app/models /app/og-cache

USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
