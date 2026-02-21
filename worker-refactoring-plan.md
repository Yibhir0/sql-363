# Node.js Worker Refactoring Plan

## Overview

Separate the BullMQ worker from the Express API server to improve reliability, performance, and scalability.

## Current Architecture Issues

1. **Worker and API in same process** - CPU-intensive file parsing blocks the event loop, making API unresponsive
2. **Single point of failure** - If worker crashes, API goes down (and vice versa)
3. **Can't scale independently** - Must scale API and worker together
4. **No job result TTL** - Redis fills up with old results
5. **No retry mechanism** - Transient failures kill jobs permanently

## Target Architecture

```
API Server Process:
- Express app (routes/middleware/controllers)
- Redis client (cache - db 0)
- BullMQ Queue client (adds jobs to db 1)
- MongoDB client

Worker Process:
- BullMQ Worker (processes jobs from db 1)
- Services for file parsing
- Redis client (job results - db 1)
- MongoDB client
- Calls Python service for parsing

Communication:
- API → Redis Queue (db 1) → Worker
- Worker → Redis Cache (db 1) → API
- Worker → Python Service (HTTP)
```

## Refactoring Steps

### Step 1: Update Redis Client Configuration

**File:** `lib/redisClient.ts`

Replace entire file with:

```typescript
import { createClient } from 'redis';
import Sentry from '@sentry/node';

// API cache (db 0)
const cacheRedisUrl = process.env.REDIS_CACHE_URL || 'redis://localhost:6379/0';
export const cacheRedisClient = createClient({ url: cacheRedisUrl });

cacheRedisClient.on('error', (err) => {
  Sentry.captureException(err, { extra: { error: 'Cache Redis Error' } });
  console.error('Cache Redis Error:', err);
});

cacheRedisClient.on('connect', () => {
  console.log('Connected to Cache Redis (db 0)');
});

// Job queue + results (db 1)
const jobRedisUrl = process.env.REDIS_JOB_URL || 'redis://localhost:6379/1';
export const jobRedisClient = createClient({ url: jobRedisUrl });

jobRedisClient.on('error', (err) => {
  Sentry.captureException(err, { extra: { error: 'Job Redis Error' } });
  console.error('Job Redis Error:', err);
});

jobRedisClient.on('connect', () => {
  console.log('Connected to Job Redis (db 1)');
});

export const connectRedis = async () => {
  if (!cacheRedisClient.isOpen) await cacheRedisClient.connect();
  if (!jobRedisClient.isOpen) await jobRedisClient.connect();
};

export default cacheRedisClient; // For general API cache
```

**Changes:**
- Split into two Redis clients: `cacheRedisClient` (db 0) and `jobRedisClient` (db 1)
- API cache uses db 0
- Job queue and results use db 1

---

### Step 2: Update Cache Functions

**File:** `lib/cache.ts`

Update imports and job-related functions:

```typescript
import { cacheRedisClient, jobRedisClient } from './redisClient';
import { RESULT_TTL_SECONDS } from '@utils/constants';

const resultKey = (jobId: string): string => `job:timeline:${jobId}`;

// Job result functions use db 1
export async function cacheJobResult(jobId: string, payload: unknown): Promise<void> {
  await jobRedisClient.setEx(
    resultKey(jobId), 
    86400,  // 24 hours TTL
    JSON.stringify(payload)
  );
}

interface CachedJobResult<T = unknown> {
  payload: {
    status: string;
    data: T;
  };
}

export async function getJobResult<T = unknown>(jobId: string): Promise<CachedJobResult<T> | null> {
  const raw = (await jobRedisClient.get(resultKey(jobId))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as CachedJobResult<T>;
}

export async function deleteJobResult(jobId: string): Promise<void> {
  await jobRedisClient.del(resultKey(jobId));
}

export async function extendJobTTL(jobId: string): Promise<void> {
  await jobRedisClient.expire(resultKey(jobId), RESULT_TTL_SECONDS);
}

// API cache functions use db 0
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await cacheRedisClient.get(key);
  const str = toStringValue(raw);
  if (!str) return null;
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  await cacheRedisClient.setEx(key, ttlSeconds, JSON.stringify(value));
}

export async function cacheDel(key: string): Promise<void> {
  await cacheRedisClient.del(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  const keys = await cacheRedisClient.keys(pattern);
  if (keys.length > 0) {
    await cacheRedisClient.del(keys);
  }
}

function toStringValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString("utf8");
  }
  return String(raw);
}
```

