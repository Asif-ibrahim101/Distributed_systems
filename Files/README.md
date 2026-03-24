# CO3404 Distributed Systems — Joke Service

A distributed joke service built with Node.js, Express, MongoDB/MySQL, Docker, RabbitMQ, and Kong API Gateway.

## Project Structure

```
├── co3404-option1/                # Monolithic architecture (HIGH 3rd class)
│   ├── joke-app/                  # Joke retrieval app (port 4000)
│   ├── submit-app/                # Joke submission app (port 4200)
│   ├── db-init/                   # MySQL schema + seed data
│   └── docker-compose.yml         # All services on one machine
│
└── co3404-option2/                # Microservices & API Gateway (HIGH 2:2 / HIGH 2:1)
    ├── joke-microservice/         # VM1: joke-app + ETL + MongoDB/MySQL
    ├── submit-microservice/       # VM2: submit-app
    ├── moderate-microservice/     # VM4: moderation UI + Auth0 OIDC
    ├── rabbitmq/                  # VM5: standalone RabbitMQ broker
    ├── kong-gateway/              # VM3: Kong Gateway + Terraform + TLS
    ├── deploy.sh                  # Full deployment script
    └── DOCUMENTATION.md           # Full architecture documentation
```

## Option 1 — Monolithic

Two Express apps sharing a MySQL database, all in Docker Compose.

- **Joke App** (:4000) — serves random jokes from DB
- **Submit App** (:4200) — submits jokes directly to DB + Swagger docs

```bash
cd co3404-option1
docker-compose up --build -d
```

## Option 2 — Microservices + RabbitMQ

Refactored into independent microservices for deployment on separate Azure VMs.

- **Submit app** (VM2) publishes jokes to a RabbitMQ queue (no direct DB access)
- **Moderate app** (VM4) pulls jokes from the submit queue, allows approve/reject via Auth0-protected UI, and publishes approved jokes to a moderated queue
- **ETL service** (VM1) consumes from the moderated queue and writes to MongoDB/MySQL
- **RabbitMQ** (VM5) runs as a standalone broker on its own VM
- **GET /types** uses a fanout exchange with file-based cache fallback for type synchronisation across services

```bash
# VM5 — RabbitMQ broker
cd co3404-option2/rabbitmq && docker-compose up -d

# VM2 — Submit service
cd co3404-option2/submit-microservice && docker-compose up --build -d

# VM4 — Moderate service
cd co3404-option2/moderate-microservice && docker-compose up --build -d

# VM1 — Joke + ETL service
cd co3404-option2/joke-microservice && docker-compose up --build -d
```

See [DOCUMENTATION.md](co3404-option2/DOCUMENTATION.md) for full architecture details, message flow, and Azure deployment guide.

## Option 3 — Kong API Gateway & Terraform

Added a third VM serving as a central reverse proxy and API Gateway.

- **Terraform:** Automated provisioning of Azure infrastructure (VMs, Public IP, NSG rules)
- **Kong API Gateway:** DB-less declarative routing mapping external requests to internal private VMs over Azure's Virtual Network
- **HTTPS & Rate Limiting:** Traffic encrypted via `mkcert` TLS certs. Spam protection on `/joke` endpoints (max 5 req/min)
- **Routing:** All services accessible via a single public IP — `/joke`, `/submit`, `/moderate`, `/docs`

```bash
# Provision infrastructure
cd co3404-option2/kong-gateway/terraform && terraform apply

# Start API Gateway
cd co3404-option2/kong-gateway && docker-compose up -d
```

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js / Express | Web servers & APIs |
| MongoDB / MySQL | Persistent data storage |
| RabbitMQ | Message queue + fanout exchange |
| Docker / Docker Compose | Containerisation |
| Swagger UI | API documentation |
| Azure VMs | Cloud deployment (5 VMs) |
| Terraform | IaC automation |
| Kong | API Gateway / reverse proxy / rate limiting |
| Auth0 (OIDC) | Authentication for moderation service |
| mkcert | TLS certificate generation |
