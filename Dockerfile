FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

ENV PORT=3000
ENV DB_PATH=/app/data/analyses.db

EXPOSE 3000

CMD ["node", "dist/index.js"]
