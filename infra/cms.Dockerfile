# The Content Room is a Vite build; the CMS runs its TypeScript directly on
# Node's built-in type stripping, so the runtime image has no compiler.
FROM node:26-bookworm-slim AS admin
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json ./
COPY admin ./admin
COPY shared ./shared
RUN npm run build:admin

FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY public/media ./public/media
COPY public/nolle-studios-mark.svg public/favicon.svg public/favicon.ico ./public/
COPY --from=admin /app/dist-admin ./dist-admin
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/index.ts"]
