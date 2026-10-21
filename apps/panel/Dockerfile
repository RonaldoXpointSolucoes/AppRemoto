FROM golang:1.26-alpine AS windows-installer
WORKDIR /agent
COPY services/agent/ ./
RUN go mod download && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w -H=windowsgui' -o /out/xpoint-setup-1.3.4.exe ./cmd/remote-setup && rm -rf /go/pkg /root/.cache /tmp/*

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/panel/package.json apps/panel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --prod --frozen-lockfile --filter @appremoto/panel... && \
    mkdir -p /app/node_modules/typescript/lib /app/node_modules/@types/react /app/node_modules/@types/node && \
    printf '{"name":"typescript","version":"5.9.0"}\n' > /app/node_modules/typescript/package.json && \
    printf 'module.exports={};\n' > /app/node_modules/typescript/lib/typescript.js && \
    printf '{"name":"@types/react","version":"19.2.0"}\n' > /app/node_modules/@types/react/package.json && \
    touch /app/node_modules/@types/react/index.d.ts && \
    printf '{"name":"@types/node","version":"24.0.0"}\n' > /app/node_modules/@types/node/package.json && \
    touch /app/node_modules/@types/node/index.d.ts && \
    rm -rf /pnpm/store /root/.local/share/pnpm/store /root/.cache /tmp/*

FROM dependencies AS builder
ARG NEXT_PUBLIC_APPWRITE_ENDPOINT
ARG NEXT_PUBLIC_APPWRITE_PROJECT_ID
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_APPWRITE_ENDPOINT=$NEXT_PUBLIC_APPWRITE_ENDPOINT
ENV NEXT_PUBLIC_APPWRITE_PROJECT_ID=$NEXT_PUBLIC_APPWRITE_PROJECT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY . .
COPY --from=windows-installer /out/xpoint-setup-1.3.4.exe ./apps/panel/public/installers/xpoint-setup-1.3.4.exe
RUN node apps/panel/scripts/package-installer.mjs && rm -rf /app/.local /app/services /app/infra /app/docs
RUN pnpm --config.verify-deps-before-run=false --filter @appremoto/panel build && rm -rf /app/apps/panel/.next/cache

FROM node:24-alpine AS runner
RUN apk add --no-cache curl
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/panel/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/panel/.next/static ./apps/panel/.next/static
COPY --from=builder --chown=node:node /app/apps/panel/public ./apps/panel/public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl --fail --silent --show-error http://127.0.0.1:3000/health || exit 1
USER node
CMD ["node", "apps/panel/server.js"]
