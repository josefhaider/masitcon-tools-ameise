# masitcon Zeiterfassung (Ameise) - Dockerfile
# Multi-Stage: Build mit Node, Serve mit minimalem Image
# Build-Modi: production (default), staging
# docker build --build-arg BUILD_MODE=staging --build-arg VITE_SUPABASE_URL=... .

FROM node:20-alpine AS builder

WORKDIR /app

# Dependencies (inkl. devDependencies für Build)
COPY package.json package-lock.json* ./
RUN npm ci

# Build (VITE_* zur Build-Zeit; BUILD_MODE = production|staging)
COPY . .
ARG BUILD_MODE=production
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
# Verhindert OOM-Kill auf Servern mit wenig RAM (Node beansprucht sonst >2GB)
ENV NODE_OPTIONS="--max-old-space-size=1536"
# BUILD_MODE von \r befreien (CRLF-Schutz bei Windows-generierten env-Dateien)
RUN BUILD_MODE=$(printf '%s' "${BUILD_MODE}" | tr -d '\r\n') && npm run build:${BUILD_MODE}

# Produktions-Stage
FROM node:20-alpine

WORKDIR /app

# serve für statische Dateien
RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["serve", "-s", "dist", "-l", "8080"]
