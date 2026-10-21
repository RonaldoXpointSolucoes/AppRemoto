FROM node:24-alpine AS runner
ARG NEXT_PUBLIC_APPWRITE_ENDPOINT
ARG NEXT_PUBLIC_APPWRITE_PROJECT_ID
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_APPWRITE_ENDPOINT=$NEXT_PUBLIC_APPWRITE_ENDPOINT
ENV NEXT_PUBLIC_APPWRITE_PROJECT_ID=$NEXT_PUBLIC_APPWRITE_PROJECT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NO_INSTALLER_CACHE=1

WORKDIR /app

RUN --mount=type=bind,source=apps/panel/prebuilt/standalone.tar.gz,target=/tmp/standalone.tar.gz \
    --mount=type=bind,source=services/agent/prebuilt/xpoint-setup-1.3.6.exe,target=/tmp/xpoint-setup-1.3.6.exe \
    --mount=type=bind,source=services/agent/prebuilt/xpoint-setup-1.3.6-x86.exe,target=/tmp/xpoint-setup-1.3.6-x86.exe \
    --mount=type=bind,source=services/agent/prebuilt/xpoint-setup-1.3.6-win7.exe,target=/tmp/xpoint-setup-1.3.6-win7.exe \
    --mount=type=bind,source=apps/panel/scripts,target=/tmp/scripts \
    printf '#!/bin/sh\nexec wget -q -O- http://127.0.0.1:3000/health\n' > /usr/local/bin/curl && \
    chmod +x /usr/local/bin/curl && \
    tar -xzf /tmp/standalone.tar.gz -C /app && \
    mkdir -p /app/apps/panel/public/installers /app/apps/panel/scripts && \
    cp /tmp/xpoint-setup-1.3.6.exe /app/apps/panel/public/installers/xpoint-setup-1.3.6.exe && \
    cp /tmp/xpoint-setup-1.3.6-x86.exe /app/apps/panel/public/installers/xpoint-setup-1.3.6-x86.exe && \
    cp /tmp/xpoint-setup-1.3.6-win7.exe /app/apps/panel/public/installers/xpoint-setup-1.3.6-win7.exe && \
    touch /app/apps/panel/public/installers/xpoint-complete-1.3.6.exe \
          /app/apps/panel/public/installers/xpoint-complete-1.3.6-x86.exe \
          /app/apps/panel/public/installers/xpoint-complete-1.3.6-win7.exe \
          /app/apps/panel/public/installers/complete-manifest.json \
          /app/apps/panel/public/installers/complete-manifest-x86.json \
          /app/apps/panel/public/installers/complete-manifest-win7.json && \
    cp -r /tmp/scripts/. /app/apps/panel/scripts/ && \
    chown -R node:node /app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl --fail --silent --show-error http://127.0.0.1:3000/health || exit 1
USER node
CMD ["sh", "-c", "(node /app/apps/panel/scripts/package-installer.mjs || true) & exec node apps/panel/server.js"]
