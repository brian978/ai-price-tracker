// Logger dependency: Logger.js must be loaded before this script
// Save the API key to storage
function saveOptions() {
  const apiKey = document.getElementById('api-key').value.trim();

  if (!apiKey) {
    showStatusMessage('Please enter an API key.', 'error');
    return;
  }

  // Validate API key format (basic check for sk- prefix)
  if (!apiKey.startsWith('sk-')) {
    showStatusMessage('API key should start with "sk-". Please check your key.', 'error');
    return;
  }

  browser.storage.local.set({ apiKey: apiKey })
    .then(() => {
      showStatusMessage('API key saved successfully!', 'success');
    })
    .catch(error => {
      logger.errorSync('Error saving API key:', error);
      showStatusMessage('Error saving API key. Please try again.', 'error');
    });
}

// Load saved options from storage
function loadOptions() {
  // Get API key from local storage
  browser.storage.local.get(['apiKey'])
    .then(localResult => {
      if (localResult.apiKey) {
        document.getElementById('api-key').value = localResult.apiKey;
      }
      
      // Get other settings from local storage
      return browser.storage.local.get(['viewMode', 'priceAlarmEnabled', 'checkInterval']);
    })
    .then(syncResult => {
      if (syncResult.viewMode) {
        document.getElementById('view-mode').value = syncResult.viewMode;
      } else {
        // Default to popup if no preference is set
        document.getElementById('view-mode').value = 'popup';
      }
      
      // Set price alarm checkbox (default to off if not set)
      const priceAlarmCheckbox = document.getElementById('price-alarm-enabled');
      priceAlarmCheckbox.checked = syncResult.priceAlarmEnabled === true;
      
      // Set check interval (default to 60 minutes if not set)
      const checkIntervalInput = document.getElementById('check-interval');
      checkIntervalInput.value = syncResult.checkInterval || 60;
      
      // Load alarm timing information
      loadAlarmTimingInfo();
    })
    .catch(error => {
      logger.errorSync('Error loading options:', error);
    });
}

// Save the view mode preference to storage
function saveViewMode() {
  const viewMode = document.getElementById('view-mode').value;

  browser.storage.local.set({ viewMode: viewMode })
    .then(() => {
      showViewStatusMessage('View mode saved successfully! Please reload the extension to apply changes.', 'success');
    })
    .catch(error => {
      logger.errorSync('Error saving view mode:', error);
      showViewStatusMessage('Error saving view mode. Please try again.', 'error');
    });
}

// Show/hide the API key
function toggleApiKeyVisibility() {
  const apiKeyInput = document.getElementById('api-key');
  const showHideBtn = document.getElementById('show-hide-btn');

  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    showHideBtn.textContent = 'Hide';
  } else {
    apiKeyInput.type = 'password';
    showHideBtn.textContent = 'Show';
  }
}

// Status message functions - delegating to StatusMessageManager
function showStatusMessage(message, type) {
  StatusMessageManager.showStatusMessage(message, type);
}

function showViewStatusMessage(message, type) {
  StatusMessageManager.showViewStatusMessage(message, type);
}

// Save the price alarm setting
function savePriceAlarmSetting() {
  const priceAlarmEnabled = document.getElementById('price-alarm-enabled').checked;
  const checkIntervalInput = document.getElementById('check-interval');
  const checkInterval = parseInt(checkIntervalInput.value);

  // Validate check interval
  if (isNaN(checkInterval) || checkInterval < 1 || checkInterval > 1440) {
    showAlarmStatusMessage('Check interval must be between 1 and 1440 minutes.', 'error');
    return;
  }

  browser.storage.local.set({ 
    priceAlarmEnabled: priceAlarmEnabled,
    checkInterval: checkInterval
  })
    .then(() => {
      showAlarmStatusMessage(`Price alarm ${priceAlarmEnabled ? 'enabled' : 'disabled'} successfully! Check interval set to ${checkInterval} minutes.`, 'success');
      // Update timing info after saving
      loadAlarmTimingInfo();
    })
    .catch(error => {
      logger.errorSync('Error saving price alarm setting:', error);
      showAlarmStatusMessage('Error saving price alarm setting. Please try again.', 'error');
    });
}

