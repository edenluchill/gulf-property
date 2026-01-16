# Multi-stage build for Gulf Property Backend
# Optimized for PDF processing with canvas support

# ============================================================================
# Single-stage build (simpler for development)
# ============================================================================
FROM node:20-alpine

# Install dependencies for pdf2pic (GraphicsMagick) and canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    cairo \
    jpeg-dev \
    jpeg \
    pango-dev \
    pango \
    giflib-dev \
    giflib \
    pixman-dev \
    pixman \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    freetype \
    graphicsmagick \
    ghostscript

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including ts-node for running TypeScript directly)
RUN npm install

# Copy source code
COPY . .

# Create upload directories
RUN mkdir -p /app/uploads/images && \
    mkdir -p /app/uploads/langgraph-output && \
    chmod -R 755 /app/uploads

# Environment
ENV NODE_ENV=development
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Expose port
EXPOSE 3000

# Start server with ts-node using production tsconfig (relaxed checking)
CMD ["npx", "ts-node", "--project", "tsconfig.production.json", "src/index.ts"]
