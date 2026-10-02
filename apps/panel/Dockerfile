FROM golang:1.26-alpine AS windows-installer
WORKDIR /agent
COPY services/agent/go.mod services/agent/go.sum ./
RUN go mod download
COPY services/agent/ ./
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w -H=windowsgui' -o /out/xpoint-setup-1.2.2.exe ./cmd/remote-setup

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/panel/package.json apps/panel/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @appremoto/panel...

FROM base AS builder
ARG NEXT_PUBLIC_APPWRITE_ENDPOINT
ARG NEXT_PUBLIC_APPWRITE_PROJECT_ID
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_APPWRITE_ENDPOINT=$NEXT_PUBLIC_APPWRITE_ENDPOINT
ENV NEXT_PUBLIC_APPWRITE_PROJECT_ID=$NEXT_PUBLIC_APPWRITE_PROJECT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/panel/node_modules ./apps/panel/node_modules
COPY --from=dependencies /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY . .
COPY --from=windows-installer /out/xpoint-setup-1.2.2.exe ./apps/panel/public/installers/xpoint-setup-1.2.2.exe
RUN node apps/panel/scripts/package-installer.mjs
RUN pnpm --filter @appremoto/panel build

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
