FROM node:24-alpine

WORKDIR /app
RUN apk add --no-cache curl
RUN npm install --global pnpm@11.19.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --prod --frozen-lockfile --filter @appremoto/api...

COPY apps/api/src apps/api/src
COPY packages/contracts/src packages/contracts/src

ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health`).then(async (response) => { if (!response.ok || await response.text() !== '{\"status\":\"ok\"}') process.exit(1) }).catch(() => process.exit(1))"]
USER node
CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
