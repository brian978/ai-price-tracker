/**
 * PriceCheckScheduler - A specialized class for scheduling and managing price checks
 * Available in both background.js and options.js
 */
class PriceCheckScheduler {
  constructor(dataManager, logger) {
    this.dataManager = dataManager;
    this.logger = logger;
    this.PRICE_CHECK_ALARM_NAME = 'priceCheckAlarm';
    this.checkInterval = null;
    this.lastCheckTime = null;
  }

  /**
   * Initialize the price checking scheduler
   */
  async initialize() {
    try {
      // Check if the price alarm is enabled and get tracked prices from local storage
      const result = await browser.storage.local.get(['priceAlarmEnabled', 'trackedPrices']);
      this.logger.logSync('Successfully retrieved data from local storage');
      
      const priceAlarmEnabled = result.priceAlarmEnabled === true;
      let trackedPrices = result.trackedPrices || [];
      
      this.logger.logSync('Storage data retrieved:', {
        priceAlarmEnabled,
        trackedPricesCount: trackedPrices.length
      });
      
      // Ensure all entries have the lastChecked field (for entries that might not have it)
      for (const entry of trackedPrices) {
        if (!entry.lastChecked) {
          entry.lastChecked = new Date().toISOString();
        }
      }
      
      // Save the updated trackedPrices using data manager
      await this.dataManager.saveTrackedPrices(trackedPrices);
      
      // BROWSER RESTART HANDLING:
      // Since browser alarms don't run when the browser is closed, we need to check
      // if any products should have been checked while the browser was closed.
      // This ensures that even if a user opens their browser for short periods,
      // price checks will still happen at roughly hourly intervals.
      const urlsNeedingCheck = this.getUrlsNeedingCheck(trackedPrices, 1);
      
      if (urlsNeedingCheck.length > 0) {
        this.logger.logSync(`Found ${urlsNeedingCheck.length} products that need checking:`, urlsNeedingCheck);
        this.logger.logSync('Some products need to be checked (never checked or not checked in over an hour), performing immediate check');
        // Use setTimeout to allow the extension to fully initialize first
        setTimeout(() => this.checkItemsOnStartup(trackedPrices), 5000);
      }
      
      // Set up the alarm for hourly price checks only if enabled
      if (priceAlarmEnabled) {
        await this.enableScheduledChecks();
      } else {
        await this.disableScheduledChecks();
      }
      
      // Listen for alarm events
      if (typeof browser !== 'undefined' && browser.alarms) {
        browser.alarms.onAlarm.addListener((alarm) => this.handleAlarm(alarm));
      }
      
      this.logger.logSync('Price checking scheduler initialized');
    } catch (error) {
      this.logger.errorSync('Error initializing price checking scheduler:', error);
    }
  }

  /**
   * Enable scheduled price checks
   */
  async enableScheduledChecks() {
    try {
      // Get the check interval from storage, default to 60 minutes if not set
      const result = await browser.storage.local.get(['checkInterval']);
      const checkInterval = result.checkInterval || 60;
      
      await browser.alarms.create(this.PRICE_CHECK_ALARM_NAME, {
        periodInMinutes: checkInterval
      });
      this.logger.logSync(`Price tracking alarm created - automatic checking enabled with ${checkInterval} minute interval`);
    } catch (error) {
      this.logger.errorSync('Error creating price check alarm:', error);
    }
  }

  /**
   * Disable scheduled price checks
   */
  async disableScheduledChecks() {
    try {
      await browser.alarms.clear(this.PRICE_CHECK_ALARM_NAME);
      this.logger.logSync('Price tracking alarm disabled - automatic checking disabled');
    } catch (error) {
      this.logger.errorSync('Error clearing price check alarm:', error);
    }
  }

  /**
   * Handle alarm events
   */
  async handleAlarm(alarm) {
    if (alarm.name === this.PRICE_CHECK_ALARM_NAME) {
      await this.runScheduledCheck();
    }
  }

  /**
   * Set the price tracker instance for delegation
   */
  setPriceTracker(priceTracker) {
    this.priceTracker = priceTracker;
  }

  /**
   * Run a scheduled price check (called by alarm)
   */
  async runScheduledCheck() {
    this.logger.logSync('Scheduled price check triggered');
    this.lastCheckTime = new Date();
    
    // Delegate to price tracker if available
    if (this.priceTracker) {
      await this.priceTracker.checkAllPrices();
    }
  }

  /**
   * Trigger immediate check for all tracked items when price tracking is enabled
   */
  async checkTrackedItemsOnEnable() {
    try {
      this.logger.logSync('Checking all tracked items after enabling price tracking...');
      
      // Get tracked prices from data manager
      const trackedPrices = await this.dataManager.getTrackedPrices();
      this.logger.logSync('Successfully retrieved tracked items from data manager for checking after enable');
      
      if (trackedPrices.length === 0) {
        this.logger.logSync('No tracked items found to check');
        return;
      }
      
      // Get unique URLs from the array
      const uniqueUrls = [...new Set(trackedPrices.map(entry => entry.url))];
      this.logger.logSync(`Found ${uniqueUrls.length} unique tracked items to check after enabling price tracking`);
      
      // Mark all items for immediate checking by calling runScheduledCheck
      setTimeout(() => this.runScheduledCheck(), 3000);
    } catch (error) {
      this.logger.errorSync('Error checking tracked items on enable:', error);
    }
  }