// Load and display alarm timing information using PriceCheckScheduler
async function loadAlarmTimingInfo() {
  try {
    // Create scheduler instance for getting timing info
    const dataManager = new PriceDataManager();
    // Note: logger is already created globally in Logger.js
    const scheduler = new PriceCheckScheduler(dataManager, logger);
    
    // Get last check time
    const lastCheckTime = await scheduler.getLastCheckTime();
    const lastCheckElement = document.getElementById('last-check-value');
    if (lastCheckTime) {
      lastCheckElement.textContent = formatDateTime(lastCheckTime);
    } else {
      lastCheckElement.textContent = 'Never';
    }
    
    // Get next check time
    const nextCheckTime = await scheduler.getNextCheckTime();
    const nextCheckElement = document.getElementById('next-check-value');
    const isEnabled = await scheduler.isPriceTrackingEnabled();
    
    if (nextCheckTime) {
      nextCheckElement.textContent = formatDateTime(nextCheckTime);
    } else if (isEnabled) {
      nextCheckElement.textContent = 'Within the next hour';
    } else {
      nextCheckElement.textContent = 'Not scheduled (alarm disabled)';
    }
  } catch (error) {
    logger.errorSync('Error loading alarm timing info:', error);
    document.getElementById('last-check-value').textContent = 'Error loading';
    document.getElementById('next-check-value').textContent = 'Error loading';
  }
}

// Format date and time for display
function formatDateTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  // For future dates (next check)
  if (diffMs < 0) {
    const futureMins = Math.abs(diffMins);
    const futureHours = Math.abs(diffHours);
    
    if (futureMins < 60) {
      return `in ${futureMins} minute${futureMins !== 1 ? 's' : ''}`;
    } else if (futureHours < 24) {
      return `in ${futureHours} hour${futureHours !== 1 ? 's' : ''}`;
    } else {
      return date.toLocaleString();
    }
  }
  
  // For past dates (last check)
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleString();
  }
}

function showAlarmStatusMessage(message, type) {
  StatusMessageManager.showAlarmStatusMessage(message, type);
}

function showClearStatusMessage(message, type) {
  StatusMessageManager.showClearStatusMessage(message, type);
}

// Clear price check history only (NOT tracked items)
function clearPriceHistory() {
  const confirmed = confirm(
    'Are you sure you want to clear all price history? This action cannot be undone.'
  );

  if (confirmed) {
    // Clear the history from all tracked items but keep the items themselves
    browser.storage.local.get('trackedPrices')
      .then(result => {
        const trackedPrices = result.trackedPrices || [];
        // Clear history array for each tracked item
        trackedPrices.forEach(item => {
          if (item.history) {
            item.history = [];
          }
        });
        
        // Save the updated trackedPrices back to storage
        return browser.storage.local.set({ trackedPrices: trackedPrices });
      })
      .then(() => {
        showClearStatusMessage('Price check history cleared successfully!', 'success');
        
        // Also refresh the price history display if we're on that tab
        const priceHistoryTab = document.getElementById('price-history');
        if (priceHistoryTab.classList.contains('active')) {
          loadPriceHistory();
        }
      })
      .catch(error => {
        logger.errorSync('Error clearing price check history:', error);
        showClearStatusMessage('Error clearing price check history. Please try again.', 'error');
      });
  }
}

// Clear tracked prices for alarm
function clearPriceDropHistory() {
  const confirmed = confirm(
    'Are you sure you want to clear all the price drop history? This action cannot be undone.'
  );

  if (confirmed) {
    // Clear only the tracked prices for alarm
    browser.storage.local.set({
      priceDropHistory: {}
    })
    .then(() => {
      showClearStatusMessage('Tracked prices for alarm cleared successfully!', 'success');
    })
    .catch(error => {
      logger.errorSync('Error clearing tracked prices for alarm:', error);
      showClearStatusMessage('Error clearing tracked prices for alarm. Please try again.', 'error');
    });
  }
}

// Tab switching functionality
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and content
      tabButtons.forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked button and corresponding content
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
      
      // Load appropriate history data based on selected tab
      if (tabId === 'price-history') {
        loadPriceHistory();
      } else if (tabId === 'price-drop-history') {
        loadPriceDropHistory();
      }
    });
  });
}

