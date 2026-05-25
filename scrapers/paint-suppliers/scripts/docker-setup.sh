#!/bin/bash
# Docker setup and validation script for Paint Supplier Scraper

set -e

echo "🐳 Paint Supplier Scraper - Docker Setup"
echo "========================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✅ Docker found: $(docker --version)"
echo ""

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available."
    exit 1
fi

echo "✅ Docker Compose found"
echo ""

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p data logs exports
echo "✅ Directories created"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env not found, copying from .env.example..."
    cp .env.example .env
    echo "✅ .env created (please review and update)"
else
    echo "✅ .env exists"
fi
echo ""

# Build Docker image
echo "🔨 Building Docker image..."
docker compose build scraper
echo "✅ Docker image built successfully"
echo ""

# Validate Docker image
echo "🔍 Validating Docker image..."
docker run --rm paint-supplier-scraper-scraper node --version
echo "✅ Docker image validated"
echo ""

# Test database initialization
echo "🗄️  Testing database initialization..."
docker compose run --rm scraper sh -c "node dist/index.js list" || echo "⚠️  Database init test (expected if no data)"
echo ""

echo "✅ Docker setup complete!"
echo ""
echo "📋 Available commands:"
echo "  docker compose up scraper          # Run scraper once"
echo "  docker compose run --rm scraper npm run scrape  # Manual scrape"
echo "  docker compose run --rm scraper npm run list    # List stats"
echo "  docker compose --profile monitor up             # Start with web UI"
echo "  docker compose --profile cron up                # Start with scheduler"
echo ""
echo "📊 Monitor at: http://localhost:8080 (with --profile monitor)"
echo ""