**Changes:**
- Job result functions (`cacheJobResult`, `getJobResult`, etc.) now use `jobRedisClient` (db 1)
- API cache functions (`cacheGet`, `cacheSet`, etc.) use `cacheRedisClient` (db 0)
- Added 24-hour TTL to job results

---

### Step 3: Update Worker Queue Configuration

**File:** `workers/queue.ts`

Update Redis connection and add retry logic:

```typescript
import { Queue, Worker, Job } from 'bullmq';
import { readFile, unlink } from 'node:fs/promises';
import { buildTimeline, buildTimelineFromDB } from '../services/timeline/timelineService';
import { cacheJobResult } from '../lib/cache';

export type CourseProcessorJobData =
  | { jobId: string; kind: 'file'; filePath: string }
  | { jobId: string; kind: 'body'; body: any }
  | { jobId: string; kind: 'timelineData'; timelineId: string };

const redisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || '6379'),
  db: 1,  // Use database 1 for queue
};

export const queue = new Queue<CourseProcessorJobData>('courseProcessor', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

const CONCURRENCY = 2;

export const courseProcessorWorker = new Worker<CourseProcessorJobData>(
  'courseProcessor',
  async (job: Job<CourseProcessorJobData>) => {
    const { jobId } = job.data;

    try {
      let result;
      switch (job.data.kind) {
        case 'file': {
          const fileBuffer = await readFile(job.data.filePath);
          result = await buildTimeline({
            type: 'file',
            data: fileBuffer,
          });
          break;
        }

        case 'body': {
          result = await buildTimeline({
            type: 'form',
            data: job.data.body,
          });
          break;
        }

        case 'timelineData': {
          result = await buildTimelineFromDB(job.data.timelineId);
          break;
        }

        default:
          throw new Error(`the job data type provided is not supported`);
      }

      await cacheJobResult(jobId, {
        payload: { status: 'done', data: result },
      });
    } catch (err) {
      console.error(`Error processing job ${jobId}:`, err);
      throw err;
    } finally {
      if (job.data.kind === 'file') {
        const { filePath } = job.data;
        try {
          await unlink(filePath);
        } catch (error_) {
          if (error_ instanceof Error) {
            console.warn(
              `Failed to delete temp file ${filePath}:`,
              error_.message,
            );
          } else {
            console.warn(`Failed to delete temp file ${filePath}:`, error_);
          }
        }
      }
    }
  },
  {
    connection: redisOptions,
    concurrency: CONCURRENCY,
  },
);

courseProcessorWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

courseProcessorWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});
```

**Changes:**
- Added `db: 1` to Redis options
- Added retry logic: 3 attempts with exponential backoff
- Added event listeners for completed/failed jobs

---

### Step 4: Create Worker Entry Point

**File:** `worker.ts` (new file in root)

```typescript
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectRedis } from '@lib/redisClient';
import './workers/queue';

// Sentry init
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1,
});

// Load environment variables
if (process.env.NODE_ENV === 'development') {
  const loadEnv = dotenv.config({
    path: path.resolve(__dirname, '../secrets/.env'),
    debug: true,
  });
  if (loadEnv.error) {
    console.error('Error loading .env file:', loadEnv.error);
    throw loadEnv.error;
  }
}

// MongoDB connection
const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:changeme123@localhost:27017/trackmydegree';

const start = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Worker connected to MongoDB');

    // Connect to Redis
    await connectRedis();
    console.log('Worker started and listening for jobs...');
  } catch (err) {
    console.error('Failed to start worker:', err);
    Sentry.captureException(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down worker...');
  try {
    const { courseProcessorWorker } = await import('./workers/queue');
    await courseProcessorWorker.close();
    await mongoose.connection.close();
    console.log('Worker shut down gracefully');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason: any) => {
  Sentry.captureException(reason);
  console.error('Unhandled Rejection in worker:', reason);
});

start();
```

**Purpose:**
- Separate entry point for worker process
- Connects to MongoDB and Redis (same as API server)
- Starts BullMQ worker
- Handles graceful shutdown
- Includes Sentry error tracking

