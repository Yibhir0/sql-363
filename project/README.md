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
- API: http://localhost:8000
- MongoDB: localhost:27017
- Redis: localhost:6379

## Services

- **backend**: Node.js API server with embedded Python utils
- **worker**: Background worker (same image as backend)
- **mongodb**: MongoDB database
- **redis**: Redis cache

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

## Development

The worker and backend share the same Docker image but run different commands via the entrypoint script.
