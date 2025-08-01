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
    console.error('Error setting view mode:', error);
  }
}


// Initialize view mode on startup
async function initializeViewMode() {
  try {
    const viewMode = await getViewMode();
    await setViewMode(viewMode);
  } catch (error) {
    console.error('Error initializing view mode:', error);
    // Default to popup mode
    await setViewMode('popup');
  }
}

// Listen for extension icon clicks (only called when the popup is disabled)
browser.browserAction.onClicked.addListener((tab, info) => {
  // Call open() first while still in the user input handler context
  browser.sidebarAction.open().catch(console.error);

  // Then set the panel (this can be async)
  browser.sidebarAction.setPanel({ panel: 'sidebar/sidebar.html' }).catch(console.error);
});

// Listen for storage changes to update view mode and price alarm settings
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' || areaName === 'sync') {
    console.log(`Storage changes detected in ${areaName} storage:`, changes);
    
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
        }).catch(error => console.error('Error creating alarm:', error));
        console.log('Price tracking alarm enabled via settings change');
        
        // Trigger immediate check for all tracked items when price tracking is enabled
        // This ensures items tracked before enabling price tracking are checked
        setTimeout(() => checkTrackedItemsOnEnable(), 2000);
      } else {
        // Clear the alarm if it was disabled
        await browser.alarms.clear(PRICE_CHECK_ALARM_NAME);
        console.log('Price tracking alarm disabled via settings change');
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
    console.log('Extension was refreshed/updated, checking all tracked items immediately');
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
        setupPriceTracking(message.url, result.price);
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
      console.log('Could not get content from active tab, trying to fetch directly:', contentError.message);
      // If we can't get content from active tab, try to fetch it directly
      try {
        pageContent = await fetchPageContentDirectly(url);
      } catch (fetchError) {
        console.log('Could not fetch content directly, using fallback:', fetchError.message);
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
      console.log('pageContent is still undefined after all attempts, creating default object');
      pageContent = {
        title: 'Product Page',
        bodyContent: 'Product information not available',
        url: url
      };
    }

    // Extract information using OpenAI API
    return await extractDataWithOpenAI(url, apiKey, pageContent);
  } catch (error) {
    console.error('Error in trackPrice:', error);
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
      console.log('Current page URL does not match target product URL, fetching directly instead');
      throw new Error('Page URL mismatch');
    }

    return pageContent;
  } catch (error) {
    console.error('Error getting page content:', error);
    throw new Error('Could not access page content. Make sure you are on a product page.');
  }
}

