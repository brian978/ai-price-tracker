/**
 * Popup-specific implementation of PriceTracker
 * Uses 'create' navigation type to open new tabs when clicking on items
 */
class PopupTracker extends PriceTracker {
  constructor() {
    super('create'); // Popup creates new tabs when navigating
  }

  /**
   * Initialize the popup tracker
   */
  static async init() {
    const tracker = new PopupTracker();
    await tracker.initialize();
    return tracker;
  }
}