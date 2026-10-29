ARG BUN_VERSION=1
ARG ALPINE_VERSION=3.23

FROM oven/bun:${BUN_VERSION}-alpine AS bun

FROM node:24-alpine${ALPINE_VERSION} AS dependencies
WORKDIR /app

RUN apk add --no-cache openssl && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS frontend
COPY frontend ./frontend
RUN pnpm --filter frontend build

FROM dependencies AS backend
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm exec prisma generate --schema=./prisma/schema.prisma

COPY tsconfig.json ./
COPY src ./src

ARG TARGETARCH
RUN case "$TARGETARCH" in \
        amd64) bun_target=bun-linux-x64-musl-baseline ;; \
        arm64) bun_target=bun-linux-arm64-musl ;; \
        *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    bun build --compile --minify --target="$bun_target" --external=pg-native \
        ./src/main.ts --outfile=./dist/challenger

FROM alpine:${ALPINE_VERSION} AS runtime
RUN apk add --no-cache ca-certificates libgcc libstdc++ && \
    addgroup -S -g 1000 challenger && \
    adduser -S -D -H -u 1000 -G challenger challenger

WORKDIR /app
ENV NODE_ENV=production \
    WEB_SERVER_PORT=8080 \
    FRONTEND_DIR=public

COPY --from=backend --chown=1000:1000 --chmod=0555 /app/dist/challenger ./challenger
COPY --from=frontend --chown=1000:1000 /app/frontend/dist ./public

USER 1000:1000
EXPOSE 8080/tcp 1337/tcp
ENTRYPOINT ["/app/challenger"]
