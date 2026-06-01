FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable \
  && chown node:node /app

USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack pnpm install --frozen-lockfile

COPY --chown=node:node prisma ./prisma
RUN corepack pnpm prisma generate

COPY --chown=node:node . .

RUN mkdir -p /app/.next

EXPOSE 3000

CMD ["sh", "-c", "corepack pnpm install --frozen-lockfile && corepack pnpm prisma generate && corepack pnpm prisma migrate deploy && exec corepack pnpm dev --hostname 0.0.0.0"]
