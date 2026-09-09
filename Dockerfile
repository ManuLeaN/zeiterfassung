FROM node:22-alpine

RUN apk add --no-cache tzdata

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

ENV DATA_DIR=/data
ENV PORT=3000
ENV TZ=Europe/Berlin
EXPOSE 3000

VOLUME ["/data"]

CMD ["node", "server.js"]
