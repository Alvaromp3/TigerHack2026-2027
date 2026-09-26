.PHONY: up down install

PID_DIR := .pids
LOG_DIR := .logs
BACKEND_PORT := 8000
FRONTEND_PORT := 5173

up: install
	@$(MAKE) --no-print-directory down
	@mkdir -p $(PID_DIR) $(LOG_DIR)
	@echo "Levantando backend en http://localhost:$(BACKEND_PORT)"
	@cd backend && { nohup .venv/bin/uvicorn app.main:app --reload --host localhost --port $(BACKEND_PORT) > ../$(LOG_DIR)/backend.log 2>&1 & echo $$! > ../$(PID_DIR)/backend.pid; }
	@echo "Levantando frontend en http://localhost:$(FRONTEND_PORT)"
	@cd frontend && { nohup npm run dev -- --host localhost --port $(FRONTEND_PORT) --strictPort > ../$(LOG_DIR)/frontend.log 2>&1 & echo $$! > ../$(PID_DIR)/frontend.pid; }
	@echo "Esperando a que arranquen..."
	@i=0; \
	until curl -sf http://localhost:$(BACKEND_PORT)/api/health >/dev/null 2>&1; do \
		i=$$((i + 1)); \
		if [ $$i -ge 60 ]; then echo "El backend no respondió. Revisa $(LOG_DIR)/backend.log"; exit 1; fi; \
		sleep 0.5; \
	done
	@i=0; \
	until curl -sf -o /dev/null http://localhost:$(FRONTEND_PORT)/; do \
		i=$$((i + 1)); \
		if [ $$i -ge 60 ]; then echo "El frontend no respondió. Revisa $(LOG_DIR)/frontend.log"; exit 1; fi; \
		sleep 0.5; \
	done
	@echo "Listo."
	@echo "  Backend   http://localhost:$(BACKEND_PORT)  (docs: /docs)"
	@echo "  Frontend  http://localhost:$(FRONTEND_PORT)"
	@echo "  Logs      $(LOG_DIR)/backend.log  $(LOG_DIR)/frontend.log"

down:
	@echo "Apagando backend y frontend..."
	@kill_tree() { \
		pid="$$1"; \
		for child in $$(pgrep -P "$$pid" 2>/dev/null); do \
			kill_tree "$$child"; \
		done; \
		kill "$$pid" 2>/dev/null || true; \
	}; \
	for file in $(PID_DIR)/*.pid; do \
		[ -f "$$file" ] || continue; \
		pid=$$(cat "$$file"); \
		if [ -n "$$pid" ]; then kill_tree "$$pid"; fi; \
		rm -f "$$file"; \
	done; \
	sleep 0.4; \
	for port in $(BACKEND_PORT) $(FRONTEND_PORT); do \
		pids=$$(lsof -nP -iTCP:$$port -sTCP:LISTEN -t 2>/dev/null || true); \
		if [ -n "$$pids" ]; then kill $$pids 2>/dev/null || true; fi; \
	done; \
	sleep 0.4; \
	for port in $(BACKEND_PORT) $(FRONTEND_PORT); do \
		pids=$$(lsof -nP -iTCP:$$port -sTCP:LISTEN -t 2>/dev/null || true); \
		if [ -n "$$pids" ]; then kill -9 $$pids 2>/dev/null || true; fi; \
	done
	@echo "Procesos detenidos."

install: backend/.venv/bin/uvicorn frontend/node_modules

backend/.venv/bin/uvicorn: backend/requirements.txt
	python3 -m venv backend/.venv
	backend/.venv/bin/pip install -r backend/requirements.txt

frontend/node_modules: frontend/package.json frontend/package-lock.json
	npm --prefix frontend install
