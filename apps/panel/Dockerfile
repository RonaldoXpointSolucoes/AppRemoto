FROM node:24-alpine AS runner
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ARG NEXT_PUBLIC_APPWRITE_ENDPOINT
ARG NEXT_PUBLIC_APPWRITE_PROJECT_ID
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_APPWRITE_ENDPOINT=$NEXT_PUBLIC_APPWRITE_ENDPOINT
ENV NEXT_PUBLIC_APPWRITE_PROJECT_ID=$NEXT_PUBLIC_APPWRITE_PROJECT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

WORKDIR /build
COPY . /build

RUN apk add --no-cache curl && \
    corepack enable && \
    pnpm install --prod --frozen-lockfile --filter @appremoto/panel... --store-dir /tmp/pnpm-store --config.package-import-method=hardlink && \
    rm -rf /tmp/pnpm-store /pnpm/store /root/.local/share/pnpm/store /root/.cache && \
    mkdir -p /build/node_modules/typescript/lib /build/node_modules/@types/react /build/node_modules/@types/node && \
    printf '{"name":"typescript","version":"5.9.0"}\n' > /build/node_modules/typescript/package.json && \
    printf 'module.exports={};\n' > /build/node_modules/typescript/lib/typescript.js && \
    printf '{"name":"@types/react","version":"19.2.0"}\n' > /build/node_modules/@types/react/package.json && \
    touch /build/node_modules/@types/react/index.d.ts && \
    printf '{"name":"@types/node","version":"24.0.0"}\n' > /build/node_modules/@types/node/package.json && \
    touch /build/node_modules/@types/node/index.d.ts && \
    mkdir -p /build/apps/panel/public/installers && \
    mv /build/services/agent/prebuilt/xpoint-setup-1.3.4.exe /build/apps/panel/public/installers/xpoint-setup-1.3.4.exe && \
    node /build/apps/panel/scripts/package-installer.mjs && \
    rm -rf /build/services && \
    pnpm --config.verify-deps-before-run=false --filter @appremoto/panel build && \
    rm -rf /build/node_modules /build/apps/panel/node_modules /build/packages/contracts/node_modules /build/apps/panel/.next/cache && \
    mkdir -p /app && \
    cp -a /build/apps/panel/.next/standalone/. /app/ && \
    cp -a /build/apps/panel/.next/static /app/apps/panel/.next/static && \
    cp -a /build/apps/panel/public /app/apps/panel/public && \
    rm -rf /build /pnpm /root/.local /root/.cache /tmp/* && \
    chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl --fail --silent --show-error http://127.0.0.1:3000/health || exit 1
USER node
CMD ["node", "apps/panel/server.js"]
