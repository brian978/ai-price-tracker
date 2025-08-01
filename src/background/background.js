// Create global instance of PriceDataManager
const dataManager = new PriceDataManager();

async function getViewMode() {
  const result = await browser.storage.local.get('viewMode');
  return result.viewMode || 'popup';
}

// Set the view mode (popup or sidebar)
async function setViewMode(viewMode) {
  try {
    if (viewMode === 'sidebar') {
      // Disable popup so click handler is called
      await browser.browserAction.setPopup({ popup: '' });
    } else {
      // Enable popup for normal popup behavior
      await browser.browserAction.setPopup({ popup: 'popup/popup.html' });
    }
  } catch (error) {
    logger.errorSync('Error setting view mode:', error);
  }
}


// Initialize view mode on startup
async function initializeViewMode() {
  try {
    const viewMode = await getViewMode();
    await setViewMode(viewMode);
  } catch (error) {
    logger.errorSync('Error initializing view mode:', error);
    // Default to popup mode
    await setViewMode('popup');
  }
}

// Listen for extension icon clicks (only called when the popup is disabled)
browser.browserAction.onClicked.addListener((tab, info) => {
  // Call open() first while still in the user input handler context
  browser.sidebarAction.open().catch(error => logger.errorSync('Error opening sidebar:', error));

  // Then set the panel (this can be async)
  browser.sidebarAction.setPanel({ panel: 'sidebar/sidebar.html' }).catch(error => logger.errorSync('Error setting sidebar panel:', error));
});

// Listen for storage changes to update view mode and price alarm settings
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' || areaName === 'sync') {
    await logger.log(`Storage changes detected in ${areaName} storage:`, changes);
    
    // Handle view mode changes
    if (changes.viewMode) {
      await setViewMode(changes.viewMode.newValue);
    }
    
    // Handle price alarm setting changes
    if (changes.priceAlarmEnabled !== undefined) {
      const priceAlarmEnabled = changes.priceAlarmEnabled.newValue === true;
      
      if (priceAlarmEnabled) {
        // Create the alarm if it was enabled
        browser.alarms.create(PRICE_CHECK_ALARM_NAME, {
          periodInMinutes: 60 // Check once per hour
        }).catch(error => logger.errorSync('Error creating alarm:', error));
        await logger.log('Price tracking alarm enabled via settings change');
        
        // Trigger immediate check for all tracked items when price tracking is enabled
        // This ensures items tracked before enabling price tracking are checked
        setTimeout(() => checkTrackedItemsOnEnable(), 2000);
      } else {
        // Clear the alarm if it was disabled
        await browser.alarms.clear(PRICE_CHECK_ALARM_NAME);
        await logger.log('Price tracking alarm disabled via settings change');
      }
    }
  }
});

browser.runtime.onInstalled.addListener((details) => {
  // noinspection JSIgnoredPromiseFromCall
  initializeViewMode();
  
  // Initialize price tracking on installation
  initializePriceTracking();
  
  // When the extension is refreshed/updated, check all tracked items immediately
  if (details.reason === 'update' || details.reason === 'install') {
    logger.logSync('Extension was refreshed/updated, checking all tracked items immediately');
    setTimeout(() => checkAllTrackedItemsOnRefresh(), 3000);
  }
});

browser.runtime.onStartup.addListener(() => {
  // noinspection JSIgnoredPromiseFromCall
  initializeViewMode();
  
  // Initialize price tracking on startup
  initializePriceTracking();
});

// Listen for messages from the popup/sidebar
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'trackPrice') {
    trackPrice(message.url, message.apiKey)
      .then(result => {
        // After tracking the price, set up periodic checking for this URL
        setupPriceTracking(message.url, result.price, result.name, result.imageUrl);
        sendResponse(result);
      })
      .catch(error => sendResponse({ error: error.message }));

    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

// Function to track price using OpenAI API
async function trackPrice(url, apiKey) {
  try {
    // Get the page content first
    let pageContent;
    
    try {
      // Try to get content from active tab, passing the target URL to ensure we're on the right page
      pageContent = await getPageContent(url);
    } catch (contentError) {
      await logger.log('Could not get content from active tab, trying to fetch directly:', contentError.message);
      // If we can't get content from active tab, try to fetch it directly
      try {
        pageContent = await fetchPageContentDirectly(url);
      } catch (fetchError) {
        await logger.log('Could not fetch content directly, using fallback:', fetchError.message);
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
      await logger.log('pageContent is still undefined after all attempts, creating default object');
      pageContent = {
        title: 'Product Page',
        bodyContent: 'Product information not available',
        url: url
      };
    }

    // Extract information using OpenAI API
    return await extractDataWithOpenAI(url, apiKey, pageContent);
  } catch (error) {
    await logger.error('Error in trackPrice:', error);
    throw new Error('Failed to track price: ' + error.message);
  }
}

// Function to get the content of the current page
async function getPageContent(targetUrl = null) {
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
      await logger.log('Current page URL does not match target product URL, fetching directly instead');
      throw new Error('Page URL mismatch');
    }

    return pageContent;
  } catch (error) {
    await logger.error('Error getting page content:', error);
    throw new Error('Could not access page content. Make sure you are on a product page.');
  }
}

