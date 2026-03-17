# Stage 1: Build
FROM node:20-alpine AS builder
RUN npm install -g bun
WORKDIR /app

COPY package.json bun.lockb* package-lock.json* ./
RUN if [ -f bun.lockb ]; then bun install --frozen-lockfile; else npm ci; fi

COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

# Stage 2: Run
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Standalone build output
COPY --from=builder /app/.next/standalone ./
# Static assets (not included in standalone)
COPY --from=builder /app/.next/static ./.next/static
# Public directory
COPY --from=builder /app/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
