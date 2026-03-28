FROM node:20-alpine

WORKDIR /app

# Copy package files + prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install all deps (need devDeps for build), generate Prisma client
RUN npm install && npx prisma generate

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDeps
RUN npm prune --production

EXPOSE 3001

CMD ["node", "dist/index.js"]
