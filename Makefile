.PHONY: install install-backend install-frontend dev dev-backend dev-frontend stop clean sample help

# Absolute paths
ROOT_DIR := /Users/jamie/Code/dedit
BACKEND_DIR := $(ROOT_DIR)/backend
FRONTEND_DIR := $(ROOT_DIR)/frontend
VENV := $(BACKEND_DIR)/.venv

# Default target
help:
	@echo "Document Editor PoC - Available commands:"
	@echo ""
	@echo "  make install          Install all dependencies (backend + frontend)"
	@echo "  make dev              Start both backend and frontend servers"
	@echo "  make dev-backend      Start only the backend server (port 8000)"
	@echo "  make dev-frontend     Start only the frontend server (port 5173)"
	@echo "  make stop             Stop all running servers"
	@echo "  make sample           Create a sample Word document for testing"
	@echo "  make clean            Remove virtual environments and node_modules"
	@echo ""
	@echo "After running 'make dev', open http://localhost:5173 in your browser"

# Install all dependencies
install: install-backend install-frontend
	@echo "All dependencies installed"

# Install backend dependencies
install-backend:
	@echo "Installing backend dependencies..."
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install --quiet fastapi uvicorn python-docx python-multipart
	@echo "Backend dependencies installed"

# Install frontend dependencies
install-frontend:
	@echo "Installing frontend dependencies..."
	cd $(FRONTEND_DIR) && npm install
	@echo "Frontend dependencies installed"

# Start both servers with foreman
dev:
	foreman start -f $(ROOT_DIR)/Procfile.dev

# Start only backend
dev-backend:
	@echo "Starting backend server..."
	cd $(BACKEND_DIR) && $(VENV)/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Start only frontend
dev-frontend:
	@echo "Starting frontend server..."
	cd $(FRONTEND_DIR) && npm run dev

# Stop all servers
stop:
	@echo "Stopping servers..."
	@pkill -f "uvicorn main:app" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
	@echo "Servers stopped"

# Create sample document
sample:
	@echo "Creating sample Word document..."
	cd $(BACKEND_DIR) && $(VENV)/bin/python create_sample.py
	@echo "Sample document created at $(BACKEND_DIR)/sample_contract.docx"

# Clean up
clean:
	@echo "Cleaning up..."
	rm -rf $(VENV)
	rm -rf $(FRONTEND_DIR)/node_modules
	rm -f $(BACKEND_DIR)/sample_contract.docx
	@echo "Cleaned"
