FROM node:26-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public/media/archive.json ./public/media/archive.json
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server/index.js"]
