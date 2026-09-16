# syntax=docker/dockerfile:1
#
# Pelsung Finance — single image running both processes:
#   • Express API   on 127.0.0.1:4000  (not published)
#   • Next.js web   on 0.0.0.0:3000    (the only exposed port)
#
# The browser only ever talks to the Next.js origin; Next proxies /api/* to the
# API over loopback (see next.config.ts). One container, one Coolify resource,
# one domain, no CORS and no third-party cookies.

# ---------------------------------------------------------------- backend build
FROM node:22-bookworm-slim AS backend-build
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src
RUN npm run build

# backend production dependencies only
FROM node:22-bookworm-slim AS backend-deps
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# --------------------------------------------------------------- frontend build
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Proxy target is fixed inside the container; nothing here is a secret.
ENV NEXT_PUBLIC_API_URL=http://127.0.0.1:4000
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4000 \
    WEB_PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# API
COPY --from=backend-deps  /src/backend/node_modules ./backend/node_modules
COPY --from=backend-build /src/backend/dist         ./backend/dist
COPY backend/package.json                            ./backend/package.json
COPY backend/drizzle                                 ./backend/drizzle

# Web (Next.js standalone output)
COPY --from=frontend-build /src/frontend/.next/standalone ./frontend
COPY --from=frontend-build /src/frontend/.next/static     ./frontend/.next/static
COPY --from=frontend-build /src/frontend/public           ./frontend/public

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]