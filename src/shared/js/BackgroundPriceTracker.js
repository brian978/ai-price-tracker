/**
 * BackgroundPriceTracker - Handles price tracking operations for background script
 */
class BackgroundPriceTracker {
  constructor(dataManager, logger, notificationManager) {
    this.dataManager = dataManager;
    this.logger = logger;
    this.notificationManager = notificationManager;
  }

  /**
   * Track price using OpenAI API
   */
  async trackPrice(url, apiKey) {
    try {
      // Get the page content first
      let pageContent;
      
      try {
        // Try to get content from the active tab, passing the target URL to ensure we're on the right page
        pageContent = await this.getPageContent(url);
      } catch (contentError) {
        await this.logger.log('Could not get content from active tab, trying to fetch directly:', contentError.message);
        // If we can't get content from the active tab, try to fetch it directly
        try {
          pageContent = await this.fetchPageContentDirectly(url);
        } catch (fetchError) {
          await this.logger.log('Could not fetch content directly, using fallback:', fetchError.message);
          // If direct fetch fails, use a minimal pageContent with just the URL
          pageContent = {
            title: 'Product Page',
            bodyContent: 'Product information not available',
            url: url
          };
        }
      }

      // Ensure pageContent is defined before proceeding
      if (!pageContent) {
        await this.logger.log('pageContent is still undefined after all attempts, creating default object');
        pageContent = {
          title: 'Product Page',
          bodyContent: 'Product information not available',
          url: url
        };
      }

      // Extract information using OpenAI API
      return await this.extractDataWithOpenAI(url, apiKey, pageContent);
    } catch (error) {
      await this.logger.error('Error in trackPrice:', error);
      throw new Error('Failed to track price: ' + error.message);
    }
  }

  /**
   * Get the content of the current page
   */
  async getPageContent(targetUrl = null) {
    try {
      // Get the current active tab
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      // Execute a content script to get the page content
      const results = await browser.tabs.executeScript(tab.id, {
        code: `
          // Get the body content
          const bodyElement = document.body;
          const bodyText = bodyElement ? bodyElement.innerText : '';

          // Return half of the body content to avoid too large requests
          const halfLength = Math.floor(bodyText.length / 2);
          const halfBodyContent = bodyText.substring(0, halfLength);

          ({
            title: document.title,
            bodyContent: halfBodyContent,
            url: "${targetUrl || ''}" || window.location.href
          });
        `
      });

      const pageContent = results[0];
      
      // If a target URL was provided but the content URL doesn't match,
      // this means we're on a different page than the product we want to track
      if (targetUrl && pageContent.url !== targetUrl) {
        await this.logger.log('Current page URL does not match target product URL, fetching directly instead');
        throw new Error('Page URL mismatch');
      }

      return pageContent;
    } catch (error) {
      await this.logger.error('Error getting page content:', error);
      throw new Error('Could not access page content. Make sure you are on a product page.');
    }
  }