// Function to extract data using OpenAI API
async function extractDataWithOpenAI(url, apiKey, pageContent) {
  try {
    // Validate pageContent and its properties
    if (!pageContent) {
      console.log('Page content is undefined, creating default pageContent object');
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
      console.error('OpenAI API error:', errorData);
      throw new Error(
        `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    // Check if the response has the expected structure
    if (!data.output || !Array.isArray(data.output)) {
      console.error('Unexpected API response format:', data);
      throw new Error('Invalid response format from OpenAI API');
    }

    // Find the message output in the response
    const messageOutput = data.output.find(item => item.type === 'message');
    if (!messageOutput || !messageOutput.content ||
      !messageOutput.content.length) {
      console.error('No message output found in response:', data);
      throw new Error('Invalid response format from OpenAI API');
    }

    // Get the text content from the message
    const textContent = messageOutput.content.find(
      item => item.type === 'output_text');
    if (!textContent || !textContent.text) {
      console.error('No text content found in message:', messageOutput);
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
      console.error('Error parsing JSON:', jsonError);
      throw new Error(
        'Failed to parse JSON from the API response: ' + jsonError.message);
    }
  } catch (error) {
    console.error('Error extracting data with OpenAI:', error);
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

function updateLastChecked(trackedPrices, url, timestamp) {
  // Find the most recent entry for this URL and update its lastChecked
  let latestEntry = null;
  let latestIndex = -1;
  
  for (let i = 0; i < trackedPrices.length; i++) {
    const entry = trackedPrices[i];
    if (entry.url === url) {
      if (!latestEntry || new Date(entry.date) > new Date(latestEntry.date)) {
        latestEntry = entry;
        latestIndex = i;
      }
    }
  }
  
  if (latestEntry && latestIndex >= 0) {
    trackedPrices[latestIndex].lastChecked = timestamp;
  }
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
    console.log('Successfully retrieved data from local storage');
    
    const priceAlarmEnabled = result.priceAlarmEnabled === true;
    let trackedPrices = result.trackedPrices || [];
    
    console.log('Storage data retrieved:', {
      priceAlarmEnabled,
      trackedPricesCount: trackedPrices.length
    });
    
    // Ensure all entries have lastChecked field (for entries that might not have it)
    for (const entry of trackedPrices) {
      if (!entry.lastChecked) {
        entry.lastChecked = new Date().toISOString();
      }
    }
    
    // Save the updated trackedPrices to local storage
    await browser.storage.local.set({ trackedPrices: trackedPrices });
    
    // BROWSER RESTART HANDLING:
    // Since browser alarms don't run when the browser is closed, we need to check
    // if any products should have been checked while the browser was closed.
    // This ensures that even if a user opens their browser for short periods,
    // price checks will still happen at roughly hourly intervals.
    const urlsNeedingCheck = getUrlsNeedingCheck(trackedPrices, 1);
    
    if (urlsNeedingCheck.length > 0) {
      console.log(`Found ${urlsNeedingCheck.length} products that need checking:`, urlsNeedingCheck);
      console.log('Some products need to be checked (never checked or not checked in over an hour), performing immediate check');
      // Use setTimeout to allow the extension to fully initialize first
      setTimeout(() => checkItemsOnStartup(trackedPrices), 5000);
    }
    
    // Set up the alarm for hourly price checks only if enabled
    if (priceAlarmEnabled) {
      browser.alarms.create(PRICE_CHECK_ALARM_NAME, {
        periodInMinutes: 60 // Check once per hour
      }).catch(error => console.error('Error creating price check alarm:', error));
      console.log('Price tracking alarm created - automatic checking enabled');
    } else {
      // Make sure alarm is cleared if disabled
      await browser.alarms.clear(PRICE_CHECK_ALARM_NAME);
      console.log('Price tracking alarm disabled - automatic checking disabled');
    }
    
    // Listen for alarm events
    browser.alarms.onAlarm.addListener(handleAlarm);
    
    console.log('Price tracking system initialized');
  } catch (error) {
    console.error('Error initializing price tracking:', error);
  }
}

// Handle alarm events
async function handleAlarm(alarm) {
  if (alarm.name === PRICE_CHECK_ALARM_NAME) {
    await checkAllPrices();
  }
}

// Set up price tracking for a specific URL
async function setupPriceTracking(url, initialPrice) {
  try {
    // Get currently tracked prices from local storage
    const result = await browser.storage.local.get('trackedPrices');
    console.log('Successfully retrieved tracked prices from local storage');
    
    const trackedPrices = result.trackedPrices || [];
    
    // Check if we already have entries for this URL
    const existingEntries = trackedPrices.filter(entry => entry.url === url);
    
    if (existingEntries.length === 0) {
      // No existing entries, create a new one
      // Note: This function is called from the trackPrice flow, so we should have item info
      // For now, we'll create a basic entry and let the main tracking flow fill in details
      trackedPrices.push({
        date: new Date().toISOString().split('T')[0],
        name: 'Product', // This will be updated by the main tracking flow
        price: initialPrice,
        url: url,
        imageUrl: '',
        lastChecked: new Date().toISOString()
      });
      console.log(`Added new price tracking entry for ${url} with initial price ${initialPrice}`);
    } else {
      // Update the most recent entry's lastChecked
      updateLastChecked(trackedPrices, url, new Date().toISOString());
      console.log(`Updated lastChecked for existing entries of ${url}`);
    }
    
    // Save to local storage
    await browser.storage.local.set({ trackedPrices: trackedPrices });
    console.log(`Price tracking set up for ${url} with initial price ${initialPrice} (saved to local storage)`);
    
    // Make sure the alarm is set up
    const alarms = await browser.alarms.getAll();
    if (!alarms.some(a => a.name === PRICE_CHECK_ALARM_NAME)) {
      browser.alarms.create(PRICE_CHECK_ALARM_NAME, {
        periodInMinutes: 60 // Check once per hour
      }).catch(error => console.error('Error creating price check alarm:', error));
      console.log('Price check alarm created');
    }
  } catch (error) {
    console.error('Error setting up price tracking:', error);
  }
}

// Check prices for all tracked URLs
async function checkAllPrices() {
  try {
    console.log('Checking prices for all tracked items...');
    
    // Get tracked prices and settings from local storage
    const result = await browser.storage.local.get(['trackedPrices', 'priceAlarmEnabled', 'apiKey']);
    console.log('Successfully retrieved price tracking data from local storage');
    
    const trackedPrices = result.trackedPrices || [];
    const apiKey = result.apiKey;
    const priceAlarmEnabled = result.priceAlarmEnabled === true;
    
    // Check if price alarm is enabled
    if (!priceAlarmEnabled) {
      console.log('Price alarm is disabled, skipping price checks');
      return;
    }
    
    if (!apiKey) {
      console.warn('No API key found, cannot check prices');
      return;
    }
    
    // Get latest prices per URL for checking
    const latestPrices = getLatestPricePerUrl(trackedPrices);
    
    // Check each URL
    for (const [url, latestEntry] of Object.entries(latestPrices)) {
      try {
        console.log(`Checking price for ${url}`);
        
        // Fetch page content directly for background checks
        let pageContent = await fetchPageContentDirectly(url);
        
        // Get current price using the fetched content
        const currentData = await extractDataWithOpenAI(url, apiKey, pageContent);
        
        // Validate the returned data
        if (!currentData || !currentData.price) {
          console.error(`Invalid data returned for ${url}:`, currentData);
          // Update last checked time even if we couldn't get a valid price
          updateLastChecked(trackedPrices, url, new Date().toISOString());
          continue; // Skip to the next URL
        }
        
        const currentPrice = currentData.price;
        const oldPrice = latestEntry.price;
        
        // Update last checked time
        updateLastChecked(trackedPrices, url, new Date().toISOString());
        
        // Store price check in history (regardless of price change)
        await storePriceCheckHistory(url, currentData.name || 'Unknown Product', currentPrice);
        
        // Compare prices
        if (isPriceLower(currentPrice, oldPrice)) {
          console.log(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
          
          // Add new price entry to the array
          trackedPrices.push({
            date: new Date().toISOString().split('T')[0],
            name: currentData.name || latestEntry.name || 'Unknown Product',
            price: currentPrice,
            url: url,
            imageUrl: latestEntry.imageUrl || '',
            lastChecked: new Date().toISOString()
          });
          
          // Send notification
          await sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
          
          // Store notification in history
          await storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
        } else {
          console.log(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
        }
      } catch (error) {
        console.error(`Error checking price for ${url}:`, error);
        // If it's a 503 error, skip price tracking for this item
        if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
          console.log(`Skipping price tracking for ${url} due to 503 Service Unavailable error`);
          continue; // Skip to the next URL without updating lastChecked
        }
      }
    }
    
    // Save updated tracking data to local storage
    await browser.storage.local.set({ trackedPrices: trackedPrices });
    
  } catch (error) {
    console.error('Error checking prices:', error);
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
  
  console.log(`Comparing prices: ${oldNumeric} (old) vs ${currentNumeric} (current)`);
  
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
    console.error('Error sending notification:', error);
  }
}

// Handle notification click
function handleNotificationClick(notificationId) {
  browser.storage.local.get('lastNotificationUrl').then(result => {
    if (result.lastNotificationUrl) {
      browser.tabs.create({ url: result.lastNotificationUrl });
    }
  }).catch(console.error);
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
    console.error('Error storing notification history:', error);
  }
}

// Store all price checks in history (not just drops)
async function storePriceCheckHistory(url, productName, price) {
  try {
    // Get existing price check history from local storage
    const result = await browser.storage.local.get('priceCheckHistory');
    const history = result.priceCheckHistory || [];
    
    // Add new price check to history
    history.push({
      url: url,
      productName: productName,
      price: price,
      timestamp: new Date().toISOString()
    });
    
    // Keep only the most recent 100 price checks
    if (history.length > 100) {
      history.shift(); // Remove oldest check
    }
    
    // Save updated history to local storage
    await browser.storage.local.set({ 'priceCheckHistory': history });
    
  } catch (error) {
    console.error('Error storing price check history:', error);
  }
}

// Function to check all tracked items when price tracking is enabled
async function checkTrackedItemsOnEnable() {
  try {
    console.log('Checking all tracked items after enabling price tracking...');
    
    // Get tracked prices from local storage
    const result = await browser.storage.local.get(['trackedPrices']);
    console.log('Successfully retrieved tracked items from local storage for checking after enable');
    
    const trackedPrices = result.trackedPrices || [];
    
    if (trackedPrices.length === 0) {
      console.log('No tracked items found to check');
      return;
    }
    
    // Get unique URLs from the array
    const uniqueUrls = [...new Set(trackedPrices.map(entry => entry.url))];
    console.log(`Found ${uniqueUrls.length} unique tracked items to check after enabling price tracking`);
    
    // Mark all items for immediate checking by calling checkAllPrices
    setTimeout(() => checkAllPrices(), 3000);
  } catch (error) {
    console.error('Error checking tracked items on enable:', error);
  }
}

// Function to check all tracked items when the extension is refreshed
async function checkAllTrackedItemsOnRefresh() {
  try {
    console.log('Checking all tracked items after extension refresh...');
    
    // Get tracked prices from local storage
    const result = await browser.storage.local.get(['trackedPrices', 'trackedItems']);
    console.log('Successfully retrieved tracked items from local storage for refresh check');
    
    // Extract data from result
    let trackedPrices = result.trackedPrices || [];
    const oldTrackedItems = result.trackedItems || {};
    
    console.log(`Storage check - trackedPrices: ${trackedPrices.length} items, trackedItems: ${Object.keys(oldTrackedItems).length} items`);
    
    // Log the actual content for debugging
    console.log('trackedPrices content:', trackedPrices);
    console.log('trackedItems content:', oldTrackedItems);
    
    // If we have no items in the main storage but have items in the old storage,
    // migrate them first
    if (trackedPrices.length === 0 && Object.keys(oldTrackedItems).length > 0) {
      console.log('Found older tracked items during refresh, migrating to unified format');
      
      // Process items from oldTrackedItems
      for (const [url, item] of Object.entries(oldTrackedItems)) {
        console.log(`Migrating old tracked item for ${url} without price data`);
        trackedPrices.push({
          date: new Date().toISOString().split('T')[0],
          name: item.name || 'Unknown Product',
          price: '0.00', // Default price since we don't have price data
          url: url,
          imageUrl: item.imageUrl || '',
          lastChecked: new Date().toISOString()
        });
      }
      
      // Save the updated trackedPrices to local storage
      await browser.storage.local.set({ trackedPrices: trackedPrices });
      
      console.log('Migration complete during refresh, all old items saved to unified storage');
    }
    
    if (trackedPrices.length === 0) {
      console.log('No tracked items found to check after refresh (checked all storage locations)');
      return;
    }
    
    // Get unique URLs for counting
    const uniqueUrls = [...new Set(trackedPrices.map(entry => entry.url))];
    console.log(`Found ${uniqueUrls.length} unique tracked items to check after extension refresh`);
    
    // Check all items regardless of when they were last checked
    await checkItemsOnStartup(trackedPrices);
  } catch (error) {
    console.error('Error checking tracked items on extension refresh:', error);
  }
}

// Function to check items on startup, regardless of price tracking status
async function checkItemsOnStartup(trackedPrices) {
  try {
    console.log('Checking items on startup, regardless of price tracking status...');
    
    // Get API key from local storage
    const result = await browser.storage.local.get(['apiKey']);
    console.log('Successfully retrieved API key from local storage for startup check');

    const apiKey = result.apiKey;
    
    if (!apiKey) {
      console.warn('No API key found, cannot check prices on startup');
      return;
    }
    
    // Get latest prices per URL for checking
    const latestPrices = getLatestPricePerUrl(trackedPrices);
    
    // Check each URL
    for (const [url, latestEntry] of Object.entries(latestPrices)) {
      try {
        console.log(`Checking price for ${url} on startup`);
        
        // Fetch page content directly for background checks
        let pageContent = await fetchPageContentDirectly(url);
        
        // Get current price using the fetched content
        const currentData = await extractDataWithOpenAI(url, apiKey, pageContent);
        
        // Validate the returned data
        if (!currentData || !currentData.price) {
          console.error(`Invalid data returned for ${url}:`, currentData);
          // Update last checked time even if we couldn't get a valid price
          updateLastChecked(trackedPrices, url, new Date().toISOString());
          continue; // Skip to the next URL
        }
        
        const currentPrice = currentData.price;
        const oldPrice = latestEntry.price;
        
        // Update last checked time
        updateLastChecked(trackedPrices, url, new Date().toISOString());
        
        // Store price check in history (regardless of price change)
        await storePriceCheckHistory(url, currentData.name || 'Unknown Product', currentPrice);
        
        // Compare prices
        if (isPriceLower(currentPrice, oldPrice)) {
          console.log(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
          
          // Add new price entry to the array
          trackedPrices.push({
            date: new Date().toISOString().split('T')[0],
            name: currentData.name || latestEntry.name || 'Unknown Product',
            price: currentPrice,
            url: url,
            imageUrl: latestEntry.imageUrl || '',
            lastChecked: new Date().toISOString()
          });
          
          // Send notification
          await sendPriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
          
          // Store notification in history
          await storePriceDropNotification(url, currentData.name || latestEntry.name, oldPrice, currentPrice);
        } else {
          console.log(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
        }
      } catch (error) {
        console.error(`Error checking price for ${url} on startup:`, error);
        // If it's a 503 error, skip price tracking for this item
        if (error.message && error.message.includes('503_SERVICE_UNAVAILABLE')) {
          console.log(`Skipping price tracking for ${url} due to 503 Service Unavailable error`);
          continue; // Skip to the next URL without updating lastChecked
        }
      }
    }
    
    // Save updated tracking data to local storage
    await browser.storage.local.set({ trackedPrices: trackedPrices });
    console.log('Updated tracking data saved to local storage after startup check');
    
  } catch (error) {
    console.error('Error checking prices on startup:', error);
  }
}

// Function to fetch page content directly for background checks
async function fetchPageContentDirectly(url) {
  try {
    console.log(`Fetching page content directly for ${url}`);
    
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
    console.error(`Error fetching page content for ${url}:`, error);
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