// Function to extract data using OpenAI API
async function extractDataWithOpenAI(url, apiKey, pageContent) {
  try {
    // Validate pageContent and its properties
    if (!pageContent) {
      logger.logSync('Page content is undefined, creating default pageContent object');
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
      logger.errorSync('OpenAI API error:', errorData);
      throw new Error(
        `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    // Check if the response has the expected structure
    if (!data.output || !Array.isArray(data.output)) {
      logger.errorSync('Unexpected API response format:', data);
      throw new Error('Invalid response format from OpenAI API');
    }

    // Find the message output in the response
    const messageOutput = data.output.find(item => item.type === 'message');
    if (!messageOutput || !messageOutput.content ||
      !messageOutput.content.length) {
      logger.errorSync('No message output found in response:', data);
      throw new Error('Invalid response format from OpenAI API');
    }

    // Get the text content from the message
    const textContent = messageOutput.content.find(
      item => item.type === 'output_text');
    if (!textContent || !textContent.text) {
      logger.errorSync('No text content found in message:', messageOutput);
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
      logger.errorSync('Error parsing JSON:', jsonError);
      throw new Error(
        'Failed to parse JSON from the API response: ' + jsonError.message);
    }
  } catch (error) {
    logger.errorSync('Error extracting data with OpenAI:', error);
    throw new Error('Failed to extract data: ' + error.message);
  }
}

// Price tracking functionality
const PRICE_CHECK_ALARM_NAME = 'priceCheckAlarm';

// Helper functions for unified trackedPrices array
function getLatestPricePerUrl(trackedPrices) {
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


function getUrlsNeedingCheck(trackedPrices, hoursThreshold = 1) {
  const latestPrices = getLatestPricePerUrl(trackedPrices);
  const urlsNeedingCheck = [];
  const now = new Date();
  
  for (const [url, entry] of Object.entries(latestPrices)) {
    // Check for items that have never been checked
    if (!entry.lastChecked) {
      urlsNeedingCheck.push(url);
      continue;
    }
    
    // Check for items that haven't been checked in the specified time
    const lastChecked = new Date(entry.lastChecked);
    const hoursSinceLastCheck = (now - lastChecked) / (1000 * 60 * 60);
    
    if (hoursSinceLastCheck >= hoursThreshold) {
      urlsNeedingCheck.push(url);
    }
  }
  
  return urlsNeedingCheck;
}

// Initialize the price tracking system
async function initializePriceTracking() {
  try {
    // Check if price alarm is enabled and get tracked prices from local storage
    const result = await browser.storage.local.get(['priceAlarmEnabled', 'trackedPrices']);
    logger.logSync('Successfully retrieved data from local storage');
    
    const priceAlarmEnabled = result.priceAlarmEnabled === true;
    let trackedPrices = result.trackedPrices || [];
    
    logger.logSync('Storage data retrieved:', {
      priceAlarmEnabled,
      trackedPricesCount: trackedPrices.length
    });
    
    // Ensure all entries have lastChecked field (for entries that might not have it)
    for (const entry of trackedPrices) {
      if (!entry.lastChecked) {
        entry.lastChecked = new Date().toISOString();
      }
    }
    
    // Save the updated trackedPrices using data manager
    await dataManager.saveTrackedPrices(trackedPrices);
    
    // BROWSER RESTART HANDLING:
    // Since browser alarms don't run when the browser is closed, we need to check
    // if any products should have been checked while the browser was closed.
    // This ensures that even if a user opens their browser for short periods,
    // price checks will still happen at roughly hourly intervals.
    const urlsNeedingCheck = getUrlsNeedingCheck(trackedPrices, 1);
    
    if (urlsNeedingCheck.length > 0) {
      logger.logSync(`Found ${urlsNeedingCheck.length} products that need checking:`, urlsNeedingCheck);
      logger.logSync('Some products need to be checked (never checked or not checked in over an hour), performing immediate check');
      // Use setTimeout to allow the extension to fully initialize first
      setTimeout(() => checkItemsOnStartup(trackedPrices), 5000);
    }
    
    // Set up the alarm for hourly price checks only if enabled
    if (priceAlarmEnabled) {
      browser.alarms.create(PRICE_CHECK_ALARM_NAME, {
        periodInMinutes: 60 // Check once per hour
      }).catch(error => logger.errorSync('Error creating price check alarm:', error));
      logger.logSync('Price tracking alarm created - automatic checking enabled');
    } else {
      // Make sure alarm is cleared if disabled
      await browser.alarms.clear(PRICE_CHECK_ALARM_NAME);
      logger.logSync('Price tracking alarm disabled - automatic checking disabled');
    }
    
    // Listen for alarm events
    browser.alarms.onAlarm.addListener(handleAlarm);
    
    logger.logSync('Price tracking system initialized');
  } catch (error) {
    logger.errorSync('Error initializing price tracking:', error);
  }
}

// Handle alarm events
async function handleAlarm(alarm) {
  if (alarm.name === PRICE_CHECK_ALARM_NAME) {
    await checkAllPrices();
  }
}

// Set up price tracking for a specific URL
async function setupPriceTracking(url, initialPrice, productName = 'Unknown Product', imageUrl = '') {
  try {
    // Get currently tracked prices from local storage
    const result = await browser.storage.local.get('trackedPrices');
    logger.logSync('Successfully retrieved tracked prices from local storage');
    
    const trackedPrices = result.trackedPrices || [];
    
    // Check if we already have entries for this URL
    const existingEntries = trackedPrices.filter(entry => entry.url === url);
    
    if (existingEntries.length === 0) {
      // No existing entries, create a new one using data manager structure control
      const newTrackedItem = dataManager.createTrackedPriceItem(url, productName, imageUrl);
      // Add initial price to history
      const initialHistoryEntry = dataManager.createPriceHistoryEntry(initialPrice);
      newTrackedItem.history.push(initialHistoryEntry);
      
      trackedPrices.push(newTrackedItem);
      logger.logSync(`Added new price tracking entry for ${url} with initial price ${initialPrice}`);
    } else {
      logger.logSync(`Price tracking already exists for ${url}`);
    }
    
    // Save using data manager
    await dataManager.saveTrackedPrices(trackedPrices);
    logger.logSync(`Price tracking set up for ${url} with initial price ${initialPrice} (saved using data manager)`);
    
    // Make sure the alarm is set up
    const alarms = await browser.alarms.getAll();
    if (!alarms.some(a => a.name === PRICE_CHECK_ALARM_NAME)) {
      browser.alarms.create(PRICE_CHECK_ALARM_NAME, {
        periodInMinutes: 60 // Check once per hour
      }).catch(error => logger.errorSync('Error creating price check alarm:', error));
      logger.logSync('Price check alarm created');
    }
  } catch (error) {
    logger.errorSync('Error setting up price tracking:', error);
  }
}

// Check prices for all tracked URLs
async function checkAllPrices() {
  try {
    logger.logSync('Checking prices for all tracked items...');
    
    // Get tracked prices from data manager and settings from local storage
    const trackedPrices = await dataManager.getTrackedPrices();
    const result = await browser.storage.local.get(['priceAlarmEnabled', 'apiKey']);
    logger.logSync('Successfully retrieved price tracking data from data manager and settings from local storage');
    
    const apiKey = result.apiKey;
    const priceAlarmEnabled = result.priceAlarmEnabled === true;
    
    // Check if price alarm is enabled
    if (!priceAlarmEnabled) {
      logger.logSync('Price alarm is disabled, skipping price checks');
      return;
    }
    
    if (!apiKey) {
      logger.warnSync('No API key found, cannot check prices');
      return;
    }
    
    // Get latest prices per URL for checking
    const latestPrices = getLatestPricePerUrl(trackedPrices);
    
    // Check each URL
    for (const [url, latestEntry] of Object.entries(latestPrices)) {
      try {
        logger.logSync(`Checking price for ${url}`);
        
        // Fetch page content directly for background checks
        let pageContent = await fetchPageContentDirectly(url);
        
        // Get current price using the fetched content
        const currentData = await extractDataWithOpenAI(url, apiKey, pageContent);
        
        // Validate the returned data
        if (!currentData || !currentData.price) {
          logger.errorSync(`Invalid data returned for ${url}:`, currentData);
          continue; // Skip to the next URL
        }
        
        const currentPrice = currentData.price;
        const oldPrice = latestEntry.price;
        
        // Store price in tracked history (only if different from last price)
        await storePriceInTrackedHistory(trackedPrices, url, currentData.name || 'Unknown Product', currentPrice, latestEntry.imageUrl || '');
        
        // Compare prices
        if (isPriceLower(currentPrice, oldPrice)) {
          logger.logSync(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
          
          // Send notification
          await sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
          
          // Store notification in history
          await storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
        } else {
          logger.logSync(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
        }
      } catch (error) {
        logger.errorSync(`Error checking price for ${url}:`, error);
        // If it's a 503 error, skip price tracking for this item
        if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
          logger.logSync(`Skipping price tracking for ${url} due to 503 Service Unavailable error`);
          continue; // Skip to the next URL without updating lastChecked
        }
      }
    }
    
    // Save updated tracking data using data manager
    await dataManager.saveTrackedPrices(trackedPrices);
    
  } catch (error) {
    logger.errorSync('Error checking prices:', error);
  }
}

// Compare prices to determine if there's a drop
function isPriceLower(currentPrice, oldPrice) {
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
  
  logger.logSync(`Comparing prices: ${oldNumeric} (old) vs ${currentNumeric} (current)`);
  
  // Return true if current price is lower
  return currentNumeric < oldNumeric;
}

// Send browser notification for price drop
async function sendPriceDropNotification(url, productName, oldPrice, newPrice) {
  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-96.png'),
      title: 'Price Drop Alert!',
      message: `${productName} price dropped from ${oldPrice} to ${newPrice}!`,
      contextMessage: 'Click to open product page'
    });
    
    // Set up notification click handler if not already set
    if (!browser.notifications.onClicked.hasListener(handleNotificationClick)) {
      browser.notifications.onClicked.addListener(handleNotificationClick);
    }
    
    // Store the URL for this notification in local storage
    await browser.storage.local.set({ 'lastNotificationUrl': url });
    
  } catch (error) {
    logger.errorSync('Error sending notification:', error);
  }
}

// Handle notification click
function handleNotificationClick(notificationId) {
  browser.storage.local.get('lastNotificationUrl').then(result => {
    if (result.lastNotificationUrl) {
      browser.tabs.create({ url: result.lastNotificationUrl });
    }
  }).catch(error => logger.errorSync("Error:", error));
}

// Store price drop notification in history
async function storePriceDropNotification(url, productName, oldPrice, newPrice) {
  try {
    // Get existing notification history from local storage
    const result = await browser.storage.local.get('priceDropHistory');
    const history = result.priceDropHistory || [];

    // Add new notification to history
    history.push({
      url: url,
      productName: productName,
      oldPrice: oldPrice,
      newPrice: newPrice,
      timestamp: new Date().toISOString()
    });

    // Keep only the most recent 50 notifications
    if (history.length > 50) {
      history.shift(); // Remove oldest notification
    }

    // Save updated history to local storage
    await browser.storage.local.set({ 'priceDropHistory': history });
    
  } catch (error) {
    logger.errorSync('Error storing notification history:', error);
  }
}

// Store price check in trackedPrices history (only if price is different)
async function storePriceInTrackedHistory(trackedPrices, url, productName, price, imageUrl = '') {
  try {
    // Use data manager to add price to history
    await dataManager.addPriceToHistory(url, productName, price, imageUrl);
  } catch (error) {
    logger.errorSync('Error storing price in tracked history:', error);
  }
}

// Function to check all tracked items when price tracking is enabled
async function checkTrackedItemsOnEnable() {
  try {
    logger.logSync('Checking all tracked items after enabling price tracking...');
    
    // Get tracked prices from data manager
    const trackedPrices = await dataManager.getTrackedPrices();
    logger.logSync('Successfully retrieved tracked items from data manager for checking after enable');
    
    if (trackedPrices.length === 0) {
      logger.logSync('No tracked items found to check');
      return;
    }
    
    // Get unique URLs from the array
    const uniqueUrls = [...new Set(trackedPrices.map(entry => entry.url))];
    logger.logSync(`Found ${uniqueUrls.length} unique tracked items to check after enabling price tracking`);
    
    // Mark all items for immediate checking by calling checkAllPrices
    setTimeout(() => checkAllPrices(), 3000);
  } catch (error) {
    logger.errorSync('Error checking tracked items on enable:', error);
  }
}

// Function to check all tracked items when the extension is refreshed
async function checkAllTrackedItemsOnRefresh() {
  try {
    logger.logSync('Checking all tracked items after extension refresh...');
    
    // Get tracked data from data manager
    const data = await dataManager.getAllTrackedData();
    logger.logSync('Successfully retrieved tracked items from data manager for refresh check');
    
    // Extract data from result
    let trackedPrices = data.trackedPrices || [];
    const oldTrackedItems = data.trackedItems || {};
    
    logger.logSync(`Storage check - trackedPrices: ${trackedPrices.length} items, trackedItems: ${Object.keys(oldTrackedItems).length} items`);
    
    // Log the actual content for debugging
    logger.logSync('trackedPrices content:', trackedPrices);
    logger.logSync('trackedItems content:', oldTrackedItems);
    
    // If we have no items in the main storage but have items in the old storage,
    // migrate them first
    if (trackedPrices.length === 0 && Object.keys(oldTrackedItems).length > 0) {
      logger.logSync('Found older tracked items during refresh, migrating to unified format');
      
      // Process items from oldTrackedItems
      for (const [url, item] of Object.entries(oldTrackedItems)) {
        logger.logSync(`Migrating old tracked item for ${url} without price data`);
        // Create tracked item using data manager structure control
        const migratedItem = dataManager.createTrackedPriceItem(
          url, 
          item.name || 'Unknown Product', 
          item.imageUrl || ''
        );
        // Add default price history entry since we don't have price data
        const defaultHistoryEntry = dataManager.createPriceHistoryEntry('0.00');
        migratedItem.history.push(defaultHistoryEntry);
        
        trackedPrices.push(migratedItem);
      }
      
      // Save the updated trackedPrices using data manager
      await dataManager.saveTrackedPrices(trackedPrices);
      
      logger.logSync('Migration complete during refresh, all old items saved to unified storage');
    }
    
    if (trackedPrices.length === 0) {
      logger.logSync('No tracked items found to check after refresh (checked all storage locations)');
      return;
    }
    
    // Get unique URLs for counting
    const uniqueUrls = [...new Set(trackedPrices.map(entry => entry.url))];
    logger.logSync(`Found ${uniqueUrls.length} unique tracked items to check after extension refresh`);
    
    // Check all items regardless of when they were last checked
    await checkItemsOnStartup(trackedPrices);
  } catch (error) {
    logger.errorSync('Error checking tracked items on extension refresh:', error);
  }
}

// Function to check items on startup, regardless of price tracking status
async function checkItemsOnStartup(trackedPrices) {
  try {
    logger.logSync('Checking items on startup, regardless of price tracking status...');
    
    // Get API key from local storage
    const result = await browser.storage.local.get(['apiKey']);
    logger.logSync('Successfully retrieved API key from local storage for startup check');

    const apiKey = result.apiKey;
    
    if (!apiKey) {
      logger.warnSync('No API key found, cannot check prices on startup');
      return;
    }
    
    // Get latest prices per URL for checking
    const latestPrices = getLatestPricePerUrl(trackedPrices);
    
    // Check each URL
    for (const [url, latestEntry] of Object.entries(latestPrices)) {
      try {
        logger.logSync(`Checking price for ${url} on startup`);
        
        // Fetch page content directly for background checks
        let pageContent = await fetchPageContentDirectly(url);
        
        // Get current price using the fetched content
        const currentData = await extractDataWithOpenAI(url, apiKey, pageContent);
        
        // Validate the returned data
        if (!currentData || !currentData.price) {
          logger.errorSync(`Invalid data returned for ${url}:`, currentData);
          continue; // Skip to the next URL
        }
        
        const currentPrice = currentData.price;
        const oldPrice = latestEntry.price;
        
        // Store price in tracked history (only if different from last price)
        await storePriceInTrackedHistory(trackedPrices, url, currentData.name || 'Unknown Product', currentPrice, latestEntry.imageUrl || '');
        
        // Compare prices
        if (isPriceLower(currentPrice, oldPrice)) {
          logger.logSync(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
          
          // Send notification
          await sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
          
          // Store notification in history
          await storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
        } else {
          logger.logSync(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
        }
      } catch (error) {
        logger.errorSync(`Error checking price for ${url} on startup:`, error);
        // If it's a 503 error, skip price tracking for this item
        if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
          logger.logSync(`Skipping price tracking for ${url} due to 503 Service Unavailable error`);
          continue; // Skip to the next URL without updating lastChecked
        }
      }
    }
    
    // Save updated tracking data using data manager
    await dataManager.saveTrackedPrices(trackedPrices);
    logger.logSync('Updated tracking data saved using data manager after startup check');
    
  } catch (error) {
    logger.errorSync('Error checking prices on startup:', error);
  }
}

// Function to fetch page content directly for background checks
async function fetchPageContentDirectly(url) {
  try {
    logger.logSync(`Fetching page content directly for ${url}`);
    
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
    logger.errorSync(`Error fetching page content for ${url}:`, error);
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
