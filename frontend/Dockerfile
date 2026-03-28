FROM node:20-alpine AS builder

WORKDIR /app

# Copy full monorepo for type resolution (frontend imports types from backend)
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
COPY backend/prisma ./backend/prisma/

# Install deps for both
RUN cd frontend && npm install
RUN cd backend && npm install && npx prisma generate

# Copy source
COPY frontend/ ./frontend/
COPY backend/src/ ./backend/src/
COPY backend/tsconfig.json ./backend/
COPY shared/ ./shared/

WORKDIR /app/frontend

# Build-time env vars baked into client JS bundles
ARG NEXT_PUBLIC_WS_URL=https://markets.parshandspoorthi.com
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/public ./public

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