---

### Step 5: Update Main Server File

**File:** `server.ts`

Remove worker import if present:

```typescript
// Remove this line if you have it:
// import './workers/queue';

// Keep only queue export for adding jobs
import { queue } from './workers/queue';

// Rest of your server code...
```

**Changes:**
- API server no longer starts the worker
- Only imports `queue` to add jobs

---

### Step 6: Update Docker Compose

**File:** `docker-compose.yml`

Add API and worker services:

```yaml
version: "3.8"

services:
  api:
    build:
      context: ./Back-End
      dockerfile: Dockerfile
    container_name: api_service
    ports:
      - "3000:3000"
    command: node dist/server.js
    volumes:
      - upload-files:/app/tmp/pdf-uploads
    env_file:
      - ./secrets/.env
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MONGODB_URL=mongodb://mongodb:27017
      - PYTHON_UTILS_URL=http://python_utils:15001
    depends_on:
      - mongodb
      - redis
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build:
      context: ./Back-End
      dockerfile: Dockerfile
    container_name: worker_service
    command: node dist/worker.js
    volumes:
      - upload-files:/app/tmp/pdf-uploads
    env_file:
      - ./secrets/.env
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MONGODB_URL=mongodb://mongodb:27017
      - PYTHON_UTILS_URL=http://python_utils:15001
    depends_on:
      - mongodb
      - redis
    networks:
      - app-network
    restart: unless-stopped
    deploy:
      replicas: 2

  python_utils:
    build:
      context: ./Back-End/python_utils
      dockerfile: Dockerfile
    container_name: python_utils_service
    ports:
      - "15001:15001"
    env_file:
      - ./secrets/.env
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:15001/health"]
      interval: 30s

  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
    env_file:
      - ./secrets/.env
    volumes:
      - mongodb-data:/data/db
    networks:
      - app-network
    restart: unless-stopped

  redis:
    image: redis:latest
    container_name: my-redis
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - app-network
    restart: unless-stopped

networks:
  app-network:
    driver: bridge

volumes:
  redis-data:
  mongodb-data:
  upload-files:
```

**Changes:**
- Added `api` service (runs `server.js`)
- Added `worker` service (runs `worker.js`, 2 replicas)
- Added shared volume `upload-files` for file uploads
- Added health checks
- Added restart policies
- Enabled Redis persistence with `--appendonly yes`

```yaml
version: "3.8"

services:
  api:
    build:
      context: ./Back-End
      dockerfile: Dockerfile
    container_name: api_service
    ports:
      - "3000:3000"
    command: node dist/server.js
    volumes:
      - upload-files:/app/tmp/pdf-uploads
    env_file:
      - ./secrets/.env
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MONGODB_URL=mongodb://mongodb:27017
      - PYTHON_UTILS_URL=http://python_utils:15001
    depends_on:
      - mongodb
      - redis
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build:
      context: ./Back-End
      dockerfile: Dockerfile
    container_name: worker_service
    command: node dist/worker.js
    volumes:
      - upload-files:/app/tmp/pdf-uploads
    env_file:
      - ./secrets/.env
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MONGODB_URL=mongodb://mongodb:27017
      - PYTHON_UTILS_URL=http://python_utils:15001
    depends_on:
      - mongodb
      - redis
    networks:
      - app-network
    restart: unless-stopped
    deploy:
      replicas: 2

  python_utils:
    build:
      context: ./Back-End/python_utils
      dockerfile: Dockerfile
    container_name: python_utils_service
    ports:
      - "15001:15001"
    env_file:
      - ./secrets/.env
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:15001/health"]
      interval: 30s

  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
    env_file:
      - ./secrets/.env
    volumes:
      - mongodb-data:/data/db
    networks:
      - app-network
    restart: unless-stopped

  redis:
    image: redis:latest
    container_name: my-redis
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - app-network
    restart: unless-stopped

networks:
  app-network:
    driver: bridge

volumes:
  redis-data:
  mongodb-data:
  upload-files:
```

**Changes:**
- Added `api` service (runs `server.js`)
- Added `worker` service (runs `worker.js`, 2 replicas)
- Added shared volume `upload-files` for file uploads
- Added health checks
- Added restart policies
- Enabled Redis persistence with `--appendonly yes`

