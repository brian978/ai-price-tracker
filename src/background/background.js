// Import required classes and dependencies
// Note: These imports would need to be added to manifest.json as script tags

// Create global instances
const dataManager = new PriceDataManager();
// Note: logger is already created globally in Logger.js
const viewModeManager = new ViewModeManager(logger);
const notificationManager = new NotificationManager(logger);
const priceTracker = new BackgroundPriceTracker(dataManager, logger, notificationManager);
const priceCheckScheduler = new PriceCheckScheduler(dataManager, logger);

// Set up the relationship between scheduler and price tracker
priceCheckScheduler.setPriceTracker(priceTracker);

// Listen for extension icon clicks (only called when the popup is disabled)
browser.browserAction.onClicked.addListener((tab, info) => {
  viewModeManager.handleBrowserActionClick();
});

// Listen for storage changes to update view mode and price alarm settings
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' || areaName === 'sync') {
    await logger.log(`Storage changes detected in ${areaName} storage:`, changes);
    
    // Handle view mode changes
    if (changes.viewMode) {
      await viewModeManager.handleViewModeChange(changes.viewMode.newValue);
    }
    
    // Handle price alarm setting changes
    if (changes.priceAlarmEnabled !== undefined) {
      const priceAlarmEnabled = changes.priceAlarmEnabled.newValue === true;
      
      if (priceAlarmEnabled) {
        // Enable scheduled checks
        await priceCheckScheduler.enableScheduledChecks();
        await logger.log('Price tracking alarm enabled via settings change');
        
        // Trigger immediate check for all tracked items when price tracking is enabled
        // This ensures items tracked before enabling price tracking are checked
        setTimeout(() => priceCheckScheduler.checkTrackedItemsOnEnable(), 2000);
      } else {
        // Disable scheduled checks
        await priceCheckScheduler.disableScheduledChecks();
        await logger.log('Price tracking alarm disabled via settings change');
      }
    }
    
    // Handle check interval changes
    if (changes.checkInterval !== undefined) {
      const result = await browser.storage.local.get(['priceAlarmEnabled']);
      const priceAlarmEnabled = result.priceAlarmEnabled === true;
      
      if (priceAlarmEnabled) {
        // Restart the alarm with the new interval
        await priceCheckScheduler.disableScheduledChecks();
        await priceCheckScheduler.enableScheduledChecks();
        await logger.log(`Check interval updated to ${changes.checkInterval.newValue} minutes`);
      }
    }
  }
});

browser.runtime.onInstalled.addListener((details) => {
  // Initialize view mode
  viewModeManager.initializeViewMode();
  
  // Initialize price tracking scheduler
  priceCheckScheduler.initialize();
  
  // When the extension is refreshed/updated, check all tracked items immediately
  if (details.reason === 'update' || details.reason === 'install') {
    logger.logSync('Extension was refreshed/updated, checking all tracked items immediately');
    setTimeout(() => priceCheckScheduler.checkAllTrackedItemsOnRefresh(), 3000);
  }
});

browser.runtime.onStartup.addListener(() => {
  // Initialize view mode
  viewModeManager.initializeViewMode();
  
  // Initialize price tracking scheduler
  priceCheckScheduler.initialize();
});

// Listen for messages from the popup/sidebar
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'trackPrice') {
    priceTracker.trackPrice(message.url, message.apiKey)
      .then(result => {
        // After tracking the price, set up periodic checking for this URL
        priceTracker.setupPriceTracking(message.url, result.price, result.name, result.imageUrl);
        sendResponse(result);
      })
      .catch(error => sendResponse({ error: error.message }));

    // Return true to indicate we will send a response asynchronously
    return true;
  }
});