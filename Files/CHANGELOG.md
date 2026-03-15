# Changelog

All notable changes to the CO3404 Distributed Joke Service project.

## [3.0.0] — 2026-03-06

### Added — Option 3 Kong API Gateway + Terraform
- **Kong API Gateway (VM3)** — New VM deployed via Terraform serving as a reverse proxy for all traffic.
- **Terraform Infrastructure as Code** — `main.tf`, `variables.tf`, `outputs.tf` used to provision a new Static IP, NSG, NIC, and Ubuntu VM inside the existing secure VNet.
- **HTTPS & TLS Certificate** — Added `mkcert` locally-generated TLS certificate deployed to the Kong VM filesystem (`/etc/kong/certs`) to support HTTPS.
- **Declarative DB-less Routing** — Configured `kong.yaml` to route API calls directly to the respective backends on VM1 (`10.0.0.4`) and VM2 (`10.0.0.5`). 
- **Rate Limiting** — Configured the Kong rate-limiting plugin to allow a maximum of 5 requests per minute on the joke service endpoints to prevent abuse.

### Changed
- **Frontend JavaScript & Server Routes** — Updated `script.js` in both apps to use `/joke-types` and `/submit-types`. Added server-side route aliases in `server.js` so that the APIs function correctly both through Kong and when accessed directly.

---

## [2.0.0] — 2026-03-06

### Added — Option 2 Microservice Architecture
- **ETL service** (`etl/etl.js`) — RabbitMQ consumer that reads joke messages and writes to MySQL with retry logic
- **ETL database module** (`etl/db.js`) — dedicated MySQL connection pool for the ETL consumer
- **ETL Dockerfile** — containerised Node.js 18 Alpine image for the ETL service
- **Two separate `docker-compose.yml` files** — one per microservice (VM), replacing the single combined file
- **Two separate `.env` files** — per-VM configuration including cross-VM private IPs
- **RabbitMQ message broker** — durable queue (`SUBMITTED_JOKES`) with persistent messages and management console
- **`DOCUMENTATION.md`** — full architecture documentation covering message flow, resilience, deployment guide, and troubleshooting
- **ARM template** (`/tmp/azure-vm-template.json`) — automated Azure infrastructure provisioning with VNet, NSGs, and firewall rules

### Changed
- **`submit-app/server.js`** — completely rewritten: `POST /submit` now publishes to RabbitMQ instead of writing directly to DB; `GET /types` fetches via HTTP from joke-app with JSON file cache fallback
- **`submit-app/package.json`** — removed `mysql2`, added `amqplib` (RabbitMQ) and `axios` (HTTP client)
- **`submit-app/swagger.js`** — updated API description to reflect queue-based architecture
- **`README.md`** — added Option 2 section with project structure, quick start, and tech stack

### Removed
- **`submit-app/db.js`** — submit app no longer has any database dependency

### Infrastructure
- Deployed to **2 Azure VMs** in `norwayeast` region (Azure for Students)
  - **VM1** (`joke-vm`, Standard_B2s_v2): joke-app + ETL + MySQL
  - **VM2** (`submit-vm`, Standard_B2ats_v2): submit-app + RabbitMQ
- Configured **NSG firewall rules**: ports 4000/4001/4002 on VM1, ports 4200/5672/15672 on VM2
- Shared **Virtual Network** (10.0.0.0/16) for private inter-VM communication

### Tested & Verified
- ✅ Local testing — all 5 containers healthy, full end-to-end joke flow
- ✅ Azure deployment — all endpoints accessible via public IPs
- ✅ Message flow — joke submitted on VM2 → RabbitMQ → ETL on VM1 → MySQL insert confirmed

---

## [1.0.0] — 2026-02-16

### Added — Option 1 Monolithic Architecture
- **Joke App** (`joke-app/server.js`) — serves random jokes from MySQL via `GET /types` and `GET /joke/:type`
- **Submit App** (`submit-app/server.js`) — accepts joke submissions via `POST /submit` with Swagger docs
- **MySQL database** — schema with `types` and `jokes` tables, 20 seed jokes across 4 types
- **Docker Compose** — single `docker-compose.yml` running all services on one machine
- **Frontend UIs** — HTML/CSS/JS for both joke retrieval and submission interfaces
