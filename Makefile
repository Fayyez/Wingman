.PHONY: up down api worker test lint fmt gen-api seed eval spike-llm spike-embed

up:
	docker compose -f infra/docker-compose.yml up -d

down:
	docker compose -f infra/docker-compose.yml down

api:
	cd services/api && uv run uvicorn app.main:create_app --factory --reload

worker:
	@echo "worker: not implemented yet (arq worker, later milestone)"

test:
	pnpm -r test
	cd services/api && uv run pytest

lint:
	pnpm lint
	cd services/api && uv run ruff check . && uv run ruff format --check . && uv run mypy app

fmt:
	pnpm format
	cd services/api && uv run ruff check --fix . && uv run ruff format .

gen-api:
	@echo "gen-api: placeholder (M1-07)"

seed:
	@echo "seed: placeholder"

eval:
	@echo "eval: placeholder"

spike-llm:
	uv run tools/spikes/llm_quality/run.py $(ARGS)

spike-embed:
	uv run --project services/api python tools/spikes/embeddings/run.py $(ARGS)