---

### Step 7: Update Dockerfile (if needed)

**File:** `Back-End/Dockerfile`

Ensure it builds both entry points:

```dockerfile
FROM node:18-alpine
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy source code
COPY . .

# Build TypeScript (compiles both server.ts and worker.ts)
RUN npm run build

# Expose API port
EXPOSE 8000

# Default command (can be overridden in docker-compose)
CMD ["node", "dist/server.js"]
```

**Note:** The same Docker image is used for both API and worker, with different commands specified in docker-compose.

---

### Step 8: Update Environment Variables

**File:** `secrets/backend.env`

Add or verify these variables:

```env
# MongoDB
MONGODB_URI=mongodb://admin:changeme123@mongodb:27017/trackmydegree

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Node Environment
NODE_ENV=production
BACKEND_PORT=8000

# Sentry
SENTRY_DSN=your-sentry-dsn

# Add any other existing environment variables
```

**For local development** (`.env` file):

```env
# MongoDB
MONGODB_URI=mongodb://admin:changeme123@localhost:27017/trackmydegree

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Node Environment
NODE_ENV=development
BACKEND_PORT=8000

# Sentry
SENTRY_DSN=your-sentry-dsn
```

---

## Running Locally (Development)

### Terminal 1 - API Server
```bash
npm run dev
# or
ts-node server.ts
```

### Terminal 2 - Worker
```bash
ts-node worker.ts
```

### Terminal 3 - Python Service (if not in Docker)
```bash
cd Back-End/python_utils
python app.py
```

---

## Running in Production (Docker)

### Production Docker Compose Configuration

**File:** `docker-compose.production.yml`

```yaml
version: "3.8"

services:
  traefik:
    container_name: traefik
    image: traefik:v3
    restart: always
    ports:
      - "443:443"
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.websecure.address=:443
      - --providers.file.filename=/traefik/dynamic.yml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik/:/traefik/:ro
    networks:
      - app-network
    labels:
      - "traefik.enable=false"

  frontend:
    container_name: frontend
    image: ghcr.io/ikozay/trackmydegree-frontend:production
    restart: always
    expose:
      - "4173"
    environment:
      - VITE_NODE_ENV=production
      - VITE_API_SERVER=https://trackmydegree.ca/api
      - VITE_POSTHOG_KEY=phc_F2YuzjGC9JBSTL3xgdrH2OKv9u8voG2e7XSYiAP7F5z
      - VITE_POSTHOG_HOST=https://us.i.posthog.com
    networks:
      - app-network
    depends_on:
      - backend
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.frontend.rule=Host(`${DOMAIN}`) && !PathPrefix(`/api`)"
      - "traefik.http.routers.frontend.entrypoints=websecure"
      - "traefik.http.routers.frontend.tls=true"
      - "traefik.http.services.frontend.loadbalancer.server.port=4173"

  backend:
    container_name: backend
    image: ghcr.io/ikozay/trackmydegree-backend:production
    restart: always
    expose:
      - "8000"
    command: node dist/server.js
    volumes:
      - ./backups:/var/backups
      - upload-files:/app/tmp/pdf-uploads
    env_file:
      - ./secrets/backend.env
    networks:
      - app-network
    depends_on:
      - redis
      - mongodb
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.backend.rule=Host(`${DOMAIN}`) && (PathPrefix(`/api`))"
      - "traefik.http.routers.backend.entrypoints=websecure"
      - "traefik.http.routers.backend.tls=true"
      - "traefik.http.services.backend.loadbalancer.server.port=8000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    container_name: worker
    image: ghcr.io/ikozay/trackmydegree-backend:production
    restart: always
    command: node dist/worker.js
    volumes:
      - upload-files:/app/tmp/pdf-uploads
    env_file:
      - ./secrets/backend.env
    networks:
      - app-network
    depends_on:
      - redis
      - mongodb
    deploy:
      replicas: 2
    labels:
      - "traefik.enable=false"

  mongodb:
    container_name: mongodb
    image: mongo:8.2
    restart: always
    expose:
      - "27017"
    volumes:
      - mongodb-data:/data/db
    env_file:
      - ./secrets/mongo.env
    networks:
      - app-network
    labels:
      - "traefik.enable=false"

  redis:
    container_name: redis
    image: redis:8.2
    restart: always
    command: redis-server --appendonly yes
    expose:
      - "6379"
    volumes:
      - redis-data:/data
    networks:
      - app-network
    labels:
      - "traefik.enable=false"

  watchtower:
    container_name: watchtower
    image: containrrr/watchtower
    restart: always
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --schedule "0 0 4 * * *"
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_NOTIFICATIONS_LEVEL=info
      - WATCHTOWER_DEBUG=false
      - WATCHTOWER_REGISTRY_AUTH=true
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  redis-data:
  mongodb-data:
  upload-files:
```

