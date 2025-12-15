# 🚗 ZIPO Backend API

ZIPO is a high-performance backend API powering the Zipo car rental platform.  
It is designed as a scalable, country-isolated backend with a modern developer-friendly architecture and an interactive local API gateway UI for development and debugging.

![ZIPO API Gateway UI](./docs/zipo-api-gateway.png)

---

## 🧠 Overview

The ZIPO backend is built for:

- **Multi-country expansion** (each country runs on its own database)
- **High concurrency** and low-latency reads
- **Clean separation of concerns** between API, data access, and UI tooling
- **Excellent developer experience** with a built-in local API Gateway UI

The system is optimized for mobile clients (React Native / Expo) and supports rapid iteration during development while remaining production-ready.

---

## 🛠 Tech Stack

### Runtime & Language

- **Node.js 20+**
- **TypeScript**
- **ESM (ECMAScript Modules)**

### Web Framework

- **Fastify**
  - High-performance HTTP server
  - Schema-friendly, plugin-based architecture
  - Production-ready logging and lifecycle hooks

### Database

- **PostgreSQL**
- **pg (node-postgres)**
- Connection pooling optimized for serverless & container environments

### Architecture

- **Plugin-based Fastify architecture**
- **Country-isolated databases** (no shared country tables)
- **Stateless API design**
- **Explicit pagination & filtering patterns**
- **Strict typing at API boundaries**

### Developer Experience

- **Interactive Local API Gateway UI**
  - Live DB health & latency
  - Accordion-based endpoint explorer
  - On-demand API execution
  - Beautiful JSON rendering with syntax highlighting
- **Environment-based configuration**
- **Local & cloud-ready execution**

### Cloud & Deployment Ready

- Designed for:
  - **Google Cloud Functions**
  - **Cloud Run**
  - **Docker / Containers**
  - **CI/CD pipelines**
- Zero vendor lock-in at the code level

---

## 🔒 Design Principles

- **Performance first** — low overhead, fast startup, minimal abstractions
- **Explicit over magic** — predictable SQL and query behavior
- **Scalable by default** — ready for millions of listings across regions
- **Developer-friendly** — strong typing, readable code, great tooling
- **UI-assisted backend** — backend engineers get first-class UX too

---

## 📦 Monorepo Friendly

This backend is designed to work seamlessly alongside:

- Mobile apps (React Native / Expo)
- Web dashboards
- Admin panels
- Future microservices (pricing, bookings, payments)

---

## 🧭 Status

This repository represents the **core foundation** of the ZIPO backend and will continue to evolve as booking, pricing, availability, and payments are layered in.

---

© Zipo 2025 • Backend API
