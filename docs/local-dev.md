# Local Development Stack

Crewmodo has a Cloudflare Worker API that uses the Neon serverless Postgres driver. For local development, use Neon Local rather than plain Postgres so the app exercises the same driver path that production uses.

## Prerequisites

- Docker Desktop
- A Neon project API key and project id

Neon Local exposes a local Postgres endpoint and a local serverless-driver HTTP endpoint. The app connects to `db:5432` inside Docker, while your browser uses:

- Web: `http://127.0.0.1:4321`
- API: `http://127.0.0.1:8787`

## Start the Stack

1. Copy the example env file:

```sh
cp .env.docker.example .env
```

2. Fill in:

```sh
NEON_API_KEY=...
NEON_PROJECT_ID=...
```

Optionally set `PARENT_BRANCH_ID` to create an ephemeral branch from a known parent, or `BRANCH_ID` to use a specific existing branch.

3. Start everything:

```sh
docker compose up --build
```

The `migrate` service runs database migrations before the API starts. Then open `http://127.0.0.1:4321`.

## Why Neon Local

The app currently uses `@neondatabase/serverless` through Drizzle. Plain local Postgres would require a separate Node Postgres adapter or a second API runtime. Neon Local keeps the Worker and database code path close to production while still giving local ports for browser testing.

## Common Issues

- `Estimator setup could not load`: the web app cannot reach `http://127.0.0.1:8787`, or the API cannot reach the Neon Local database.
- `NEON_API_KEY is required`: copy `.env.docker.example` to `.env` and fill in Neon credentials.
- Migration fails: confirm `NEON_PROJECT_ID` is correct and the API key can create/connect to branches.
