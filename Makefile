COMPOSE = docker compose -f infra/docker-compose/docker-compose.yml

.PHONY: up down ps logs reset docker-build docs-check

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=200

reset:
	$(COMPOSE) down -v

docker-build:
	docker build -f infra/docker/Dockerfile.api -t sb-ledger-api:dev .
	docker build -f infra/docker/Dockerfile.worker -t sb-ledger-worker:dev .

docs-check:
	./scripts/docs-check.sh
