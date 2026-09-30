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
RUN pnpm --filter @appremoto/panel build

FROM node:24-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/panel/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/panel/.next/static ./apps/panel/.next/static
EXPOSE 3000
USER node
CMD ["node", "apps/panel/server.js"]
