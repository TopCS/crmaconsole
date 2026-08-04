# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: install deps and produce the CLI bundle + Next.js standalone
# web build (the same artifacts `pnpm prepack` creates for the npm package).
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# build:seed-duckdb shells out to the DuckDB CLI (not published via apt/npm).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in amd64) duckarch=amd64 ;; arm64) duckarch=aarch64 ;; *) echo "unsupported arch: $arch" >&2; exit 1 ;; esac \
  && curl -fsSL "https://github.com/duckdb/duckdb/releases/latest/download/duckdb_cli-linux-${duckarch}.zip" -o /tmp/duckdb.zip \
  && unzip -o /tmp/duckdb.zip -d /usr/local/bin \
  && rm /tmp/duckdb.zip \
  && duckdb --version

# Install dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# Full prepack chain: seed duckdb, plugin env, plugins, CLI bundle, web build.
COPY . .
RUN pnpm prepack

# ---------------------------------------------------------------------------
# Runtime stage: daemonless mode — no systemd/launchd inside the container.
# The entrypoint starts the OpenClaw gateway and the managed web runtime.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CRM_A_CONSOLE_DAEMONLESS=1 \
    CRM_A_CONSOLE_WEB_HOST=0.0.0.0

# The CLI drives a global OpenClaw install (peer dependency), the web app
# shells out to the DuckDB CLI for every workspace query, and the CLI shells
# out to lsof/ps/which for port and process management (absent from slim).
RUN apt-get update \
  && apt-get install -y --no-install-recommends lsof procps debianutils ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in amd64) duckarch=amd64 ;; arm64) duckarch=aarch64 ;; *) echo "unsupported arch: $arch" >&2; exit 1 ;; esac \
  && curl -fsSL "https://github.com/duckdb/duckdb/releases/latest/download/duckdb_cli-linux-${duckarch}.zip" -o /tmp/duckdb.zip \
  && unzip -o /tmp/duckdb.zip -d /usr/local/bin \
  && rm /tmp/duckdb.zip \
  && duckdb --version \
  && npm install -g openclaw@latest

COPY --from=build /app /app

# Web UI. The gateway (19001) stays on container loopback — only the web
# runtime needs to be reachable from the host.
EXPOSE 3100

# Persist all state (config, workspace, databases) outside the container.
VOLUME ["/root/.openclaw-crm-a"]

ENTRYPOINT ["bash", "scripts/docker-entrypoint.sh"]
