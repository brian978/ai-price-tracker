/**
 * ViewModeManager - Handles view mode management (popup vs sidebar)
 */
class ViewModeManager {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Get the current view mode from storage
   */
  async getViewMode() {
    const result = await browser.storage.local.get('viewMode');
    return result.viewMode || 'popup';
  }

  /**
   * Set the view mode (popup or sidebar)
   */
  async setViewMode(viewMode) {
    try {
      if (viewMode === 'sidebar') {
        // Disable popup so click handler is called
        await browser.browserAction.setPopup({ popup: '' });
      } else {
        // Enable popup for normal popup behavior
        await browser.browserAction.setPopup({ popup: 'popup/popup.html' });
      }
    } catch (error) {
      this.logger.errorSync('Error setting view mode:', error);
    }
  }

  /**
   * Initialize view mode on startup
   */
  async initializeViewMode() {
    try {
      const viewMode = await this.getViewMode();
      await this.setViewMode(viewMode);
    } catch (error) {
      this.logger.errorSync('Error initializing view mode:', error);
      // Default to popup mode
      await this.setViewMode('popup');
    }
  }

  /**
   * Handle view mode changes from storage
   */
  async handleViewModeChange(newViewMode) {
    await this.setViewMode(newViewMode);
  }

  /**
   * Handle browser action click (only called when popup is disabled for sidebar mode)
   */
  async handleBrowserActionClick() {
    try {
      // Call open() first while still in the user input handler context
      await browser.sidebarAction.open();
      
      // Then set the panel (this can be async)
      await browser.sidebarAction.setPanel({ panel: 'sidebar/sidebar.html' });
    } catch (error) {
      this.logger.errorSync('Error handling browser action click:', error);
    }
  }
}