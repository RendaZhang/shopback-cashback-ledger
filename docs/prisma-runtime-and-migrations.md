# Prisma Runtime and Migrations

## Goal

Ensure both API and worker always have a valid Prisma client at runtime, without initContainers or one-off migration jobs.

## Current Contract

- `packages/db` is the single Prisma boundary package.
- Prisma schema lives at `packages/db/prisma/schema.prisma`.
- Prisma client is generated to `packages/db/generated/client`.
- App code imports Prisma from `@sb/db`, not from local generated paths.

## Build-Time Packaging

Both runtime images generate Prisma during image build:

- `infra/docker/Dockerfile.api`
- `infra/docker/Dockerfile.worker`

Key step:

```bash
pnpm -C packages/db run generate
```

This prevents "Prisma client missing" failures during pod startup.

## Migration Strategy

- API startup supports `RUN_DB_MIGRATION=true`.
- When enabled, API executes `prisma migrate deploy` before HTTP server startup.
- Implementation: `apps/api/src/db/run-migrations.ts`.

Why this works for this project:

- simple single-API deployment in local/kind
- fewer Kubernetes resources to maintain
- no separate migration job ordering concerns

## Kubernetes Behavior

- `infra/k8s/base/api.yaml` sets `RUN_DB_MIGRATION=true`.
- Worker does not run migrations.
- `infra/k8s/base/kustomization.yaml` does not include a migration Job.

## Operational Notes

- If migration fails, API pod will fail fast and restart; inspect API logs.
- `prisma migrate deploy` is idempotent for applied migrations.
- For production-grade multi-replica APIs, you may move migrations to a controlled pre-deploy step to avoid concurrent startup races.

## Extension Guidelines

When adding new services:

1. Add `@sb/db` workspace dependency.
2. Ensure the service image runs Prisma `generate` during build.
3. Keep migration ownership explicit (single writer principle).
4. Avoid copying Prisma artifacts manually across apps.
