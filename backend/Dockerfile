# Cloud Run 컨테이너 — Node 22 슬림
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV NODE_ENV=production
CMD ["node", "server.js"]
