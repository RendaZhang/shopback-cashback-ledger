# shopback-cashback-ledger

A simplified cashback/rewards ledger system for backend/system-design interviews.

## Quickstart (Local)

```bash
make up
cp apps/api/.env.example apps/api/.env
pnpm start
# open http://localhost:3000/docs
```

## Test

### Database & MQ

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

#### Verify MQ Data in Docker Container

```bash
# Delete a topic
docker exec sb-redpanda rpk topic delete order.events
# Create a topic
docker exec -i sb-redpanda rpk topic create order.events -p 1 -r 1 || true
# Consume a certain number of messages
docker exec -i sb-redpanda rpk topic consume order.events -n 10
# List all topics
docker exec sb-redpanda rpk topic list

# Cluster Management
# Get cluster information
docker exec sb-redpanda rpk cluster info
# Check cluster health
docker exec sb-redpanda rpk cluster health
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
# Response now includes outboxEventId only when transitioning CREATED -> CONFIRMED.
# NOTE: confirm only writes order status + outbox event; ledger credit is async via Kafka consumer.

# Replay Confirm (Same key should return same result)
curl -s -X POST http://localhost:3000/orders/<ORDER_ID>/confirm \
  -H 'Idempotency-Key: confirm-001'
```

Check Balance:

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```

### Cashback Processing Flow

First set merchant cashback rule to 5%:

```bash
curl -s -X POST http://localhost:3000/merchants/m_1/cashback-rule \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.05}'
```

Create new order (use new key):

```bash
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-002' \
  -d '{"userId":"u_1","merchantId":"m_1","amount":100,"currency":"SGD"}'
```

Confirm (also use new key):

```bash
curl -s -X POST http://localhost:3000/orders/<NEW_ORDER_ID>/confirm \
  -H 'Idempotency-Key: confirm-002'
```

Check balance immediately after confirm (should still be 0 before consumer processes event):

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```

After worker consumes `OrderConfirmed`, check again (should become 5):

```bash
curl -s http://localhost:3000/users/u_1/cashback-balance
```

### Event Processing Workflow

Trigger a New Order Confirmation (with a new idempotency key)

```bash
# create
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-003' \
  -d '{"userId":"u_2","merchantId":"m_1","amount":200,"currency":"SGD"}'

# confirm (note: use a new key)
curl -s -X POST http://localhost:3000/orders/<NEW_ORDER_ID>/confirm \
  -H 'Idempotency-Key: confirm-003'
```

Check Topic Messages (You should see an OrderConfirmed event).

```bash
docker exec -i sb-redpanda rpk topic consume order.events -n 1
```

Check Outbox Status (Should be SENT)

```bash
docker exec -i sb-postgres psql -U ledger -d ledger -c "select id, type, status, attempts, created_at, sent_at from \"OutboxEvent\" order by created_at desc limit 5;"
```
