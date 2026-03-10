COMPOSE = docker compose -f infra/docker-compose/docker-compose.yml

.PHONY: up down ps logs reset docker-build docs-check k8s-up k8s-smoke k8s-down

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
	bash ./scripts/docs-check.sh

k8s-up:
	bash ./scripts/k8s-first-up.sh $(ARGS)

k8s-smoke:
	bash ./scripts/k8s-smoke.sh $(ARGS)

k8s-down:
	bash ./scripts/k8s-down.sh $(ARGS)
