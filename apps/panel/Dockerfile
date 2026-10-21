FROM node:24-alpine AS runner
RUN apk add --no-cache curl
ARG NEXT_PUBLIC_APPWRITE_ENDPOINT
ARG NEXT_PUBLIC_APPWRITE_PROJECT_ID
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_APPWRITE_ENDPOINT=$NEXT_PUBLIC_APPWRITE_ENDPOINT
ENV NEXT_PUBLIC_APPWRITE_PROJECT_ID=$NEXT_PUBLIC_APPWRITE_PROJECT_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app
COPY apps/panel/prebuilt/standalone.tar.gz /tmp/standalone.tar.gz
COPY services/agent/prebuilt/xpoint-setup-1.3.4.exe /tmp/xpoint-setup-1.3.4.exe
COPY apps/panel/scripts /app/apps/panel/scripts

RUN tar -xzf /tmp/standalone.tar.gz -C /app && \
    rm -f /tmp/standalone.tar.gz && \
    mkdir -p /app/apps/panel/public/installers && \
    mv /tmp/xpoint-setup-1.3.4.exe /app/apps/panel/public/installers/xpoint-setup-1.3.4.exe && \
    node /app/apps/panel/scripts/package-installer.mjs && \
    rm -rf /app/.local /app/apps/panel/scripts /root/.cache /tmp/* && \
    chown -R node:node /app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl --fail --silent --show-error http://127.0.0.1:3000/health || exit 1
USER node
CMD ["node", "apps/panel/server.js"]
