# CO3404 Option 2 — Microservices + RabbitMQ + Kong API Gateway

A distributed joke service built with Node.js, Express, MongoDB, Docker, RabbitMQ, Auth0, and Kong API Gateway. Deployed across 3 Azure VMs.

## Quick Start (Run Locally)

**Prerequisites:** Docker and Docker Compose installed.

### 1. Start all services

Run these commands **in order** from the `co3404-option2/` directory:

```bash
# 1. RabbitMQ (must start first — creates the shared Docker network)
cd rabbitmq
docker compose up -d
cd ..

# 2. Submit service
cd submit-microservice
docker compose up --build -d
cd ..

# 3. Moderate service
cd moderate-microservice
docker compose up --build -d
cd ..

# 4. Joke service + MongoDB
cd joke-microservice
docker compose up --build -d
cd ..
```

### 2. Access the services

| Service | URL |
|---------|-----|
| Joke App | http://localhost:4000 |
| Submit App | http://localhost:4200 |
| Moderate App | http://localhost:4100 |
| Swagger API Docs | http://localhost:4200/docs |
| RabbitMQ Console | http://localhost:15672 (guest/guest) |

### 3. Test the full flow

1. **Submit a joke** at http://localhost:4200 — fill in setup, punchline, and type, then click Submit
2. **Moderate the joke** at http://localhost:4100 — log in with Auth0, then approve or reject the joke
3. **View the joke** at http://localhost:4000 — select the joke type and click Get Joke

### 4. Stop all services

```bash
cd joke-microservice && docker compose down && cd ..
cd moderate-microservice && docker compose down && cd ..
cd submit-microservice && docker compose down && cd ..
cd rabbitmq && docker compose down && cd ..
```

---

## Architecture

```
User → Kong API Gateway (VM3) → routes to backend services

VM1 (joke-vm):    joke-app, etl-app, MongoDB
VM2 (submit-vm):  submit-app, moderate-app, RabbitMQ
VM3 (kong-vm):    Kong Gateway (HTTPS, rate limiting)
```

### Message Flow

```
Submit App → [SUBMITTED_JOKES queue] → Moderate App → [MODERATED_JOKES queue] → ETL → MongoDB
```

1. User submits a joke → published to RabbitMQ queue `SUBMITTED_JOKES`
2. Moderator approves/rejects → approved jokes published to `MODERATED_JOKES`
3. ETL service consumes from `MODERATED_JOKES` → inserts into MongoDB
4. Joke App reads from MongoDB and serves jokes

### Type Synchronisation

When ETL creates a new joke type, it broadcasts via a RabbitMQ **fanout exchange** (`type_update`). The submit and moderate services receive the update and cache the type list locally.

---

## Project Structure

```
co3404-option2/
├── joke-microservice/          # VM1: Joke retrieval + ETL + MongoDB
│   ├── joke-app/               #   Express server (GET /types, GET /joke/:type)
│   ├── etl/                    #   RabbitMQ consumer → DB writer
│   ├── mongo-init/             #   MongoDB seed data (20 jokes, 4 types)
│   └── docker-compose.yml
│
├── submit-microservice/        # VM2: Joke submission
│   ├── submit-app/             #   Express server (POST /submit, GET /types)
│   └── docker-compose.yml
│
├── moderate-microservice/      # VM2: Joke moderation (Auth0 protected)
│   ├── server.js               #   Pull-based moderation, Auth0 OIDC
│   └── docker-compose.yml
│
├── rabbitmq/                   # VM2: Standalone RabbitMQ broker
│   └── docker-compose.yml
│
├── kong-gateway/               # VM3: API Gateway
│   ├── kong.yaml               #   Declarative routing config
│   ├── certs/                  #   TLS certificates (mkcert)
│   ├── terraform/              #   Azure IaC (3 VMs, VNet, NSGs)
│   └── docker-compose.yml
│
├── deploy.sh                   # Automated deployment (SCP + SSH to Azure VMs)
├── DOCUMENTATION.md            # Full technical documentation
└── README.md                   # This file
```

---

## Key Features

| Feature | Implementation |
|---------|---------------|
| **Message Queue** | RabbitMQ with durable queues and persistent messages |
| **Moderation** | Pull-based (`channel.get`) with Auth0 OIDC authentication |
| **Type Sync** | Fanout exchange broadcasts type updates to all services |
| **API Gateway** | Kong (DB-less) with HTTPS termination and rate limiting (5 req/min on `/joke`) |
| **Database** | MongoDB with adapter pattern (MySQL also supported via `DB_TYPE` env var) |
| **IaC** | Terraform provisions 3 Azure VMs, VNet, NSGs, and deploys all services |
| **Resilience** | Retry logic, persistent queues, file-based cache fallback, `restart: unless-stopped` |
| **API Docs** | Swagger UI at `/docs` on the submit service |

---

## Environment Variables

Each service has a `.env` file with sensible defaults for local testing. No changes needed to run locally.

| File | Key Variables |
|------|--------------|
| `rabbitmq/.env` | `RABBITMQ_USER`, `RABBITMQ_PASS` |
| `joke-microservice/.env` | `DB_TYPE`, `DB_HOST`, `DB_NAME`, `RABBITMQ_IP` |
| `submit-microservice/.env` | `RABBITMQ_USER`, `RABBITMQ_PASS`, `VM1_PRIVATE_IP` |
| `moderate-microservice/.env` | `RABBITMQ_USER`, `RABBITMQ_PASS`, Auth0 credentials, `BASE_URL` |

---

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js / Express | Web servers and APIs |
| MongoDB | Persistent data storage |
| RabbitMQ | Message queue + fanout exchange |
| Docker / Docker Compose | Containerisation |
| Kong | API Gateway, reverse proxy, rate limiting |
| Auth0 (OIDC) | Authentication for moderation |
| Terraform | Infrastructure as Code (Azure) |
| Swagger UI | API documentation |
| mkcert | TLS certificate generation |

---

For full technical details, see [DOCUMENTATION.md](DOCUMENTATION.md).
