# Pinzos PDF Processing Worker
# Dedicated to heavy PDF/AI processing

# ============================================================================
# Stage 1: Build
# ============================================================================
FROM node:20-alpine AS builder

# Install build dependencies for native modules (canvas, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconf \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:20-alpine

# Install runtime dependencies for PDF processing
RUN apk add --no-cache \
    graphicsmagick \
    ghostscript \
    cairo \
    pango \
    libjpeg-turbo \
    giflib \
    librsvg \
    pixman

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist

# Create directories for processing
RUN mkdir -p /app/temp /app/uploads && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Environment
ENV NODE_ENV=production

# Worker memory settings - allow using full server resources
# GC will manage memory, avoiding hard kills
ENV NODE_OPTIONS="--max-old-space-size=6144 --expose-gc"

# Health check - verify process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD pgrep -f "node dist/index.js" || exit 1

# Start the worker
CMD ["node", "dist/index.js"]
