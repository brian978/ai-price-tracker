/**
 * DOMInitializer - Handles common DOM initialization patterns
 * Eliminates code duplication for DOM ready event listeners
 */
class DOMInitializer {
  /**
   * Initialize a tracker when the DOM is ready
   * @param {Function} initFunction - The initialization function to call
   */
  static initializeOnDOMReady(initFunction) {
    document.addEventListener('DOMContentLoaded', async function() {
      await initFunction();
    });
  }

  /**
   * Initialize popup tracker when DOM is ready
   */
  static initializePopup() {
    this.initializeOnDOMReady(() => PopupTracker.init());
  }

  /**
   * Initialize sidebar tracker when DOM is ready
   */
  static initializeSidebar() {
    this.initializeOnDOMReady(() => SidebarTracker.init());
  }
}