**Key Changes for Production:**
1. **Backend service** - Added explicit `command: node dist/server.js` and shared volume
2. **Worker service** - New service using same backend image with `command: node dist/worker.js`
3. **Shared volume** - `upload-files` volume shared between backend and worker
4. **Redis persistence** - Added `--appendonly yes` for data durability
5. **Worker replicas** - Set to 2 for redundancy
6. **Health checks** - Added to backend service

### Build and start all services
```bash
docker-compose -f docker-compose.production.yml up -d --build
```

### Scale workers independently
```bash
docker-compose -f docker-compose.production.yml up -d --scale worker=3
```

### View logs
```bash
# All services
docker-compose -f docker-compose.production.yml logs -f

# Specific service
docker-compose -f docker-compose.production.yml logs -f worker
docker-compose -f docker-compose.production.yml logs -f backend
```

### Stop services
```bash
docker-compose -f docker-compose.production.yml down
```

### Update Backend Dockerfile

Ensure your Dockerfile builds both entry points:

**File:** `Back-End/Dockerfile`

```dockerfile
FROM node:18-alpine
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy source code
COPY . .

# Build TypeScript (compiles both server.ts and worker.ts)
RUN npm run build

# Expose API port
EXPOSE 8000

# Default command (can be overridden in docker-compose)
CMD ["node", "dist/server.js"]
```

**Note:** The same Docker image is used for both backend and worker services. The `command` in docker-compose determines which entry point runs.

---

## Data Flow

### 1. User uploads file
```
POST /timeline/upload
↓
API receives file → saves to ./tmp/pdf-uploads/{jobId}.pdf
↓
API adds job to Redis queue (db 1)
↓
API returns { jobId, status: 'processing' }
```

### 2. Worker processes job
```
Worker picks job from Redis queue (db 1)
↓
Worker reads file from ./tmp/pdf-uploads/{jobId}.pdf
↓
Worker calls Python service to parse file
↓
Worker saves result to Redis cache (db 1) with 24h TTL
↓
Worker deletes temp file
```

### 3. User checks status
```
GET /timeline/status/{jobId}
↓
API checks Redis cache (db 1)
↓
API returns { status: 'done', data: {...} }
```

---

## Redis Database Usage

- **Database 0**: API response cache (general caching)
- **Database 1**: BullMQ job queue + job results

---

## Benefits of This Architecture

1. **Isolation** - API stays responsive during heavy file processing
2. **Reliability** - Worker crash doesn't affect API (and vice versa)
3. **Scalability** - Scale workers independently (2+ replicas)
4. **Retry logic** - Transient failures auto-recover (3 attempts)
5. **Memory management** - Job results auto-expire after 24 hours
6. **Graceful shutdown** - Workers finish current jobs before stopping
7. **Monitoring** - Separate logs for API and worker processes

---

## Testing the Refactoring

### 1. Test locally first
```bash
# Start MongoDB, Redis (via docker-compose or locally)
docker-compose up -d mongodb redis

# Terminal 1 - API Server
npm run dev

# Terminal 2 - Worker
ts-node worker.ts

# Terminal 3 - Test upload
curl -X POST http://localhost:8000/api/timeline/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf"

# Check worker logs for processing
# Check API response for job status
```

### 2. Test in Docker (development)
```bash
# Build and start services
docker-compose up -d --build

# Check logs
docker-compose logs -f worker
docker-compose logs -f backend

# Upload file via API
curl -X POST http://localhost:8000/api/timeline/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf"
```

