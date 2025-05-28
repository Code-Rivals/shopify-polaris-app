FROM node:18-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci && npm cache clean --force

COPY . .

# Generate Prisma client before building
RUN npx prisma generate

RUN npm run build

CMD ["npm", "run", "docker-start"]
