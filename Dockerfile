FROM node:26-slim

ENV NODE_ENV=production \
    PORT=3000 \
    MODEL_CACHE_DIR=/app/models

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY db ./db
COPY public ./public

# Download the embedding model into the image, so the server never depends on the Hub at runtime.
RUN node src/embeddings.ts && chown -R node:node /app/models

USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
