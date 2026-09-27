# MINA OMAR MIRANDA — imagen única frontend+API para 24/7
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY server ./server
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 3001
ENV PORT=3001 DATABASE_URL=/app/data/mina-omar-miranda.db STORAGE_URL=/app/data/uploads
CMD ["node", "--import", "tsx", "server/index.ts"]
