FROM node:24-alpine

WORKDIR /app
RUN npm install --global pnpm@11.19.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --prod --frozen-lockfile --filter @appremoto/api...

COPY apps/api/src apps/api/src
COPY packages/contracts/src packages/contracts/src

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
