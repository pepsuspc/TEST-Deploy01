FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY mock ./mock

EXPOSE 3000

# Env vars come from docker-compose's env_file/environment, not a .env file on
# disk inside the container, so we run node directly (not `npm start`, which
# would try --env-file=.env and fail to find one in here).
CMD ["node", "src/server.js"]
