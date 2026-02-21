# Docker Compose Setup

## Quick Start

1. Copy the environment file:
```bash
cp .env.example secrets/.env
```

2. Start all services:
```bash
docker-compose up --build
```

3. Access the application:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Python Utils: http://localhost:15001
- MongoDB: localhost:27017
- Redis: localhost:6379

## Services

- **frontend**: TypeScript frontend (port 3000)
- **backend**: Node.js API server (port 8000)
- **worker**: Background worker (same image as backend)
- **python-utils**: Python utilities service (port 15001)
- **mongodb**: MongoDB database (port 27017)
- **redis**: Redis cache (port 6379)

## Commands

Start services:
```bash
docker-compose up -d
```

View logs:
```bash
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f worker
```

Stop services:
```bash
docker-compose down
```

Rebuild and restart:
```bash
docker-compose up --build -d
```

Clean everything (including volumes):
```bash
docker-compose down -v
```

## Service Communication

Inside containers, services communicate using service names:
- Backend → Python Utils: `http://python-utils:15001`
- Backend → MongoDB: `mongodb://mongodb:27017`
- Backend → Redis: `redis://redis:6379`
- Frontend → Backend: `http://backend:8000`

