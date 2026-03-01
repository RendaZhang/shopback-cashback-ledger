# shopback-cashback-ledger

A simplified cashback/rewards ledger system for backend/system-design interviews.

## Quickstart (Local)

```bash
make up
cp apps/api/.env.example apps/api/.env
pnpm -C apps/api start:dev
# open http://localhost:3000/docs
```

## Test

### Database 

#### Verify PostgreSQL Data in Docker Container

Method 1: Interactive Access (Recommended for Ad-hoc Queries).

Access the PostgreSQL interactive terminal (`psql`) directly inside the container for flexible, real-time database inspection.

```bash
# Step 1: Enter the container's psql terminal
docker exec -it sb-postgres psql -U ledger -U ledger

# Step 2: Common psql Commands (Inside the Terminal)
# List all databases
\l
# List all database users/roles
\du
# View current connection information
\conninfo
# Switch to a target database 
\c ledger
# List all tables in current database
\dt
# Show detailed structure of a table
\d <table_name>
# Query table data (example)
SELECT * FROM "Order" LIMIT 10;
# Exit the psql terminal
\q
```

Method 2: One-Line Quick Checks (Recommended for Scripts/Automation).

Run direct, non-interactive commands to get specific database information without entering the psql terminal (ideal for CI/CD or quick validation).

```bash
# List all databases in the PostgreSQL instance
docker exec -i sb-postgres psql -U ledger -d ledger -c "\l"
# List all tables in the "ledger" database (your target DB)
docker exec -i sb-postgres psql -U ledger -d ledger -c "\dt"
# Query sample data from a table (e.g., first 5 rows of "Order")
docker exec -i sb-postgres psql -U ledger -d ledger -c 'SELECT * FROM "Order" LIMIT 5;'
# Check PostgreSQL server version
docker exec -i sb-postgres psql -U ledger -d ledger -c "SELECT version();"
# List environment variables (verify DB credentials/config)
docker exec -i sb-postgres env | grep POSTGRES
```

### Idempotent Order Creation API Examples

```bash
# 1) Create Order (with Idempotency Key)
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100.5,"currency":"SGD"}'

# 2) Repeat Same Request (should return same order ID)
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100.5,"currency":"SGD"}'

# 3) Reuse Same Key with Different Body (should return 409 Conflict)
curl -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-001' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":999,"currency":"SGD"}'
```

Confirm Order (Replace <ORDER_ID> with the ID from step 1):

```bash
curl -s -X POST http://localhost:3000/orders/<ORDER_ID>/confirm \
  -H 'Idempotency-Key: confirm-001'

# Replay Confirm (Same key should return same result)
curl -s -X POST http://localhost:3000/orders/<ORDER_ID>/confirm \
  -H 'Idempotency-Key: confirm-001'
```

Check Balance:

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```
