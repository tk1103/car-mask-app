# Dockerfile for Receipt Title App

FROM node:20-alpine AS base

# 依存関係のインストールステージ
FROM base AS deps
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# ビルドステージ
FROM base AS builder
WORKDIR /app

# 依存関係をコピー
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 環境変数を設定（ビルド時に必要）
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY
ENV NODE_ENV=production

# ビルド
RUN npm run build

# 本番ステージ
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# 非rootユーザーを作成
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 必要なファイルをコピー
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 権限を設定
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
