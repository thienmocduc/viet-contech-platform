# syntax=docker/dockerfile:1.7
# =====================================================================
# Viet-Contech Design Platform — Master API Server (multi-stage)
# Build context: platform/backend/   (NOT platform/backend/server/)
#   docker build -t vct-server -f platform/backend/server/Dockerfile platform/backend
# =====================================================================

# ---------- Stage 1: builder ----------------------------------------
FROM node:22-alpine AS builder

# better-sqlite3 native binding requires build toolchain
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy server package + tsconfig first (better Docker cache)
COPY server/package.json server/package-lock.json* ./server/
COPY server/tsconfig.json ./server/
RUN cd server && npm ci --no-audit --no-fund

# Copy backend layout that the server depends on at *runtime*
# (db migrations, agents registry, tcvn rules, pipeline + bridges).
COPY agents          ./agents
COPY db              ./db
COPY tcvn            ./tcvn
COPY pipeline        ./pipeline
COPY boq             ./boq
COPY bim             ./bim
COPY mep             ./mep
COPY qc              ./qc
COPY packager        ./packager
COPY src             ./src
COPY package.json    ./
COPY tsconfig.json   ./

# Copy server src + tests
COPY server/src   ./server/src
COPY server/tests ./server/tests

# Compile to dist
RUN cd server && npx tsc -p tsconfig.json

# ---------- Stage 2: runtime ----------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

# Install minimum tools needed by better-sqlite3 native rebuild
RUN apk add --no-cache tini

# Copy compiled output and prod deps only
COPY --from=builder /app/server/package.json /app/server/package-lock.json* ./server/
COPY --from=builder /app/server/dist                                       ./server/dist

# Re-install with --omit=dev so node_modules is small but contains better-sqlite3 binary
RUN cd server && \
    apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev --no-audit --no-fund && \
    apk del .build-deps

# Copy runtime data: agents registry, db migrations, tcvn rules, pipeline+bridges
COPY --from=builder /app/agents   ./agents
COPY --from=builder /app/db       ./db
COPY --from=builder /app/tcvn     ./tcvn
COPY --from=builder /app/pipeline ./pipeline
COPY --from=builder /app/boq      ./boq
COPY --from=builder /app/bim      ./bim
COPY --from=builder /app/mep      ./mep
COPY --from=builder /app/qc       ./qc
COPY --from=builder /app/packager ./packager
COPY --from=builder /app/src      ./src

# Persistent data dir (sqlite db + exports)
RUN mkdir -p /app/data /app/server/data /app/data/exports

ENV NODE_ENV=production \
    PORT=8787 \
    VCT_DB_PATH=/app/data/vct.db

EXPOSE 8787
HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/healthz || exit 1

# tini for proper signal handling (PID 1 traps)
ENTRYPOINT ["/sbin/tini", "--"]
WORKDIR /app/server
CMD ["node", "dist/server.js"]
