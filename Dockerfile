# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for tsc)
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source and compile TypeScript
COPY src/ src/
COPY scripts/ scripts/
COPY tsconfig.json ./
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build /app/dist/ dist/

# Copy example configs
COPY configs/ configs/

ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "dist/cli.js"]
