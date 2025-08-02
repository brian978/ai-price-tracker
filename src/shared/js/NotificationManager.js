/**
 * NotificationManager - Handles browser notifications for price drops
 */
class NotificationManager {
  constructor(logger) {
    this.logger = logger;
    this.isClickHandlerSetup = false;
  }

  /**
   * Send browser notification for price drop
   */
  async sendPriceDropNotification(url, productName, oldPrice, newPrice) {
    try {
      await browser.notifications.create({
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-96.png'),
        title: 'Price Drop Alert!',
        message: `${productName} price dropped from ${oldPrice} to ${newPrice}!`,
        contextMessage: 'Click to open product page'
      });
      
      // Set up notification click handler if not already set
      if (!this.isClickHandlerSetup) {
        browser.notifications.onClicked.addListener((notificationId) => this.handleNotificationClick(notificationId));
        this.isClickHandlerSetup = true;
      }
      
      // Store the URL for this notification in local storage
      await browser.storage.local.set({ 'lastNotificationUrl': url });
      
    } catch (error) {
      this.logger.errorSync('Error sending notification:', error);
    }
  }

  /**
   * Handle notification click
   */
  async handleNotificationClick(notificationId) {
    try {
      const result = await browser.storage.local.get('lastNotificationUrl');
      if (result.lastNotificationUrl) {
        await browser.tabs.create({ url: result.lastNotificationUrl });
      }
    } catch (error) {
      this.logger.errorSync('Error handling notification click:', error);
    }
  }

  /**
   * Store price drop notification in history
   */
  async storePriceDropNotification(url, productName, oldPrice, newPrice) {
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
      this.logger.errorSync('Error storing notification history:', error);
    }
  }

  /**
   * Get price drop notification history
   */
  async getPriceDropHistory() {
    try {
      const result = await browser.storage.local.get('priceDropHistory');
      return result.priceDropHistory || [];
    } catch (error) {
      this.logger.errorSync('Error getting price drop history:', error);
      return [];
    }
  }

  /**
   * Clear price drop notification history
   */
  async clearPriceDropHistory() {
    try {
      await browser.storage.local.set({ 'priceDropHistory': [] });
      this.logger.logSync('Price drop notification history cleared');
    } catch (error) {
      this.logger.errorSync('Error clearing price drop history:', error);
    }
  }
}