### 3. Test in Production
```bash
# Deploy with production compose file
docker-compose -f docker-compose.production.yml up -d --build

# Monitor worker logs
docker-compose -f docker-compose.production.yml logs -f worker

# Test via your domain
curl -X POST https://trackmydegree.ca/api/timeline/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf"
```

### 4. Test failure scenarios
```bash
# Test worker restart
docker-compose restart worker
# Verify API still responds

# Test job retry
# Stop Python service temporarily
docker-compose stop python_utils
# Upload file - should see retries in worker logs
# Start Python service
docker-compose start python_utils
# Job should complete on retry

# Test file cleanup
# Upload file and verify it's deleted after processing
ls ./tmp/pdf-uploads/
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All code changes committed and pushed
- [ ] Backend Docker image built and pushed to GitHub Container Registry
- [ ] Environment variables configured in `secrets/backend.env`
- [ ] MongoDB credentials configured in `secrets/mongo.env`
- [ ] Traefik certificates in place
- [ ] Domain DNS configured

### Deployment Steps

1. **Pull latest code on server**
```bash
cd /path/to/project
git pull origin main
```

2. **Pull latest Docker images**
```bash
docker-compose -f docker-compose.production.yml pull
```

3. **Stop existing services**
```bash
docker-compose -f docker-compose.production.yml down
```

4. **Start services with new configuration**
```bash
docker-compose -f docker-compose.production.yml up -d
```

5. **Verify services are running**
```bash
docker-compose -f docker-compose.production.yml ps
```

6. **Check logs for errors**
```bash
docker-compose -f docker-compose.production.yml logs -f backend
docker-compose -f docker-compose.production.yml logs -f worker
```

7. **Test API endpoint**
```bash
curl https://trackmydegree.ca/api/health
```

8. **Test file upload and processing**
```bash
# Upload via frontend or API
# Monitor worker logs
docker-compose -f docker-compose.production.yml logs -f worker
```

### Post-Deployment Verification
- [ ] API responds to requests
- [ ] Worker processes jobs successfully
- [ ] File uploads work
- [ ] Job results cached correctly
- [ ] Redis persistence enabled
- [ ] MongoDB connection stable
- [ ] Traefik routing works
- [ ] HTTPS certificates valid
- [ ] Watchtower running for auto-updates

### Scaling Workers (if needed)
```bash
# Scale to 3 workers
docker-compose -f docker-compose.production.yml up -d --scale worker=3

# Verify
docker-compose -f docker-compose.production.yml ps worker
```

### Rollback Procedure
If issues occur:

1. **Revert to previous image**
```bash
docker-compose -f docker-compose.production.yml down
# Edit docker-compose.production.yml to use previous image tag
docker-compose -f docker-compose.production.yml up -d
```

2. **Or revert code changes**
```bash
git revert HEAD
git push origin main
# Rebuild and redeploy
```

3. **Emergency: Merge worker back into API**
```bash
# In server.ts, add back:
import './workers/queue';

# Rebuild and deploy
```

---

## Monitoring Checklist

- [ ] Worker processes jobs successfully
- [ ] API response times remain fast during processing
- [ ] Job results expire after 24 hours
- [ ] Failed jobs retry 3 times
- [ ] Worker restarts automatically on crash
- [ ] Shared volume works (API writes, worker reads)
- [ ] Python service calls succeed from worker

---

## Future Improvements (Optional)

1. **S3 for file storage** - Remove shared volume dependency
2. **Redis Sentinel** - High availability for Redis
3. **Prometheus metrics** - Track job processing times
4. **Dead letter queue** - Handle permanently failed jobs
5. **Job priority** - Process urgent jobs first
6. **Rate limiting** - Limit Python service calls
7. **Horizontal scaling** - Add load balancer for API

---

## Summary

This refactoring separates the worker from the API server, improving reliability and performance for your organization's internal tool. The changes are minimal, backward-compatible, and can be tested locally before deploying to production.

 Put worker.ts in the same directory as server.ts.

Your structure:
Back-End/
├── server.ts          (existing)
├── worker.ts          (new - same level as server.ts)
├── workers/
│   └── queue.ts       (existing)
├── lib/
│   ├── redisClient.ts
│   └── cache.ts
├── services/
├── controllers/
├── routes/
└── package.json

