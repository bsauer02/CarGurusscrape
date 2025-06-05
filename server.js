const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'CarGurus Scraper is running!',
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000
  });
});

// Test endpoint without Puppeteer
app.get('/test', (req, res) => {
  res.json({ 
    message: 'Server is working!',
    puppeteerPath: process.env.PUPPETEER_EXECUTABLE_PATH || 'Not set'
  });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { 
    make, 
    model, 
    yearRange, 
    maxPrice, 
    maxMileage,
    zipCode = '63105', // Default to St. Louis
    distance = 500, // Default to 500 miles, can be number or 'nationwide'
    skipDetails = false // New option to skip detail page scraping for speed
  } = req.body;

  try {
    // Different config for production vs development
    const puppeteerConfig = {
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
    };

    // Use nixpacks Chromium path if available
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    console.log('Launching browser with config:', puppeteerConfig);
    
    const browser = await puppeteer.launch(puppeteerConfig);

    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Build search URL - Use general search if make/model provided
    let searchUrl;
    
    if (make || model) {
      // Use CarGurus search with query parameter for make/model
      const searchQuery = [make, model].filter(Boolean).join(' ');
      searchUrl = `https://www.cargurus.com/Cars/searchresults.action?zip=${zipCode}&searchDistance=${distance === 'nationwide' ? 3000 : distance}&query=${encodeURIComponent(searchQuery)}`;
      
      // Add filters
      if (maxPrice) searchUrl += `&maxPrice=${maxPrice}`;
      if (maxMileage) searchUrl += `&maxMileage=${maxMileage}`;
      
      // Handle year range
      if (yearRange) {
        const years = yearRange.split('-');
        if (years.length === 2) {
          searchUrl += `&minYear=${years[0]}&maxYear=${years[1]}`;
        } else if (years.length === 1) {
          searchUrl += `&minYear=${years[0]}&maxYear=${years[0]}`;
        }
      }
    } else {
      // Use inventory listing for browsing without specific make/model
      searchUrl = `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?zip=${zipCode}`;
      
      if (maxPrice) searchUrl += `&maxPrice=${maxPrice}`;
      if (maxMileage) searchUrl += `&maxMileage=${maxMileage}`;
      
      // Handle year range
      if (yearRange) {
        const years = yearRange.split('-');
        if (years.length === 2) {
          searchUrl += `&minYear=${years[0]}&maxYear=${years[1]}`;
        } else if (years.length === 1) {
          searchUrl += `&minYear=${years[0]}&maxYear=${years[0]}`;
        }
      }
      
      // Handle distance
      if (distance === 'nationwide') {
        searchUrl += '&distance=3000';
      } else {
        searchUrl += `&distance=${distance}`;
      }
      
      searchUrl += '&showNegotiable=true&sortDir=ASC&sourceContext=carGurusHomePageModel&sortType=PRICE';
    }

    console.log('Navigating to:', searchUrl);
    console.log(`Search: ${make || 'Any'} ${model || ''} | Distance: ${distance === 'nationwide' ? 'Nationwide' : distance + ' miles'}`);
    
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
        'article[role="article"]',
        '.result-list-item',
        '.cg-listingCard'
      ];
      
      let listingElements = [];
      for (const selector of listingSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          listingElements = elements;
          console.log(`Found listings with selector: ${selector}`);
          break;
        }
      }

      if (listingElements.length === 0) {
        console.log('No listings found with any selector');
      }

      listingElements.forEach((elem, index) => {
        if (index >= 20) return; // Get more results
        
        try {
          // Extract text content helper
          const getText = (selectors) => {
            for (const selector of selectors) {
              const el = elem.querySelector(selector);
              if (el) return el.textContent.trim();
            }
            return '';
          };

          // Get the detail page link - try multiple selectors
          let detailUrl = '';
          const linkSelectors = ['a[href*="/Cars/"]', 'a.cg-listingCard-link', 'a'];
          for (const selector of linkSelectors) {
            const linkElement = elem.querySelector(selector);
            if (linkElement && linkElement.href) {
              detailUrl = linkElement.href;
              break;
            }
          }

          const listing = {
            title: getText(['h4', '.listing-title', '[data-testid="listing-title"]', '.cg-listingCard-title']),
            price: getText(['.price', '[data-testid="price"]', '.cg-dealFinder-priceAndMoPayment', '.cg-listingCard-price']),
            mileage: getText(['.mileage', '[data-testid="mileage"]', '.cg-listingCard-specs']),
            location: getText(['.dealer-location', '.location', '[data-testid="location"]', '.cg-listingCard-dealerName']),
            detailUrl: detailUrl,
            vin: elem.getAttribute('data-vin') || '',
            yearMakeModel: getText(['.make-model', '[data-testid="year-make-model"]', '.cg-listingCard-title'])
          };

          // Extract any visible car details
          const allText = elem.textContent;
          if (!listing.title && allText) {
            // Try to extract from full text
            const lines = allText.split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length > 0) listing.title = lines[0];
            if (lines.length > 1 && lines[1].includes('$')) listing.price = lines[1];
          }

          if (listing.title || listing.price || listing.detailUrl) {
            results.push(listing);
          }
        } catch (err) {
          console.error('Error parsing listing:', err);
        }
      });

      return results;
    });

    console.log(`Found ${listings.length} listings`);

    // If no listings found, check if we're on a "no results" page
    if (listings.length === 0) {
      const pageContent = await page.evaluate(() => {
        return {
          hasNoResults: document.body.textContent.includes('No exact matches') || 
                       document.body.textContent.includes('0 results') ||
                       document.body.textContent.includes('no listings'),
          suggestion: document.querySelector('.search-suggestion')?.textContent || ''
        };
      });

      if (pageContent.hasNoResults) {
        await browser.close();
        return res.json({
          success: true,
          count: 0,
          message: `No exact matches found for ${make} ${model}. CarGurus may show similar vehicles if you broaden your search criteria.`,
          suggestion: pageContent.suggestion,
          searchUrl: searchUrl,
          listings: []
        });
      }
    }

    // If skipDetails is true, return listings without visiting detail pages
    if (skipDetails) {
      await browser.close();
      
      return res.json({
        success: true,
        count: listings.length,
        searchUrl: searchUrl,
        distance: distance === 'nationwide' ? 'nationwide' : `${distance} miles`,
        note: 'CarGurus automatically includes similar vehicles when exact matches are limited',
        listings: listings
      });
    }

    // For each listing, get detailed info
    const detailedListings = [];
    const maxDetails = Math.min(listings.length, 5); // Limit detail fetching
    
    for (let i = 0; i < maxDetails; i++) {
      const listing = listings[i];
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
      totalFound: listings.length,
      searchUrl: searchUrl,
      distance: distance === 'nationwide' ? 'nationwide' : `${distance} miles`,
      note: 'CarGurus automatically includes similar vehicles when exact matches are limited',
      listings: detailedListings
    });

  } catch (error) {
    console.error('Scraping error:', error);
    console.error('Full error details:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Check Railway logs for more information',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Important for Railway!

app.listen(PORT, HOST, () => {
  console.log(`CarGurus scraper running on ${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Puppeteer executable: ${process.env.PUPPETEER_EXECUTABLE_PATH || 'Using bundled Chromium'}`);
});
