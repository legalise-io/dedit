.PHONY: install install-backend install-frontend dev dev-backend dev-frontend kill-ports stop clean sample help build build-frontend build-lib version-patch version-minor version-major publish

# Absolute paths
ROOT_DIR := $(shell pwd)
BACKEND_DIR := $(ROOT_DIR)/backend
FRONTEND_DIR := $(ROOT_DIR)/frontend
VENV := $(BACKEND_DIR)/.venv

# Default target
help:
	@echo "Document Editor PoC - Available commands:"
	@echo ""
	@echo "  make install          Install all dependencies (backend + frontend)"
	@echo "  make dev              Start both servers (auto-kills processes on ports)"
	@echo "  make dev-backend      Start only the backend server (port 8000)"
	@echo "  make dev-frontend     Start only the frontend server (port 5173)"
	@echo "  make build            Build both frontend app and library"
	@echo "  make build-frontend   Build the frontend app for production"
	@echo "  make build-lib        Build the reusable component library"
	@echo "  make kill-ports       Kill any processes using ports 8000 and 5173"
	@echo "  make stop             Stop all running servers"
	@echo "  make sample           Create a sample Word document for testing"
	@echo "  make clean            Remove virtual environments and node_modules"
	@echo ""
	@echo "  make version-patch    Bump patch version (0.1.0 -> 0.1.1)"
	@echo "  make version-minor    Bump minor version (0.1.0 -> 0.2.0)"
	@echo "  make version-major    Bump major version (0.1.0 -> 1.0.0)"
	@echo "  make publish          Build library and publish to npm"
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

# Kill any processes using our ports
kill-ports:
	@echo "Checking for processes on ports 8000 and 5173..."
	@lsof -ti:8000 | xargs kill -9 2>/dev/null || true
	@lsof -ti:5173 | xargs kill -9 2>/dev/null || true
	@echo "Ports cleared"

# Start both servers with foreman (kills existing processes first)
dev: kill-ports
	foreman start -f $(ROOT_DIR)/Procfile.dev

# Start only backend
dev-backend:
	@echo "Starting backend server..."
	cd $(BACKEND_DIR) && $(VENV)/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Start only frontend
dev-frontend:
	@echo "Starting frontend server..."
	cd $(FRONTEND_DIR) && npm run dev

# Build both frontend app and library
build: build-frontend build-lib
	@echo "All builds complete"

# Build frontend app for production
build-frontend:
	@echo "Building frontend app..."
	cd $(FRONTEND_DIR) && npm run build
	@echo "Frontend app built to $(FRONTEND_DIR)/dist"

# Build reusable component library
build-lib:
	@echo "Building component library..."
	cd $(FRONTEND_DIR) && npm run build:lib
	@echo "Library built to $(FRONTEND_DIR)/dist"
	@echo "Exports: index.js, index.cjs, index.d.ts"

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

# Version bumping (updates package.json, commits, and tags)
version-patch:
	@echo "Bumping patch version..."
	cd $(FRONTEND_DIR) && npm version patch --no-git-tag-version
	$(eval VERSION := $(shell cd $(FRONTEND_DIR) && node -p "require('./package.json').version"))
	git add $(FRONTEND_DIR)/package.json
	git commit -m "Bump version to v$(VERSION)"
	git tag -a "v$(VERSION)" -m "Release v$(VERSION)"
	@echo "Version bumped to v$(VERSION) and tagged"

version-minor:
	@echo "Bumping minor version..."
	cd $(FRONTEND_DIR) && npm version minor --no-git-tag-version
	$(eval VERSION := $(shell cd $(FRONTEND_DIR) && node -p "require('./package.json').version"))
	git add $(FRONTEND_DIR)/package.json
	git commit -m "Bump version to v$(VERSION)"
	git tag -a "v$(VERSION)" -m "Release v$(VERSION)"
	@echo "Version bumped to v$(VERSION) and tagged"

version-major:
	@echo "Bumping major version..."
	cd $(FRONTEND_DIR) && npm version major --no-git-tag-version
	$(eval VERSION := $(shell cd $(FRONTEND_DIR) && node -p "require('./package.json').version"))
	git add $(FRONTEND_DIR)/package.json
	git commit -m "Bump version to v$(VERSION)"
	git tag -a "v$(VERSION)" -m "Release v$(VERSION)"
	@echo "Version bumped to v$(VERSION) and tagged"

# Publish to npm
publish: build-lib
	@echo "Publishing to npm..."
	cd $(FRONTEND_DIR) && npm publish
	@echo "Published version $$(cd $(FRONTEND_DIR) && node -p "require('./package.json').version")"
