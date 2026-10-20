# Node.js LTS 22 (Render provides node 20 by default; pin to a compatible major)
FROM node:22-alpine

# Set working directory to the server subfolder
WORKDIR /app/server

# Copy package files first for layer caching
COPY server/package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy the rest of the server source
COPY server/ ./

# Render injects PORT as 10000 by default
EXPOSE 10000

# Health check so Render knows when the container is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://localhost:10000/api/health || exit 1

CMD ["node", "server.js"]