  /**
   * Extract data using OpenAI API
   */
  async extractDataWithOpenAI(url, apiKey, pageContent) {
    try {
      // Validate pageContent and its properties
      if (!pageContent) {
        this.logger.logSync('Page content is undefined, creating default pageContent object');
        pageContent = {
          title: 'Product Page',
          bodyContent: 'Product information not available',
          url: url
        };
      }
      
      const title = pageContent.title || 'Unknown Title';
      const bodyContent = pageContent.bodyContent || 'No content available';
      const pageUrl = pageContent.url || url;
      
      // Determine if we're using fallback content
      const usingFallback = bodyContent === 'Product information not available';
      
      // Prepare the prompt for OpenAI
      const prompt = `
            You are analyzing a product page at this URL: ${pageUrl}

            Page Title: ${title}

            ${usingFallback ? 
              `I don't have the page content, but I need you to analyze the URL: ${pageUrl}
               Please extract product information directly from the URL structure.` 
              : 
              `Page Content (first half of body):
               ${bodyContent}`
            }

            Please extract the following information from the ${usingFallback ? 'URL' : 'page content'} above:
            - The normalized product name
            - The current price (including currency symbol)

            For example if a product is called "Amazing Phone, Apple iPhone 13 Pro Max, 256 GB, lastest iOS" and the price is $1,000.00,
            the extracted data should be:
            { "name": "Apple iPhone 13 Pro Max, 256 GB", "price": "$1,000.00" }

            Another example, if a product is called "Kärcher 2.863-089.0 Plastic Parking Station" and the price is $1,
            the extracted data should be:
            { "name": "Kärcher Plastic Parking Station", "price": "$1" }

            Last example, if a product is called "Insta360 Ace Pro 2 Double Battery Bundle - 8K Waterproof Action Camera Designed with Leica, 1/1.3 Inch Sensor, Dual AI Chip System, Leading Low Light Performance, Best Audio, Flip Screen & AI Editin" and the price is €100.99,
            then the extracted data should be:
            { "name": "Insta360 Ace Pro 2 Double Battery Bundle", "price": "€100.99" }

            Return ONLY the JSON formatted string with these fields:
            - name: The product name
            - price: The product price
          `;

      // Make request to OpenAI API
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1-2025-04-14',
          tool_choice: 'required',
          tools: [
            { type: 'web_search_preview' },
          ],
          instructions: 'You are a helpful assistant that extracts product information from webpages. Do NOT use existing knowledge. Return only a raw JSON string on a single line, with no code block formatting or markdown. Example: {"name": "Product name", "price": "100.00"}',
          input: prompt,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.errorSync('OpenAI API error:', errorData);
        throw new Error(
          `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();

      // Check if the response has the expected structure
      if (!data.output || !Array.isArray(data.output)) {
        this.logger.errorSync('Unexpected API response format:', data);
        throw new Error('Invalid response format from OpenAI API');
      }

      // Find the message output in the response
      const messageOutput = data.output.find(item => item.type === 'message');
      if (!messageOutput || !messageOutput.content ||
        !messageOutput.content.length) {
        this.logger.errorSync('No message output found in response:', data);
        throw new Error('Invalid response format from OpenAI API');
      }

      // Get the text content from the message
      const textContent = messageOutput.content.find(
        item => item.type === 'output_text');
      if (!textContent || !textContent.text) {
        this.logger.errorSync('No text content found in message:', messageOutput);
        throw new Error('No text content found in the API response');
      }

      try {
        const extractedData = JSON.parse(textContent.text);

        // Validate the extracted data
        if (!extractedData.name || !extractedData.price) {
          throw new Error('Could not extract product information from this page');
        }

        return extractedData;
      } catch (jsonError) {
        this.logger.errorSync('Error parsing JSON:', jsonError);
        throw new Error(
          'Failed to parse JSON from the API response: ' + jsonError.message);
      }
    } catch (error) {
      this.logger.errorSync('Error extracting data with OpenAI:', error);
      throw new Error('Failed to extract data: ' + error.message);
    }
  }

  /**
   * Fetch page content directly for background checks
   */
  async fetchPageContentDirectly(url) {
    try {
      this.logger.logSync(`Fetching page content directly for ${url}`);
      
      // Fetch the page content
      const response = await fetch(url);
      
      if (!response.ok) {
        // If response is 503, throw a specific error to skip price tracking
        if (response.status === 503) {
          throw new Error(`503_SERVICE_UNAVAILABLE: Failed to fetch page: ${response.status} ${response.statusText}`);
        }
        throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
      }
      
      // Get the text content
      const html = await response.text();
      
      // Extract title using regex (simple approach)
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : 'Product Page';
      
      // Extract body content by removing HTML tags
      // This is a simple approach that works for most cases
      const bodyText = html
        .replace(/<head[\s\S]*?<\/head>/gi, '') // Remove head section
        .replace(/<script[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[\s\S]*?<\/style>/gi, '') // Remove styles
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      // Return half of the body content to avoid too large requests
      const halfLength = Math.min(10000, Math.floor(bodyText.length / 2)); // Limit to 10K chars max
      const halfBodyContent = bodyText.substring(0, halfLength);
      
      return {
        title: title,
        bodyContent: halfBodyContent,
        url: url
      };
    } catch (error) {
      this.logger.errorSync(`Error fetching page content for ${url}:`, error);
      // If it's a 503 error, re-throw it so calling functions can handle it
      if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
        throw error;
      }
      // Return a minimal pageContent object if fetching fails for other errors
      return {
        title: 'Product Page',
        bodyContent: 'Product information not available',
        url: url
      };
    }
  }

  /**
   * Set up price tracking for a specific URL
   */
  async setupPriceTracking(url, initialPrice, productName = 'Unknown Product', imageUrl = '') {
    try {
      // Get currently tracked prices from local storage
      const result = await browser.storage.local.get('trackedPrices');
      this.logger.logSync('Successfully retrieved tracked prices from local storage');
      
      const trackedPrices = result.trackedPrices || [];
      
      // Check if we already have entries for this URL
      const existingEntries = trackedPrices.filter(entry => entry.url === url);
      
      if (existingEntries.length === 0) {
        // No existing entries, create a new one using data manager structure control
        const newTrackedItem = this.dataManager.createTrackedPriceItem(url, productName, imageUrl);
        // Add initial price to history
        const initialHistoryEntry = this.dataManager.createPriceHistoryEntry(initialPrice);
        newTrackedItem.history.push(initialHistoryEntry);
        
        trackedPrices.push(newTrackedItem);
        this.logger.logSync(`Added new price tracking entry for ${url} with initial price ${initialPrice}`);
      } else {
        this.logger.logSync(`Price tracking already exists for ${url}`);
      }
      
      // Save using data manager
      await this.dataManager.saveTrackedPrices(trackedPrices);
      this.logger.logSync(`Price tracking set up for ${url} with initial price ${initialPrice} (saved using data manager)`);
      
      // Make sure the alarm is set up
      const alarms = await browser.alarms.getAll();
      if (!alarms.some(a => a.name === 'priceCheckAlarm')) {
        browser.alarms.create('priceCheckAlarm', {
          periodInMinutes: 60 // Check once per hour
        }).catch(error => this.logger.errorSync('Error creating price check alarm:', error));
        this.logger.logSync('Price check alarm created');
      }
    } catch (error) {
      this.logger.errorSync('Error setting up price tracking:', error);
    }
  }

  /**
   * Check prices for all tracked URLs
   */
  async checkAllPrices() {
    try {
      this.logger.logSync('Checking prices for all tracked items...');
      
      // Get tracked prices from data manager and settings from local storage
      const trackedPrices = await this.dataManager.getTrackedPrices();
      const result = await browser.storage.local.get(['priceAlarmEnabled', 'apiKey']);
      this.logger.logSync('Successfully retrieved price tracking data from data manager and settings from local storage');
      
      const apiKey = result.apiKey;
      const priceAlarmEnabled = result.priceAlarmEnabled === true;
      
      // Check if price alarm is enabled
      if (!priceAlarmEnabled) {
        this.logger.logSync('Price alarm is disabled, skipping price checks');
        return;
      }
      
      if (!apiKey) {
        this.logger.warnSync('No API key found, cannot check prices');
        return;
      }
      
      // Get the latest prices per URL for checking
      const latestPrices = this.getLatestPricePerUrl(trackedPrices);
      
      // Check each URL
      for (const [url, latestEntry] of Object.entries(latestPrices)) {
        try {
          this.logger.logSync(`Checking price for ${url}`);
          
          // Fetch page content directly for background checks
          let pageContent = await this.fetchPageContentDirectly(url);
          
          // Get the current price using the fetched content
          const currentData = await this.extractDataWithOpenAI(url, apiKey, pageContent);
          
          // Validate the returned data
          if (!currentData || !currentData.price) {
            this.logger.errorSync(`Invalid data returned for ${url}:`, currentData);
            continue; // Skip to the next URL
          }
          
          const currentPrice = currentData.price;
          const oldPrice = latestEntry.price;
          
          // Store price in tracked history (only if different from last price)
          await this.storePriceInTrackedHistory(trackedPrices, url, currentData.name || 'Unknown Product', currentPrice, latestEntry.imageUrl || '');
          
          // Compare prices
          if (this.isPriceLower(currentPrice, oldPrice)) {
            this.logger.logSync(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
            
            // Send notification
            await this.notificationManager.sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
            
            // Store notification in history
            await this.notificationManager.storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
          } else {
            this.logger.logSync(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
          }
        } catch (error) {
          this.logger.errorSync(`Error checking price for ${url}:`, error);
          // If it's a 503 error, skip price tracking for this item
          if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
            this.logger.logSync(`Skipping price tracking for ${url} due to 503 Service Unavailable error`);
            continue; // Skip to the next URL without updating lastChecked
          }
        }
      }
      
      // Save updated tracking data using data manager
      await this.dataManager.saveTrackedPrices(trackedPrices);
      
    } catch (error) {
      this.logger.errorSync('Error checking prices:', error);
    }
  }

  /**
   * Compare prices to determine if there's a drop
   */
  isPriceLower(currentPrice, oldPrice) {
    // Extract numeric values from price strings
    const extractNumeric = (priceStr) => {
      const matches = priceStr.match(/[\d,.]+/);
      if (matches && matches.length > 0) {
        // Replace commas with dots and parse as float
        return parseFloat(matches[0].replace(/,/g, '.').replace(/[^\d.]/g, ''));
      }
      return 0;
    };
    
    const currentNumeric = extractNumeric(currentPrice);
    const oldNumeric = extractNumeric(oldPrice);
    
    this.logger.logSync(`Comparing prices: ${oldNumeric} (old) vs ${currentNumeric} (current)`);
    
    // Return true if current price is lower
    return currentNumeric < oldNumeric;
  }

  /**
   * Store price check in trackedPrices history (only if price is different)
   */
  async storePriceInTrackedHistory(trackedPrices, url, productName, price, imageUrl = '') {
    try {
      // Use data manager to add price to history
      await this.dataManager.addPriceToHistory(url, productName, price, imageUrl);
    } catch (error) {
      this.logger.errorSync('Error storing price in tracked history:', error);
    }
  }

  /**
   * Get the latest price entry per URL
   */
  getLatestPricePerUrl(trackedPrices) {
    const latestPrices = {};
    
    // Group entries by URL and find the most recent one for each
    for (const entry of trackedPrices) {
      if (!entry.url || !entry.price) continue;
      
      if (!latestPrices[entry.url] || 
          new Date(entry.date) > new Date(latestPrices[entry.url].date)) {
        latestPrices[entry.url] = entry;
      }
    }
    
    return latestPrices;
  }

  /**
   * Check items on startup with provided tracked prices
   */
  async checkItemsOnStartup(trackedPrices) {
    try {
      this.logger.logSync('Checking items on startup, regardless of price tracking status...');
      
      // Get API key from local storage
      const result = await browser.storage.local.get(['apiKey']);
      this.logger.logSync('Successfully retrieved API key from local storage for startup check');

      const apiKey = result.apiKey;
      
      if (!apiKey) {
        this.logger.warnSync('No API key found, cannot check prices on startup');
        return;
      }
      
      // Get latest prices per URL for checking
      const latestPrices = this.getLatestPricePerUrl(trackedPrices);
      
      // Check each URL
      for (const [url, latestEntry] of Object.entries(latestPrices)) {
        try {
          this.logger.logSync(`Checking price for ${url} on startup`);
          
          // Fetch page content directly for background checks
          let pageContent = await this.fetchPageContentDirectly(url);
          
          // Get current price using the fetched content
          const currentData = await this.extractDataWithOpenAI(url, apiKey, pageContent);
          
          // Validate the returned data
          if (!currentData || !currentData.price) {
            this.logger.errorSync(`Invalid data returned for ${url}:`, currentData);
            continue; // Skip to the next URL
          }
          
          const currentPrice = currentData.price;
          const oldPrice = latestEntry.price;
          
          // Store price in tracked history (only if different from last price)
          await this.storePriceInTrackedHistory(trackedPrices, url, currentData.name || 'Unknown Product', currentPrice, latestEntry.imageUrl || '');
          
          // Compare prices
          if (this.isPriceLower(currentPrice, oldPrice)) {
            this.logger.logSync(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
            
            // Send notification
            await this.notificationManager.sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
            
            // Store notification in history
            await this.notificationManager.storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
          } else {
            this.logger.logSync(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
          }
        } catch (error) {
          this.logger.errorSync(`Error checking price for ${url} on startup:`, error);
          // If it's a 503 error, skip price tracking for this item
          if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
            this.logger.logSync(`Skipping price tracking for ${url} due to 503 Service Unavailable error`);
            continue; // Skip to the next URL without updating lastChecked
          }
        }
      }
      
      // Save updated tracking data using data manager
      await this.dataManager.saveTrackedPrices(trackedPrices);
      this.logger.logSync('Updated tracking data saved using data manager after startup check');
      
    } catch (error) {
      this.logger.errorSync('Error checking prices on startup:', error);
    }
  }
}