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
      console.error('Error saving API key:', error);
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
      return browser.storage.local.get(['viewMode', 'priceAlarmEnabled']);
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
    })
    .catch(error => {
      console.error('Error loading options:', error);
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
      console.error('Error saving view mode:', error);
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

// Display status message
function showStatusMessage(message, type) {
  const statusElement = document.getElementById('status-message');
  statusElement.textContent = message;
  statusElement.className = type;

  // Clear the message after 3 seconds
  setTimeout(() => {
    statusElement.className = '';
    statusElement.textContent = '';
  }, 3000);
}

// Display view mode status message
function showViewStatusMessage(message, type) {
  const statusElement = document.getElementById('view-status-message');
  statusElement.textContent = message;
  statusElement.className = type;

  // Clear the message after 5 seconds (longer for reload instruction)
  setTimeout(() => {
    statusElement.className = '';
    statusElement.textContent = '';
  }, 5000);
}

// Save the price alarm setting
function savePriceAlarmSetting() {
  const priceAlarmEnabled = document.getElementById('price-alarm-enabled').checked;

  browser.storage.local.set({ priceAlarmEnabled: priceAlarmEnabled })
    .then(() => {
      showAlarmStatusMessage(`Price alarm ${priceAlarmEnabled ? 'enabled' : 'disabled'} successfully!`, 'success');
    })
    .catch(error => {
      console.error('Error saving price alarm setting:', error);
      showAlarmStatusMessage('Error saving price alarm setting. Please try again.', 'error');
    });
}

// Display alarm status message
function showAlarmStatusMessage(message, type) {
  const statusElement = document.getElementById('alarm-status-message');
  statusElement.textContent = message;
  statusElement.className = type;

  // Clear the message after 3 seconds
  setTimeout(() => {
    statusElement.className = '';
    statusElement.textContent = '';
  }, 3000);
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
  browser.storage.local.get('priceCheckHistory')
    .then(result => {
      const history = result.priceCheckHistory || [];
      displayPriceHistory(history);
    })
    .catch(error => {
      console.error('Error loading price history:', error);
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
      console.error('Error loading price drop history:', error);
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
});