  /**
   * Check all tracked items when the extension is installed, updated, or reloaded
   */
  async checkAllTrackedItemsOnRefresh() {
    try {
      this.logger.logSync('Checking all tracked items after extension refresh...');
      
      // Get tracked data from data manager
      const data = await this.dataManager.getAllTrackedData();
      this.logger.logSync('Successfully retrieved tracked items from data manager for refresh check');
      
      // Extract data from result
      let trackedPrices = data.trackedPrices || [];
      const oldTrackedItems = data.trackedItems || {};
      
      this.logger.logSync(`Storage check - trackedPrices: ${trackedPrices.length} items, trackedItems: ${Object.keys(oldTrackedItems).length} items`);
      
      // Log the actual content for debugging
      this.logger.logSync('trackedPrices content:', trackedPrices);
      this.logger.logSync('trackedItems content:', oldTrackedItems);
      
      // If we have no items in the main storage but have items in the old storage,
      // migrate them first
      if (trackedPrices.length === 0 && Object.keys(oldTrackedItems).length > 0) {
        this.logger.logSync('Found older tracked items during refresh, migrating to unified format');
        
        // Process items from oldTrackedItems
        for (const [url, item] of Object.entries(oldTrackedItems)) {
          this.logger.logSync(`Migrating old tracked item for ${url} without price data`);
          // Create tracked item using data manager structure control
          const migratedItem = this.dataManager.createTrackedPriceItem(
            url, 
            item.name || 'Unknown Product', 
            item.imageUrl || ''
          );
          // Add default price history entry since we don't have price data
          const defaultHistoryEntry = this.dataManager.createPriceHistoryEntry('0.00');
          migratedItem.history.push(defaultHistoryEntry);
          
          trackedPrices.push(migratedItem);
        }
        
        // Save the updated trackedPrices using data manager
        await this.dataManager.saveTrackedPrices(trackedPrices);
        
        this.logger.logSync('Migration complete during refresh, all old items saved to unified storage');
      }
      
      if (trackedPrices.length === 0) {
        this.logger.logSync('No tracked items found to check after refresh (checked all storage locations)');
        return;
      }
      
      // Get unique URLs for counting
      const uniqueUrls = [...new Set(trackedPrices.map(entry => entry.url))];
      this.logger.logSync(`Found ${uniqueUrls.length} unique tracked items to check after extension refresh`);
      
      // Check all items regardless of when they were last checked
      await this.checkItemsOnStartup(trackedPrices);
    } catch (error) {
      this.logger.errorSync('Error checking tracked items on extension refresh:', error);
    }
  }

  /**
   * Check items on startup, regardless of price tracking status
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
      
      // Delegate to price tracker if available
      if (this.priceTracker) {
        await this.priceTracker.checkItemsOnStartup(trackedPrices);
      }
      
      this.lastCheckTime = new Date();
    } catch (error) {
      this.logger.errorSync('Error checking prices on startup:', error);
    }
  }

  /**
   * Get URLs that need checking based on time threshold
   */
  getUrlsNeedingCheck(trackedPrices, hoursThreshold = 1) {
    const latestPrices = this.getLatestPricePerUrl(trackedPrices);
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
   * Get the last check time across all tracked items
   */
  async getLastCheckTime() {
    try {
      const trackedPrices = await this.dataManager.getTrackedPrices();
      
      if (trackedPrices.length === 0) {
        return null;
      }
      
      // Find the most recent lastChecked timestamp across all tracked items
      const lastCheckedTimes = trackedPrices
        .map(item => item.lastChecked)
        .filter(time => time)
        .map(time => new Date(time))
        .sort((a, b) => b - a);
      
      return lastCheckedTimes.length > 0 ? lastCheckedTimes[0] : null;
    } catch (error) {
      this.logger.errorSync('Error getting last check time:', error);
      return null;
    }
  }

  /**
   * Get the next scheduled check time
   */
  async getNextCheckTime() {
    try {
      const result = await browser.storage.local.get(['priceAlarmEnabled']);
      const priceAlarmEnabled = result.priceAlarmEnabled === true;
      
      if (!priceAlarmEnabled) {
        return null;
      }
      
      const alarms = await browser.alarms.getAll();
      const priceAlarm = alarms.find(alarm => alarm.name === this.PRICE_CHECK_ALARM_NAME);
      
      if (priceAlarm && priceAlarm.scheduledTime) {
        return new Date(priceAlarm.scheduledTime);
      }
      
      return null;
    } catch (error) {
      this.logger.errorSync('Error getting next check time:', error);
      return null;
    }
  }

  /**
   * Check if price tracking is currently enabled
   */
  async isPriceTrackingEnabled() {
    try {
      const result = await browser.storage.local.get(['priceAlarmEnabled']);
      return result.priceAlarmEnabled === true;
    } catch (error) {
      this.logger.errorSync('Error checking if price tracking is enabled:', error);
      return false;
    }
  }
}