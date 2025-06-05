# CarGurus Scraper API

A Puppeteer-based scraper for CarGurus that integrates with n8n workflows.

## Endpoints

- `GET /` - Health check
- `POST /scrape` - Scrape CarGurus listings

## Usage

Send a POST request to `/scrape` with:
```json
{
  "make": "Rolls-Royce",
  "model": "Cullinan",
  "yearRange": "2022-2023",
  "maxPrice": 300000,
  "maxMileage": 20000,
  "zipCode": "63105"
}
