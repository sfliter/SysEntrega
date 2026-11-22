# RSF - SysEntrega — API (NestJS + Prisma)
#
# Debian (slim) e não Alpine: o Prisma depende do OpenSSL do sistema.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
# Fotos de vistoria e termos em PDF: monte um volume aqui
ENV ARMAZENAMENTO_DIR=/dados/armazenamento
RUN mkdir -p /dados/armazenamento && chown -R node:node /dados /app
USER node
VOLUME /dados/armazenamento
EXPOSE 3000
# Aplica as migrações, roda o seed (idempotente) e sobe a API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js && node dist/src/main.js"]
