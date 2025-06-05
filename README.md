# CarGurus Scraper API

A Puppeteer-based scraper for CarGurus that integrates with n8n workflows.

## Endpoints

- `GET /` - Health check
- `POST /scrape` - Scrape CarGurus listings

## Usage

Send a POST request to `/scrape` with:
```json
{
  "make": "Honda",
  "model": "Civic",
  "maxPrice": 25000,
  "zipCode": "10001",
  "distance": "nationwide",
  "skipDetails": true
}
