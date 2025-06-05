const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'CarGurus Scraper is running!' });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { 
    make, 
    model, 
    yearRange, 
    maxPrice, 
    maxMileage,
    zipCode = '63105' // Default to St. Louis
  } = req.body;

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    });

    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Build CarGurus search URL
    let searchUrl = `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?zip=${zipCode}`;
    
    // Add search parameters
    if (maxPrice) searchUrl += `&maxPrice=${maxPrice}`;
    if (maxMileage) searchUrl += `&maxMileage=${maxMileage}`;
    searchUrl += '&showNegotiable=true&sortDir=ASC&sourceContext=carGurusHomePageModel&distance=500&sortType=PRICE';

    console.log('Navigating to:', searchUrl);
    
    await page.goto(searchUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Wait for listings to load
    await page.waitForTimeout(3000);

    // Extract listing data
    const listings = await page.evaluate(() => {
      const results = [];
      
      // Try multiple possible selectors for CarGurus listings
      const listingSelectors = [
        '.car-listing',
        '[data-testid="listing-tile"]',
        '.listing-item',
        'article[role="article"]'
      ];
      
      let listingElements = [];
      for (const selector of listingSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          listingElements = elements;
          break;
        }
      }

      listingElements.forEach((elem, index) => {
        if (index >= 10) return; // Limit to first 10 results
        
        try {
          // Extract text content helper
          const getText = (selectors) => {
            for (const selector of selectors) {
              const el = elem.querySelector(selector);
              if (el) return el.textContent.trim();
            }
            return '';
          };

          // Get the detail page link
          const linkElement = elem.querySelector('a');
          const detailUrl = linkElement ? linkElement.href : '';

          const listing = {
            title: getText(['h4', '.listing-title', '[data-testid="listing-title"]']),
            price: getText(['.price', '[data-testid="price"]', '.cg-dealFinder-priceAndMoPayment']),
            mileage: getText(['.mileage', '[data-testid="mileage"]']),
            location: getText(['.dealer-location', '.location', '[data-testid="location"]']),
            detailUrl: detailUrl,
            vin: elem.getAttribute('data-vin') || '',
            yearMakeModel: getText(['.make-model', '[data-testid="year-make-model"]'])
          };

          if (listing.title || listing.price) {
            results.push(listing);
          }
        } catch (err) {
          console.error('Error parsing listing:', err);
        }
      });

      return results;
    });

    // For each listing, get detailed info
    const detailedListings = [];
    
    for (const listing of listings.slice(0, 5)) { // Limit to 5 for speed
      if (listing.detailUrl) {
        try {
          await page.goto(listing.detailUrl, { 
            waitUntil: 'networkidle2',
            timeout: 20000 
          });
          
          await page.waitForTimeout(2000);

          const details = await page.evaluate(() => {
            const getDetail = (selectors) => {
              for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) return el.textContent.trim();
              }
              return '';
            };

            return {
              vin: getDetail(['[data-cg-vin]', '.vin', '[data-testid="vin"]']),
              description: getDetail(['.description', '.vehicle-description']),
              features: Array.from(document.querySelectorAll('.feature-item, .option-item')).map(el => el.textContent.trim()),
              dealer: getDetail(['.dealer-name', '[data-testid="dealer-name"]']),
              phone: getDetail(['.dealer-phone', '[data-testid="phone"]'])
            };
          });

          detailedListings.push({
            ...listing,
            ...details
          });
        } catch (err) {
          console.error('Error getting details for:', listing.detailUrl);
          detailedListings.push(listing);
        }
      }
    }

    await browser.close();

    res.json({
      success: true,
      count: detailedListings.length,
      searchUrl: searchUrl,
      listings: detailedListings
    });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CarGurus scraper running on port ${PORT}`);
});
