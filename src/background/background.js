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
  if (areaName === 'local') {
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
      } else {
        // Clear the alarm if it was disabled
        await browser.alarms.clear(PRICE_CHECK_ALARM_NAME);
        console.log('Price tracking alarm disabled via settings change');
      }
    }
  }
});

browser.runtime.onInstalled.addListener(() => {
  // noinspection JSIgnoredPromiseFromCall
  initializeViewMode();
  
  // Initialize price tracking on installation
  initializePriceTracking();
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
    const pageContent = await getPageContent();

    // Extract information using OpenAI API
    const extractedData = await extractDataWithOpenAI(url, apiKey, pageContent);

    return extractedData;
  } catch (error) {
    console.error('Error in trackPrice:', error);
    throw new Error('Failed to track price: ' + error.message);
  }
}

// Function to get the content of the current page
async function getPageContent() {
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
          url: window.location.href
        });
      `
    });

    return results[0];
  } catch (error) {
    console.error('Error getting page content:', error);
    throw new Error('Could not access page content. Make sure you are on a product page.');
  }
}

// Function to extract data using OpenAI API
async function extractDataWithOpenAI(url, apiKey, pageContent) {
  try {
    // Prepare the prompt for OpenAI
    const prompt = `
          You are analyzing a product page at this URL: ${url}

          Page Title: ${pageContent.title}

          Page Content (first half of body):
          ${pageContent.bodyContent}

          Please extract the following information from the page content above:
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
const TRACKED_PRICES_STORAGE_KEY = 'trackedPricesForAlarm';

// Initialize the price tracking system
async function initializePriceTracking() {
  try {
    // Check if price alarm is enabled and get tracked prices
    const result = await browser.storage.local.get(['priceAlarmEnabled', TRACKED_PRICES_STORAGE_KEY]);
    const priceAlarmEnabled = result.priceAlarmEnabled === true;
    const trackedPrices = result[TRACKED_PRICES_STORAGE_KEY] || {};
    
    // Set up the alarm for hourly price checks only if enabled
    if (priceAlarmEnabled) {
      browser.alarms.create(PRICE_CHECK_ALARM_NAME, {
        periodInMinutes: 60 // Check once per hour
      }).catch(error => console.error('Error creating price check alarm:', error));
      console.log('Price tracking alarm created - automatic checking enabled');
      
      // BROWSER RESTART HANDLING:
      // Since browser alarms don't run when the browser is closed, we need to check
      // if any products should have been checked while the browser was closed.
      // This ensures that even if a user opens their browser for short periods,
      // price checks will still happen at roughly hourly intervals.
      const now = new Date();
      let needsImmediateCheck = false;
      
      // Check if any product hasn't been checked in the last hour
      for (const [url, data] of Object.entries(trackedPrices)) {
        if (data.lastChecked) {
          const lastChecked = new Date(data.lastChecked);
          const hoursSinceLastCheck = (now - lastChecked) / (1000 * 60 * 60);
          
          if (hoursSinceLastCheck >= 1) {
            console.log(`Product ${url} hasn't been checked in ${hoursSinceLastCheck.toFixed(2)} hours`);
            needsImmediateCheck = true;
            break; // One product needing a check is enough to trigger
          }
        }
      }
      
      // If any product needs a check, do it immediately instead of waiting for the next alarm
      if (needsImmediateCheck && Object.keys(trackedPrices).length > 0) {
        console.log('Some products have not been checked in over an hour, performing immediate check');
        // Use setTimeout to allow the extension to fully initialize first
        setTimeout(() => checkAllPrices(), 5000);
      }
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
    // Get currently tracked prices
    const result = await browser.storage.local.get(TRACKED_PRICES_STORAGE_KEY);
    const trackedPrices = result[TRACKED_PRICES_STORAGE_KEY] || {};
    
    // Add or update the URL with its price
    trackedPrices[url] = {
      price: initialPrice,
      lastChecked: new Date().toISOString()
    };
    
    // Save back to storage
    await browser.storage.local.set({ [TRACKED_PRICES_STORAGE_KEY]: trackedPrices });
    
    console.log(`Price tracking set up for ${url} with initial price ${initialPrice}`);
    
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
    
    // Get tracked prices and settings
    const result = await browser.storage.local.get([TRACKED_PRICES_STORAGE_KEY, 'apiKey', 'priceAlarmEnabled']);
    const trackedPrices = result[TRACKED_PRICES_STORAGE_KEY] || {};
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
    
    // Check each URL
    for (const [url, data] of Object.entries(trackedPrices)) {
      try {
        console.log(`Checking price for ${url}`);
        
        // Get current price
        const currentData = await trackPrice(url, apiKey);
        const currentPrice = currentData.price;
        const oldPrice = data.price;
        
        // Update last checked time
        trackedPrices[url].lastChecked = new Date().toISOString();
        
        // Store price check in history (regardless of price change)
        await storePriceCheckHistory(url, currentData.name, currentPrice);
        
        // Compare prices
        if (isPriceLower(currentPrice, oldPrice)) {
          console.log(`Price dropped for ${url} from ${oldPrice} to ${currentPrice}`);
          
          // Update stored price
          trackedPrices[url].price = currentPrice;
          
          // Send notification
          await sendPriceDropNotification(url, currentData.name, oldPrice, currentPrice);
          
          // Store notification in history
          await storePriceDropNotification(url, currentData.name, oldPrice, currentPrice);
        } else {
          console.log(`No price drop for ${url}, old: ${oldPrice}, current: ${currentPrice}`);
        }
      } catch (error) {
        console.error(`Error checking price for ${url}:`, error);
      }
    }
    
    // Save updated tracking data
    await browser.storage.local.set({ [TRACKED_PRICES_STORAGE_KEY]: trackedPrices });
    
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
    
    // Store the URL for this notification
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
    // Get existing notification history
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
    
    // Save updated history
    await browser.storage.local.set({ 'priceDropHistory': history });
    
  } catch (error) {
    console.error('Error storing notification history:', error);
  }
}

// Store all price checks in history (not just drops)
async function storePriceCheckHistory(url, productName, price) {
  try {
    // Get existing price check history
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
    
    // Save updated history
    await browser.storage.local.set({ 'priceCheckHistory': history });
    
  } catch (error) {
    console.error('Error storing price check history:', error);
  }
}
