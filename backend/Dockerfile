FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3001

# Run migrations and start
CMD ["sh", "-c", "sleep 10 && npm run migrate || true && npm run start:prod"]
