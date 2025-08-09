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
          var bodyElement = document.body;
          var bodyText = bodyElement ? bodyElement.innerText : '';

          // Return half of the body content to avoid too large requests
          var halfLength = Math.floor(bodyText.length / 2);
          var halfBodyContent = bodyText.substring(0, halfLength);

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
            - The current price in a consistent format

            IMPORTANT: For the price, please format it as <number>,<decimals> where:
            - Remove all thousands separators (dots, spaces, apostrophes)
            - Use only a comma (,) as the decimal separator
            - Include the currency symbol at the beginning

            Examples of price formatting:
            - If you find "$1,234.56" → format as "$1234,56"
            - If you find "€2.345,99" → format as "€2345,99"
            - If you find "1 234,50 Lei" → format as "1234,50 Lei"
            - If you find "£3.456.789,12" → format as "£3456789,12"
            - If you find "123.222.122" → format as "123222,122" (assuming last part is decimals)

            For example, if a product is called "Amazing Phone, Apple iPhone 13 Pro Max, 256 GB, lastest iOS" and the price is $1,000.00,
            the extracted data should be:
            { "name": "Apple iPhone 13 Pro Max, 256 GB", "price": "$1000,00" }

            Another example, if a product is called "Kärcher 2.863-089.0 Plastic Parking Station" and the price is $1,
            the extracted data should be:
            { "name": "Kärcher Plastic Parking Station", "price": "$1,00" }

            Last example, if a product is called "Insta360 Ace Pro 2 Double Battery Bundle - 8K Waterproof Action Camera Designed with Leica, 1/1.3 Inch Sensor, Dual AI Chip System, Leading Low Light Performance, Best Audio, Flip Screen & AI Editin" and the price is €100.99,
            then the extracted data should be:
            { "name": "Insta360 Ace Pro 2 Double Battery Bundle", "price": "€100,99" }

            Return ONLY the JSON formatted string with these fields:
            - name: The product name
            - price: The product price (formatted as specified above)
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
      
      // Fetch the page content with proper browser headers to ensure consistency
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0'
        },
        redirect: 'follow',
        referrerPolicy: 'no-referrer-when-downgrade'
      });
      
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
      // Note: Price data is already saved by the frontend PriceTracker.trackPrice() method
      // via dataManager.addPriceToHistory(), so we don't need to save it again here
      // to avoid race conditions and duplicate storage operations
      
      this.logger.logSync(`Price tracking set up for ${url} with initial price ${initialPrice} (data already saved by frontend)`);
      
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
      
      // Note: No need to save trackedPrices here as addPriceToHistory already saves updated data
      
    } catch (error) {
      this.logger.errorSync('Error checking prices:', error);
    }
  }

  /**
   * Compare prices to determine if there's a drop
   */
  isPriceLower(currentPrice, oldPrice) {
    // Extract numeric values from price strings in the consistent format <number>,<decimals>
    const extractNumeric = (priceStr) => {
      if (!priceStr) return 0;
      // Remove currency symbols and extract the numeric part
      // Expected format: "€1234,56" or "$1000,00" etc.
      const numericPart = priceStr.replace(/[^\d,]/g, '');
      if (numericPart) {
        // Replace comma with dot for parseFloat (since LLM uses comma as decimal separator)
        return parseFloat(numericPart.replace(',', '.'));
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
    
    this.logger.logSync(`Processing ${trackedPrices.length} tracked items for latest prices`);
    
    // Process each tracked item (new data structure with history array)
    for (let item of trackedPrices) {
      if (!item.url) {
        this.logger.logSync(`Skipping item due to missing URL: url=${!!item.url}`);
        continue;
      }
      
      // If history is missing or empty, normalize the item to create proper structure
      if (!item.history || !Array.isArray(item.history) || item.history.length === 0) {
        this.logger.logSync(`Item has missing or empty history, normalizing: url=${item.url}, historyLength=${item.history?.length || 0}`);

        try {
          // Use data manager to normalize the item and ensure proper structure
          item = this.dataManager._validateTrackedPriceItem(item);
          // If still no history after normalization, this is a first-time item that needs its initial price
          if (!item.history || item.history.length === 0) {
            this.logger.logSync(`Item has empty history after normalization, will fetch initial price: ${item.url}`);
            // Create a special entry for first-time items with no price history
            const firstTimeEntry = {
              url: item.url,
              name: item.name,
              imageUrl: item.imageUrl,
              lastChecked: item.lastChecked,
              price: null, // No previous price to compare against
              date: null,
              timestamp: null,
              isFirstTime: true // Flag to indicate this needs initial price fetch
            };
            
            this.logger.logSync(`Added first-time item for price checking: ${item.url}`);
            latestPrices[item.url] = firstTimeEntry;
            continue;
          }
        } catch (error) {
          this.logger.errorSync(`Error normalizing item ${item.url}:`, error);
          continue;
        }
      }
      
      // Find the most recent price entry in the history
      const latestHistoryEntry = item.history.reduce((latest, current) => {
        const latestDate = new Date(latest.timestamp || latest.date);
        const currentDate = new Date(current.timestamp || current.date);
        return currentDate > latestDate ? current : latest;
      });
      
      // Create a combined entry with item info and latest price
      const combinedEntry = {
        url: item.url,
        name: item.name,
        imageUrl: item.imageUrl,
        lastChecked: item.lastChecked,
        price: latestHistoryEntry.price,
        date: latestHistoryEntry.date,
        timestamp: latestHistoryEntry.timestamp
      };
      
      this.logger.logSync(`Added latest price for ${item.url}: ${latestHistoryEntry.price}`);
      latestPrices[item.url] = combinedEntry;
    }
    
    this.logger.logSync(`Found ${Object.keys(latestPrices).length} items with valid price data`);
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
          
          // Handle first-time items vs items with existing price history
          if (latestEntry.isFirstTime) {
            this.logger.logSync(`First price recorded for ${url}: ${currentPrice}`);
          } else {
            // Compare prices only for items with existing price history
            if (this.isPriceLower(currentPrice, oldPrice)) {
              this.logger.logSync(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
              
              // Send notification
              await this.notificationManager.sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
              
              // Store notification in history
              await this.notificationManager.storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
            } else {
              this.logger.logSync(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
            }
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
      
      // Note: No need to save trackedPrices here as storePriceInTrackedHistory() 
      // already saves updated data via dataManager.addPriceToHistory()
      // Saving the stale trackedPrices parameter would overwrite fresh data
      this.logger.logSync('Startup check completed - data already saved by individual price updates');
      
    } catch (error) {
      this.logger.errorSync('Error checking prices on startup:', error);
    }
  }
}