# pgapi — Node 22 슬림 (Cloud Run 시절 backend/Dockerfile과 동일 계열)
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js signaling.js ./
ENV NODE_ENV=production
CMD ["node", "server.js"]
