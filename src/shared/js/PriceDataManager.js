/**
 * Unified Price Data Manager
 * Handles all price-related data storage and retrieval operations
 * Used by both PriceTracker and background.js to ensure data consistency
 */
class PriceDataManager {
  constructor() {
    this.storageKeys = {
      TRACKED_PRICES: 'trackedPrices',
      TRACKED_ITEMS: 'trackedItems',
      PRICE_DROP_HISTORY: 'priceDropHistory',
      LAST_NOTIFICATION_URL: 'lastNotificationUrl',
      API_KEY: 'apiKey',
      PRICE_ALARM_ENABLED: 'priceAlarmEnabled',
      VIEW_MODE: 'viewMode'
    };
  }

  /**
   * Validate and normalize a tracked price item structure
   * @param {Object} item - The item to validate
   * @returns {Object} Normalized item with correct structure
   */
  _validateTrackedPriceItem(item) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid tracked price item: must be an object');
    }

    if (!item.url || typeof item.url !== 'string') {
      throw new Error('Invalid tracked price item: url is required and must be a string');
    }

    // Ensure required structure
    const normalizedItem = {
      url: item.url,
      name: item.name || 'Unknown Product',
      imageUrl: item.imageUrl || '',
      lastChecked: item.lastChecked || new Date().toISOString(),
      history: Array.isArray(item.history) ? item.history : []
    };

    // Validate history entries
    normalizedItem.history = normalizedItem.history.map(historyEntry => {
      if (!historyEntry || typeof historyEntry !== 'object') {
        throw new Error('Invalid history entry: must be an object');
      }
      
      return {
        price: historyEntry.price || '0.00',
        date: historyEntry.date || new Date().toISOString().split('T')[0],
        timestamp: historyEntry.timestamp || new Date().toISOString()
      };
    });

    return normalizedItem;
  }

  /**
   * Validate and normalize an array of tracked price items
   * @param {Array} trackedPrices - Array of tracked price items
   * @returns {Array} Normalized array with correct structure
   */
  _validateTrackedPricesArray(trackedPrices) {
    if (!Array.isArray(trackedPrices)) {
      console.warn('Invalid tracked prices: expected array, got', typeof trackedPrices);
      return [];
    }

    return trackedPrices.map(item => {
      try {
        return this._validateTrackedPriceItem(item);
      } catch (error) {
        console.error('Skipping invalid tracked price item:', error.message, item);
        return null;
      }
    }).filter(item => item !== null);
  }

  /**
   * Create a new tracked price item with enforced structure
   * @param {string} url - Product URL
   * @param {string} productName - Product name
   * @param {string} imageUrl - Product image URL (optional)
   * @param {Array} history - Price history array (optional)
   * @returns {Object} Structured tracked price item
   */
  createTrackedPriceItem(url, productName, imageUrl = '', history = []) {
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required and must be a string');
    }

    const item = {
      url: url,
      name: productName || 'Unknown Product',
      imageUrl: imageUrl || '',
      lastChecked: new Date().toISOString(),
      history: Array.isArray(history) ? history : []
    };

    return this._validateTrackedPriceItem(item);
  }

  /**
   * Create a new price history entry with enforced structure
   * @param {number|string} price - The price
   * @param {string} date - Date string (optional, defaults to today)
   * @param {string} timestamp - ISO timestamp (optional, defaults to now)
   * @returns {Object} Structured price history entry
   */
  createPriceHistoryEntry(price, date = null, timestamp = null) {
    return {
      price: price || '0.00',
      date: date || new Date().toISOString().split('T')[0],
      timestamp: timestamp || new Date().toISOString()
    };
  }

  /**
   * Get tracked prices from storage
   * @returns {Promise<Array>} Array of tracked price items
   */
  async getTrackedPrices() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.TRACKED_PRICES]);
      const rawData = result[this.storageKeys.TRACKED_PRICES] || [];
      return this._validateTrackedPricesArray(rawData);
    } catch (error) {
      console.error('Error getting tracked prices:', error);
      return [];
    }
  }

  /**
   * Save tracked prices to storage
   * @param {Array} trackedPrices - Array of tracked price items
   * @returns {Promise<boolean>} Success status
   */
  async saveTrackedPrices(trackedPrices) {
    try {
      const validatedData = this._validateTrackedPricesArray(trackedPrices);
      await browser.storage.local.set({ [this.storageKeys.TRACKED_PRICES]: validatedData });
      return true;
    } catch (error) {
      console.error('Error saving tracked prices:', error);
      return false;
    }
  }

  /**
   * Get tracked items from storage
   * @returns {Promise<Object>} Object containing tracked items
   */
  async getTrackedItems() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.TRACKED_ITEMS]);
      return result[this.storageKeys.TRACKED_ITEMS] || {};
    } catch (error) {
      console.error('Error getting tracked items:', error);
      return {};
    }
  }

  /**
   * Save tracked items to storage
   * @param {Object} trackedItems - Object containing tracked items
   * @returns {Promise<boolean>} Success status
   */
  async saveTrackedItems(trackedItems) {
    try {
      await browser.storage.local.set({ [this.storageKeys.TRACKED_ITEMS]: trackedItems });
      return true;
    } catch (error) {
      console.error('Error saving tracked items:', error);
      return false;
    }
  }

  /**
   * Get both tracked prices and items
   * @returns {Promise<Object>} Object with trackedPrices and trackedItems
   */
  async getAllTrackedData() {
    try {
      const result = await browser.storage.local.get([
        this.storageKeys.TRACKED_PRICES,
        this.storageKeys.TRACKED_ITEMS
      ]);
      return {
        trackedPrices: result[this.storageKeys.TRACKED_PRICES] || [],
        trackedItems: result[this.storageKeys.TRACKED_ITEMS] || {}
      };
    } catch (error) {
      console.error('Error getting all tracked data:', error);
      return {
        trackedPrices: [],
        trackedItems: {}
      };
    }
  }

  /**
   * Save both tracked prices and items
   * @param {Array} trackedPrices - Array of tracked price items
   * @param {Object} trackedItems - Object containing tracked items
   * @returns {Promise<boolean>} Success status
   */
  async saveAllTrackedData(trackedPrices, trackedItems) {
    try {
      const validatedPrices = this._validateTrackedPricesArray(trackedPrices);
      await browser.storage.local.set({
        [this.storageKeys.TRACKED_PRICES]: validatedPrices,
        [this.storageKeys.TRACKED_ITEMS]: trackedItems || {}
      });
      return true;
    } catch (error) {
      console.error('Error saving all tracked data:', error);
      return false;
    }
  }

  /**
   * Find or create a tracked item for a given URL
   * @param {string} url - The URL to find/create item for
   * @param {string} productName - Product name (for new items)
   * @param {string} imageUrl - Product image URL (optional)
   * @returns {Promise<Object>} The tracked item
   */
  async findOrCreateTrackedItem(url, productName, imageUrl = '') {
    try {
      const trackedPrices = await this.getTrackedPrices();
      let trackedItem = trackedPrices.find(item => item.url === url);
      
      if (!trackedItem) {
        // Create new tracked item
        trackedItem = {
          url: url,
          name: productName,
          imageUrl: imageUrl,
          lastChecked: new Date().toISOString(),
          history: []
        };
        trackedPrices.push(trackedItem);
        await this.saveTrackedPrices(trackedPrices);
      } else {
        // Update existing item
        trackedItem.name = productName || trackedItem.name;
        trackedItem.lastChecked = new Date().toISOString();
        if (imageUrl) {
          trackedItem.imageUrl = imageUrl;
        }
        await this.saveTrackedPrices(trackedPrices);
      }
      
      return trackedItem;
    } catch (error) {
      console.error('Error finding/creating tracked item:', error);
      return null;
    }
  }

  /**
   * Add price to tracked item history (only if price is different)
   * @param {string} url - The URL of the item
   * @param {string} productName - Product name
   * @param {number} price - The price to add
   * @param {string} imageUrl - Product image URL (optional)
   * @returns {Promise<boolean>} Success status
   */
  async addPriceToHistory(url, productName, price, imageUrl = '') {
    try {
      const trackedPrices = await this.getTrackedPrices();
      let trackedItem = trackedPrices.find(item => item.url === url);
      
      if (!trackedItem) {
        // Create new tracked item using structure creation method
        trackedItem = this.createTrackedPriceItem(url, productName, imageUrl);
        trackedPrices.push(trackedItem);
      } else {
        // Update existing item
        trackedItem.name = productName || trackedItem.name;
        trackedItem.lastChecked = new Date().toISOString();
        if (imageUrl) {
          trackedItem.imageUrl = imageUrl;
        }
      }
      
      // Check if price is different from the last recorded price
      const lastHistoryEntry = trackedItem.history[trackedItem.history.length - 1];
      if (!lastHistoryEntry || lastHistoryEntry.price !== price) {
        // Add new price to history using structure creation method
        const newHistoryEntry = this.createPriceHistoryEntry(price);
        trackedItem.history.push(newHistoryEntry);
        
        // Keep only the most recent 50 price entries per item
        if (trackedItem.history.length > 50) {
          trackedItem.history.shift(); // Remove oldest entry
        }
      }
      
      await this.saveTrackedPrices(trackedPrices);
      return true;
    } catch (error) {
      console.error('Error adding price to history:', error);
      return false;
    }
  }

  /**
   * Get price drop history
   * @returns {Promise<Array>} Array of price drop notifications
   */
  async getPriceDropHistory() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.PRICE_DROP_HISTORY]);
      return result[this.storageKeys.PRICE_DROP_HISTORY] || [];
    } catch (error) {
      console.error('Error getting price drop history:', error);
      return [];
    }
  }

  /**
   * Save price drop history
   * @param {Array} history - Array of price drop notifications
   * @returns {Promise<boolean>} Success status
   */
  async savePriceDropHistory(history) {
    try {
      await browser.storage.local.set({ [this.storageKeys.PRICE_DROP_HISTORY]: history });
      return true;
    } catch (error) {
      console.error('Error saving price drop history:', error);
      return false;
    }
  }

  /**
   * Add notification to price drop history
   * @param {string} url - Product URL
   * @param {string} productName - Product name
   * @param {number} oldPrice - Previous price
   * @param {number} newPrice - New price
   * @param {string} imageUrl - Product image URL (optional)
   * @returns {Promise<boolean>} Success status
   */
  async addNotificationToHistory(url, productName, oldPrice, newPrice, imageUrl = '') {
    try {
      const history = await this.getPriceDropHistory();
      
      history.push({
        url: url,
        productName: productName,
        oldPrice: oldPrice,
        newPrice: newPrice,
        imageUrl: imageUrl,
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0]
      });
      
      // Keep only the most recent 100 notifications
      if (history.length > 100) {
        history.shift(); // Remove oldest entry
      }
      
      await this.savePriceDropHistory(history);
      return true;
    } catch (error) {
      console.error('Error adding notification to history:', error);
      return false;
    }
  }

  /**
   * Get last notification URL
   * @returns {Promise<string|null>} Last notification URL or null
   */
  async getLastNotificationUrl() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.LAST_NOTIFICATION_URL]);
      return result[this.storageKeys.LAST_NOTIFICATION_URL] || null;
    } catch (error) {
      console.error('Error getting last notification URL:', error);
      return null;
    }
  }

  /**
   * Save last notification URL
   * @param {string} url - The URL to save
   * @returns {Promise<boolean>} Success status
   */
  async saveLastNotificationUrl(url) {
    try {
      await browser.storage.local.set({ [this.storageKeys.LAST_NOTIFICATION_URL]: url });
      return true;
    } catch (error) {
      console.error('Error saving last notification URL:', error);
      return false;
    }
  }

  /**
   * Get API key
   * @returns {Promise<string|null>} API key or null
   */
  async getApiKey() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.API_KEY]);
      return result[this.storageKeys.API_KEY] || null;
    } catch (error) {
      console.error('Error getting API key:', error);
      return null;
    }
  }

  /**
   * Get price alarm enabled status
   * @returns {Promise<boolean>} Price alarm enabled status
   */
  async getPriceAlarmEnabled() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.PRICE_ALARM_ENABLED]);
      return result[this.storageKeys.PRICE_ALARM_ENABLED] || false;
    } catch (error) {
      console.error('Error getting price alarm enabled status:', error);
      return false;
    }
  }

  /**
   * Get view mode
   * @returns {Promise<string>} View mode
   */
  async getViewMode() {
    try {
      const result = await browser.storage.local.get([this.storageKeys.VIEW_MODE]);
      return result[this.storageKeys.VIEW_MODE] || 'popup';
    } catch (error) {
      console.error('Error getting view mode:', error);
      return 'popup';
    }
  }

  /**
   * Remove tracked item by URL
   * @param {string} url - URL of the item to remove
   * @returns {Promise<boolean>} Success status
   */
  async removeTrackedItem(url) {
    try {
      const data = await this.getAllTrackedData();
      
      // Remove from trackedPrices
      data.trackedPrices = data.trackedPrices.filter(item => item.url !== url);
      
      // Remove from trackedItems
      delete data.trackedItems[url];
      
      await this.saveAllTrackedData(data.trackedPrices, data.trackedItems);
      return true;
    } catch (error) {
      console.error('Error removing tracked item:', error);
      return false;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PriceDataManager;
} else if (typeof window !== 'undefined') {
  window.PriceDataManager = PriceDataManager;
}