// Load price history from storage and display it
function loadPriceHistory() {
  browser.storage.local.get('trackedPrices')
    .then(result => {
      const trackedPrices = result.trackedPrices || [];
      // Extract all history entries from all tracked items
      const history = [];
      trackedPrices.forEach(item => {
        if (item.history && Array.isArray(item.history)) {
          item.history.forEach(historyEntry => {
            history.push({
              productName: item.name,
              price: historyEntry.price,
              timestamp: historyEntry.timestamp,
              url: item.url
            });
          });
        }
      });
      displayPriceHistory(history);
    })
    .catch(error => {
      logger.errorSync('Error loading price history:', error);
    });
}

// Display price history in the table
function displayPriceHistory(history) {
  const tableBody = document.getElementById('history-table-body');
  const emptyHistory = document.getElementById('empty-history');
  const historyTable = document.getElementById('history-table');
  
  // Clear existing table rows
  tableBody.innerHTML = '';
  
  if (history.length === 0) {
    // Show empty state message if no history
    emptyHistory.classList.remove('hidden');
    historyTable.classList.add('hidden');
    return;
  }
  
  // Show table and hide empty state
  emptyHistory.classList.add('hidden');
  historyTable.classList.remove('hidden');
  
  // Sort history by timestamp (newest first)
  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Add rows to the table
  history.forEach(item => {
    const row = document.createElement('tr');
    
    // Format the date
    const date = new Date(item.timestamp);
    const formattedDate = date.toLocaleString();
    
    // Create table cells
    row.innerHTML = `
      <td>${item.productName}</td>
      <td>${item.price}</td>
      <td>${formattedDate}</td>
      <td><a href="${item.url}" class="history-action" target="_blank">View Product</a></td>
    `;
    
    tableBody.appendChild(row);
  });
}

// Load price drop history from storage and display it
function loadPriceDropHistory() {
  browser.storage.local.get('priceDropHistory')
    .then(result => {
      const history = result.priceDropHistory || [];
      displayPriceDropHistory(history);
    })
    .catch(error => {
      logger.errorSync('Error loading price drop history:', error);
    });
}

// Display price drop history in the table
function displayPriceDropHistory(history) {
  const tableBody = document.getElementById('drop-history-table-body');
  const emptyHistory = document.getElementById('empty-drop-history');
  const historyTable = document.getElementById('drop-history-table');
  
  // Clear existing table rows
  tableBody.innerHTML = '';
  
  if (history.length === 0) {
    // Show empty state message if no history
    emptyHistory.classList.remove('hidden');
    historyTable.classList.add('hidden');
    return;
  }
  
  // Show table and hide empty state
  emptyHistory.classList.add('hidden');
  historyTable.classList.remove('hidden');
  
  // Sort history by timestamp (newest first)
  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Add rows to the table
  history.forEach(item => {
    const row = document.createElement('tr');
    
    // Format the date
    const date = new Date(item.timestamp);
    const formattedDate = date.toLocaleString();
    
    // Create table cells
    row.innerHTML = `
      <td>${item.productName}</td>
      <td>${item.oldPrice}</td>
      <td>${item.newPrice}</td>
      <td>${formattedDate}</td>
      <td><a href="${item.url}" class="history-action" target="_blank">View Product</a></td>
    `;
    
    tableBody.appendChild(row);
  });
}

// Initialize the options page
document.addEventListener('DOMContentLoaded', () => {
  // Load saved options
  loadOptions();
  
  // Setup tabs
  setupTabs();
  
  // Add event listeners
  document.getElementById('save-btn').addEventListener('click', saveOptions);
  document.getElementById('show-hide-btn').addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('save-view-btn').addEventListener('click', saveViewMode);
  document.getElementById('save-alarm-btn').addEventListener('click', savePriceAlarmSetting);
  document.getElementById('clear-price-check-history-btn').addEventListener('click', clearPriceHistory);
  document.getElementById('clear-price-drop-history-btn').addEventListener('click', clearPriceDropHistory);
});
