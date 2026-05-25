# Paint Supplier Scraper

Deterministic, foolproof scraper for paint supplier products, pricing, colors, and sundries. Built for PaintFlow to provide real-time supplier data for accurate estimates.

## Suppliers Supported

- **Sherwin-Williams** (sherwin-williams.com)
- **PPG Paints** (ppgpaints.com)
- **Benjamin Moore** (benjaminmoore.com)

## Data Collected

### Products
- Product name and SKU
- Product line (e.g., SuperPaint, Duration, Regal Select)
- Type (interior/exterior/primer/specialty)
- Sheen options
- Base types

### Pricing
- Per gallon pricing
- 5-gallon pricing
- Contractor pricing tiers
- Volume discounts

### Colors
- Color name and code
- Hex/RGB values
- Collections (e.g., "Timeless", "Historical")
- Color families
- Popularity metrics

### Specifications
- Coverage rate (sq ft/gal)
- VOC levels
- Dry times
- Recommended surfaces

### Sundries
- Brushes, rollers, tape, drop cloths
- Tools and accessories
- Prep materials

## Architecture

### Plugin-Based Suppliers
Each supplier is implemented as a plugin extending `BaseSupplierScraper`:

```typescript
class SherwinWilliamsScraper extends BaseSupplierScraper {
  async scrapeProducts() { ... }
  async scrapePricing() { ... }
  async scrapeColors() { ... }
}
```

### Deterministic Scraping
- Same input → same output
- Content hashing for change detection
- Idempotent database updates
- Versioned schema

### Foolproof Design
- Automatic retries with exponential backoff
- Rate limiting (respectful scraping)
- Graceful error handling
- Comprehensive logging
- Data validation with Zod schemas
- Headless browser fallback (Playwright)

## Database Schema

SQLite database with the following tables:
- `suppliers` - Supplier metadata
- `products` - Paint products
- `pricing` - Current and historical pricing
- `colors` - Color library
- `product_colors` - Many-to-many mapping
- `specifications` - Technical specs
- `sundries` - Brushes, rollers, etc.
- `scrape_logs` - Audit trail

## Installation

### Local Installation

```bash
cd scrapers/paint-suppliers
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env with your config
npm run build
```

### Docker Installation

```bash
cd scrapers/paint-suppliers
./scripts/docker-setup.sh

# Or manually:
docker compose build
docker compose run --rm scraper npm run scrape
```

See [Docker section](#docker-deployment) below for more details.

## Usage

### Scrape all suppliers
```bash
npm run scrape
```

### Scrape specific supplier
```bash
npm run scrape:sw    # Sherwin-Williams
npm run scrape:ppg   # PPG
npm run scrape:bm    # Benjamin Moore
```

### Export data
```bash
npm run export -- --format json --output ./exports/
npm run export -- --format csv --supplier sherwin-williams
```

### Validate data
```bash
npm run validate
```

## Docker Deployment

### Quick Start

```bash
# Setup (builds image, creates directories, validates)
./scripts/docker-setup.sh

# Run scraper
docker compose run --rm scraper npm run scrape

# List stats
docker compose run --rm scraper npm run list

# Export data
docker compose run --rm scraper npm run export -- --format json --output /app/exports/data.json
```

### Docker Compose Profiles

**Basic scraping:**
```bash
docker compose up scraper
```

**With web monitor (http://localhost:8080):**
```bash
docker compose --profile monitor up
```

**With weekly cron scheduler:**
```bash
docker compose --profile cron up -d
```

### Volumes

- `./data` → `/app/data` (SQLite database)
- `./logs` → `/app/logs` (scraper logs)
- `./exports` → `/app/exports` (exported data)

### Environment Variables

Configure via `.env` file or `docker-compose.yml`:

```env
DATABASE_PATH=/app/data/suppliers.db
LOG_LEVEL=info
RATE_LIMIT_MS=1000
MAX_RETRIES=3
HEADLESS=true
```

### Building Image

```bash
docker build -t paint-supplier-scraper .
docker run -v $(pwd)/data:/app/data paint-supplier-scraper
```

## Cron Setup

Run weekly on Sundays at 2 AM:

```bash
# Add to crontab
0 2 * * 0 cd /path/to/scraper && npm run scrape >> /var/log/paint-scraper.log 2>&1
```

Or use the included script:
```bash
./scripts/setup-cron.sh
```

## Configuration

Environment variables (`.env`):

```env
# Database
DATABASE_PATH=./data/suppliers.db

# Scraping
RATE_LIMIT_MS=1000
MAX_RETRIES=3
HEADLESS=true
USER_AGENT_ROTATION=true

# Proxies (optional)
PROXY_URL=
PROXY_USERNAME=
PROXY_PASSWORD=

# Notifications (optional)
SLACK_WEBHOOK_URL=
EMAIL_ON_ERROR=

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/scraper.log
```

## Adding New Suppliers

1. Create `src/suppliers/new-supplier.ts`
2. Extend `BaseSupplierScraper`
3. Implement required methods
4. Register in `src/suppliers/index.ts`
5. Add tests

Example:
```typescript
import { BaseSupplierScraper } from './base';

export class NewSupplierScraper extends BaseSupplierScraper {
  supplierId = 'new-supplier';
  baseUrl = 'https://example.com';
  
  async scrapeProducts() {
    // Implementation
  }
}
```

## Project Structure

```
paint-suppliers/
├── src/
│   ├── suppliers/
│   │   ├── base.ts
│   │   ├── sherwin-williams.ts
│   │   ├── ppg.ts
│   │   ├── benjamin-moore.ts
│   │   └── index.ts
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrations/
│   │   └── client.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── retry.ts
│   │   ├── validator.ts
│   │   └── normalizer.ts
│   └── index.ts
├── tests/
├── scripts/
├── docs/
├── data/
└── logs/
```

## Data Quality

- **Deterministic:** Same scrape = same data
- **Validated:** All data passes Zod schemas
- **Normalized:** Consistent units and formats
- **Versioned:** Schema migrations supported
- **Audited:** Full scrape history

## Legal & Ethical

- Respects robots.txt
- Rate limited to avoid server load
- User agent identifies as bot
- Cashes responses to minimize requests
- For research and pricing accuracy purposes

## License

MIT - See LICENSE file

## Support

For issues or questions, see PaintFlow documentation or open an issue in the repo.
