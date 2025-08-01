/**
 * Sidebar-specific implementation of PriceTracker
 * Uses 'update' navigation type to update current tab when clicking on items
 */
class SidebarTracker extends PriceTracker {
  constructor() {
    super('update'); // Sidebar updates current tab when navigating
  }

  /**
   * Initialize the sidebar tracker
   */
  static async init() {
    const tracker = new SidebarTracker();
    await tracker.initialize();
    return tracker;
  }
}