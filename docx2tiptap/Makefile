.PHONY: help clean build test publish publish-test install-dev check version-patch version-minor version-major

VENV := ../backend/.venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

# Default target
help:
	@echo "docx2tiptap - Available commands:"
	@echo ""
	@echo "  make install-dev      Install package with dev dependencies"
	@echo "  make test             Run tests"
	@echo "  make build            Build the package"
	@echo "  make check            Validate package before publishing"
	@echo "  make publish-test     Publish to TestPyPI (for testing)"
	@echo "  make publish          Publish to PyPI"
	@echo "  make clean            Remove build artifacts"
	@echo ""
	@echo "  make version-patch    Bump patch version (0.1.0 -> 0.1.1)"
	@echo "  make version-minor    Bump minor version (0.1.0 -> 0.2.0)"
	@echo "  make version-major    Bump major version (0.1.0 -> 1.0.0)"

# Remove build artifacts
clean:
	rm -rf dist/ build/ *.egg-info src/*.egg-info .pytest_cache/
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Install dev dependencies
install-dev:
	$(PIP) install -e ".[dev]"

# Run tests
test:
	$(PYTHON) -m pytest

# Build the package
build: clean
	$(PIP) install --quiet build
	$(PYTHON) -m build

# Publish to TestPyPI (for testing)
publish-test: build
	$(PIP) install --quiet twine
	$(PYTHON) -m twine upload --repository testpypi dist/*

# Publish to PyPI
publish: build
	$(PIP) install --quiet twine
	$(PYTHON) -m twine upload dist/*

# Check package before publishing
check: build
	$(PIP) install --quiet twine
	$(PYTHON) -m twine check dist/*

# Version bumping (updates pyproject.toml)
version-patch:
	@echo "Bumping patch version..."
	@VERSION=$$(grep 'version = ' pyproject.toml | head -1 | sed 's/.*"\(.*\)"/\1/') && \
		MAJOR=$$(echo $$VERSION | cut -d. -f1) && \
		MINOR=$$(echo $$VERSION | cut -d. -f2) && \
		PATCH=$$(echo $$VERSION | cut -d. -f3) && \
		NEW_VERSION="$$MAJOR.$$MINOR.$$((PATCH + 1))" && \
		sed -i '' "s/version = \"$$VERSION\"/version = \"$$NEW_VERSION\"/" pyproject.toml && \
		echo "Version bumped to $$NEW_VERSION"

version-minor:
	@echo "Bumping minor version..."
	@VERSION=$$(grep 'version = ' pyproject.toml | head -1 | sed 's/.*"\(.*\)"/\1/') && \
		MAJOR=$$(echo $$VERSION | cut -d. -f1) && \
		MINOR=$$(echo $$VERSION | cut -d. -f2) && \
		NEW_VERSION="$$MAJOR.$$((MINOR + 1)).0" && \
		sed -i '' "s/version = \"$$VERSION\"/version = \"$$NEW_VERSION\"/" pyproject.toml && \
		echo "Version bumped to $$NEW_VERSION"

version-major:
	@echo "Bumping major version..."
	@VERSION=$$(grep 'version = ' pyproject.toml | head -1 | sed 's/.*"\(.*\)"/\1/') && \
		MAJOR=$$(echo $$VERSION | cut -d. -f1) && \
		NEW_VERSION="$$((MAJOR + 1)).0.0" && \
		sed -i '' "s/version = \"$$VERSION\"/version = \"$$NEW_VERSION\"/" pyproject.toml && \
		echo "Version bumped to $$NEW_VERSION"
