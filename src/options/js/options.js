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

// Load saved API key from storage
function loadOptions() {
  browser.storage.local.get(['apiKey', 'viewMode', 'priceAlarmEnabled'])
    .then(result => {
      if (result.apiKey) {
        document.getElementById('api-key').value = result.apiKey;
      }
      if (result.viewMode) {
        document.getElementById('view-mode').value = result.viewMode;
      } else {
        // Default to popup if no preference is set
        document.getElementById('view-mode').value = 'popup';
      }
      
      // Set price alarm checkbox (default to off if not set)
      const priceAlarmCheckbox = document.getElementById('price-alarm-enabled');
      priceAlarmCheckbox.checked = result.priceAlarmEnabled === true;
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

// Initialize the options page
document.addEventListener('DOMContentLoaded', () => {
  // Load saved options
  loadOptions();

  // Add event listeners
  document.getElementById('save-btn').addEventListener('click', saveOptions);
  document.getElementById('show-hide-btn').addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('save-view-btn').addEventListener('click', saveViewMode);
  document.getElementById('save-alarm-btn').addEventListener('click', savePriceAlarmSetting);
});
