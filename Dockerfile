FROM node:18-alpine

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

EXPOSE 3000

COPY package.json package-lock.json* ./

RUN npm ci && npm cache clean --force

COPY . .

RUN npx prisma generate

RUN npm run build

CMD ["npm", "run", "docker-start"]
