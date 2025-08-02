/**
 * StatusMessageManager - Handles status message display functionality
 * Eliminates code duplication for status message functions
 */
class StatusMessageManager {
  /**
   * Display a status message in the specified element
   * @param {string} elementId - The ID of the element to display the message in
   * @param {string} message - The message to display
   * @param {string} type - The type of message (success, error, info)
   * @param {number} timeout - The timeout in milliseconds (default: 3000)
   */
  static showMessage(elementId, message, type = 'info', timeout = 3000) {
    const statusElement = document.getElementById(elementId);
    if (!statusElement) {
      console.error(`Status element with ID '${elementId}' not found`);
      return;
    }

    statusElement.textContent = message;
    statusElement.className = type;

    // Clear the message after the specified timeout
    setTimeout(() => {
      statusElement.className = '';
      statusElement.textContent = '';
    }, timeout);
  }

  /**
   * Display a general status message (3 second timeout)
   */
  static showStatusMessage(message, type = 'info') {
    this.showMessage('status-message', message, type, 3000);
  }

  /**
   * Display a view mode status message (5 second timeout for reload instruction)
   */
  static showViewStatusMessage(message, type = 'info') {
    this.showMessage('view-status-message', message, type, 5000);
  }

  /**
   * Display an alarm status message (3 second timeout)
   */
  static showAlarmStatusMessage(message, type = 'info') {
    this.showMessage('alarm-status-message', message, type, 3000);
  }

  /**
   * Display a clear status message (3 second timeout)
   */
  static showClearStatusMessage(message, type = 'info') {
    this.showMessage('clear-status-message', message, type, 3000);
  }
}