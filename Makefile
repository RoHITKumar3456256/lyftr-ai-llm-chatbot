.PHONY: up down test clean build

up:
	docker compose up --build -d

down:
	docker compose down

test:
	cd backend && pytest -v

build:
	docker compose build

clean:
	docker compose down -v

