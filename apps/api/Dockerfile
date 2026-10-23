FROM node:24-alpine

WORKDIR /app

RUN --mount=type=bind,source=apps/api/prebuilt/standalone.tar.gz,target=/tmp/standalone.tar.gz \
    printf '#!/bin/sh\nexec wget -q -O- http://127.0.0.1:${PORT:-3000}/health\n' > /usr/local/bin/curl && \
    chmod +x /usr/local/bin/curl && \
    tar -xzf /tmp/standalone.tar.gz -C /app && \
    mkdir -p /app/node_modules/@appremoto && \
    ln -s ../../packages/contracts /app/node_modules/@appremoto/contracts && \
    chown -R node:node /app

ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health`).then(async (response) => { if (!response.ok || await response.text() !== '{\"status\":\"ok\"}') process.exit(1) }).catch(() => process.exit(1))"]
USER node
CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
