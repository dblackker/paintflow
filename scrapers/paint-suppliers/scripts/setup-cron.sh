#!/bin/bash
# Setup cron job for weekly paint supplier scraping
# Runs every Sunday at 2 AM

CRON_JOB="0 2 * * 0 cd $(pwd) && npm run scrape >> logs/cron.log 2>&1"

# Check if job already exists
if crontab -l 2>/dev/null | grep -q "paint-supplier-scraper"; then
    echo "Cron job already exists"
    exit 0
fi

# Add cron job
(crontab -l 2>/dev/null; echo "# Paint supplier scraper - weekly"; echo "$CRON_JOB") | crontab -

echo "Cron job added successfully"
echo "Scraper will run every Sunday at 2 AM"
crontab -l | grep -A1 "paint-supplier-scraper"
