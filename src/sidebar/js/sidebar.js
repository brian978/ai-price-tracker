// Global variables
let currentTab = 'prices';
let trackedPrices = [];
let trackedItems = {};

// Initialize the sidebar
document.addEventListener('DOMContentLoaded', async function() {
  // Set up tab switching
  setupTabs();

  // Set up track price button
  document.getElementById('track-price-btn').addEventListener('click', trackPrice);

  // Set up settings button
  document.getElementById('settings-btn').addEventListener('click', openSettings);

  // Set up tab change listeners to update display when user navigates to different pages
  setupTabChangeListeners();

  // Load saved data (this will also display the data)
  await loadData();
});

// Load data from storage with fallback
async function loadData() {
  try {
    // Load from local storage
    const result = await browser.storage.local.get(['trackedPrices', 'trackedItems']);

    trackedPrices = result.trackedPrices || [];
    trackedItems = result.trackedItems || {};

    // Display data after loading
    await displayPrices();
    displayItems();

    // Display current item if on a product page
    await displayCurrentItem();
  } catch (error) {
    console.error('Error loading data:', error);
    // Only show error notification if it's a real error, not just missing data
    if (error.message && !error.message.includes('storage API will not work')) {
      showNotification('Error loading saved data', 'error');
    }
  }
}

// Display current item based on the active tab URL
async function displayCurrentItem() {
  try {
    const tabs = await browser.tabs.query({active: true, currentWindow: true});
    const url = tabs[0].url;

    const currentItemElement = document.getElementById('current-item');

    // Check if we have this item in our tracked items
    if (trackedItems[url]) {
      currentItemElement.textContent = trackedItems[url].name;
      currentItemElement.style.display = 'block';
    } else {
      currentItemElement.textContent = '';
      currentItemElement.style.display = 'none';
    }
  } catch (error) {
    console.error('Error displaying current item:', error);
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.className = `notification ${type}`;

  // Hide notification after 3 seconds
  setTimeout(() => {
    notification.className = 'notification hidden';
  }, 3000);
}

// Custom Modal Functions
function showModal(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    // Set modal content
    modalTitle.textContent = title;
    modalMessage.textContent = message;

    // Show modal
    modal.classList.remove('hidden');

    // Handle button clicks
    const handleConfirm = () => {
      hideModal();
      resolve(true);
    };

    const handleCancel = () => {
      hideModal();
      resolve(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        handleCancel();
      }
    };

    // Add event listeners
    confirmBtn.addEventListener('click', handleConfirm, { once: true });
    cancelBtn.addEventListener('click', handleCancel, { once: true });
    document.addEventListener('keydown', handleEscape, { once: true });

    // Handle clicking outside modal
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        handleCancel();
      }
    }, { once: true });
  });
}

function hideModal() {
  const modal = document.getElementById('custom-modal');
  modal.classList.add('hidden');
}

// Custom confirm function to replace browser confirm()
async function customConfirm(message, title = 'Confirm Action') {
  return await showModal(title, message);
}

// Save data to storage
async function saveData() {
  try {
    // Save to local storage
    await browser.storage.local.set({
      trackedPrices: trackedPrices,
      trackedItems: trackedItems
    });

    // Show success notification when saving after tracking a price
    if (arguments.length > 0 && arguments[0] === 'track') {
      showNotification('Price tracked successfully!', 'success');
    }
    return true;
  } catch (error) {
    console.error('Error saving data:', error);
    showNotification('Error saving data. Please try again.', 'error');
    return false;
  }
}

// Set up tab switching
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');

  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

// Switch between tabs
function switchTab(tabName) {
  currentTab = tabName;

  // Update active tab button
  document.querySelectorAll('.tab-button').forEach(button => {
    if (button.getAttribute('data-tab') === tabName) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });

  // Show active tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === tabName + '-tab') {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// Set up tab change listeners to update display when user navigates to different pages
function setupTabChangeListeners() {
  // Listen for tab updates (when user navigates to a different URL)
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      // Only update if the URL has changed (immediately, not waiting for page load)
      if (changeInfo.url) {
        // Get the current active tab to make sure we're updating for the right tab
        const activeTabs = await browser.tabs.query({active: true, currentWindow: true});
        if (activeTabs.length > 0 && activeTabs[0].id === tabId) {
          // Update the display for the new page
          await displayCurrentItem();
          await displayPrices();
        }
      }
    } catch (error) {
      console.error('Error handling tab update:', error);
    }
  });

  // Listen for tab activation (when user switches between tabs)
  browser.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      // Update the display for the newly activated tab
      await displayCurrentItem();
      await displayPrices();
    } catch (error) {
      console.error('Error handling tab activation:', error);
    }
  });
}

// Track price function
async function trackPrice() {
  try {
    // Get current tab URL
    const tabs = await browser.tabs.query({active: true, currentWindow: true});
    const url = tabs[0].url;

    // Check if this is a valid URL to track
    if (!url || url.startsWith('about:') || url.startsWith('moz-extension:')) {
      showNotification('Please navigate to a product page first.', 'warning');
      return;
    }

    // Check if we already tracked this URL recently
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const recentlyTracked = trackedPrices.some(entry => 
      entry.url === url && entry.date === currentDate
    );

    if (recentlyTracked) {
      showNotification('You have already tracked this item today.', 'warning');
      return;
    }

    // Get API key from storage
    const result = await browser.storage.local.get('apiKey');
    const apiKey = result.apiKey;

    if (!apiKey) {
      showNotification('Please set your OpenAI API key in the settings page first.', 'error');
      browser.runtime.openOptionsPage();
      return;
    }

    // Show loading state
    const trackButton = document.getElementById('track-price-btn');
    const originalText = trackButton.textContent;
    trackButton.textContent = 'Tracking...';
    trackButton.disabled = true;

    // Send message to background script to make API call
    const response = await browser.runtime.sendMessage({
      action: 'trackPrice',
      url: url,
      apiKey: apiKey
    });

    if (response.error) {
      throw new Error(response.error);
    }

    // Add new price entry
    const newEntry = {
      date: currentDate,
      name: response.name,
      price: response.price,
      url: url,
      imageUrl: response.imageUrl
    };

    trackedPrices.push(newEntry);

    // Update tracked items
    if (!trackedItems[url]) {
      trackedItems[url] = {
        name: response.name,
        imageUrl: response.imageUrl
      };
    }

    // Save data and show success notification
    await saveData('track');

    // Update display
    await displayPrices();
    displayItems();

    // Update current item display
    await displayCurrentItem();

    // Reset button
    trackButton.textContent = originalText;
    trackButton.disabled = false;

  } catch (error) {
    console.error('Error tracking price:', error);
    showNotification('Error tracking price: ' + error.message, 'error');

    // Reset button
    const trackButton = document.getElementById('track-price-btn');
    trackButton.textContent = 'Track price';
    trackButton.disabled = false;
  }
}

// Normalize URL by removing query parameters, fragments, and trailing slashes
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove query parameters and fragment, normalize trailing slash
    return urlObj.origin + urlObj.pathname.replace(/\/$/, '');
  } catch (error) {
    console.error('Error normalizing URL:', url, error);
    return url; // Return original URL if parsing fails
  }
}

// Display tracked prices
async function displayPrices() {
  const tableBody = document.getElementById('prices-table-body');

  try {
    // Get current tab URL
    const tabs = await browser.tabs.query({active: true, currentWindow: true});
    
    // Check if we got valid tab data
    if (!tabs || tabs.length === 0 || !tabs[0] || !tabs[0].url) {
      console.warn('Could not get current tab URL, keeping existing table content');
      return; // Don't clear the table if we can't get the URL
    }
    
    const currentUrl = tabs[0].url;
    console.log('displayPrices() called for URL:', currentUrl);

    // Filter prices for the current URL using normalized URL matching
    const normalizedCurrentUrl = normalizeUrl(currentUrl);
    const currentItemPrices = trackedPrices.filter(entry => {
      const normalizedStoredUrl = normalizeUrl(entry.url);
      return normalizedStoredUrl === normalizedCurrentUrl;
    });
    console.log(`Found ${currentItemPrices.length} prices for current URL (normalized matching)`);

    // Only clear the table after we know what content to show
    tableBody.innerHTML = '';

    if (currentItemPrices.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.setAttribute('colspan', '3');
      cell.style.textAlign = 'center';
      cell.textContent = 'No prices tracked for this item';
      row.appendChild(cell);
      tableBody.appendChild(row);
      return;
    }

    // Sort by date (newest first)
    const sortedPrices = [...currentItemPrices].sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });

    sortedPrices.forEach((entry, index) => {
      const row = document.createElement('tr');

      // Format date
      const dateObj = new Date(entry.date);
      const formattedDate = dateObj.toLocaleDateString();

      // Create date cell
      const dateCell = document.createElement('td');
      dateCell.textContent = formattedDate;
      row.appendChild(dateCell);

      // Create price cell
      const priceCell = document.createElement('td');
      priceCell.textContent = entry.price;
      row.appendChild(priceCell);

      // Create delete cell
      const deleteCell = document.createElement('td');
      const deleteSpan = document.createElement('span');
      deleteSpan.className = 'delete-entry';
      deleteSpan.setAttribute('data-index', trackedPrices.indexOf(entry).toString());
      deleteSpan.textContent = '🗑️';
      deleteCell.appendChild(deleteSpan);
      row.appendChild(deleteCell);

      tableBody.appendChild(row);
    });

    // Add event listeners to delete buttons
    document.querySelectorAll('.delete-entry').forEach(button => {
      button.addEventListener('click', async function() {
        const index = parseInt(this.getAttribute('data-index'));
        await deletePrice(index);
      });
    });
  } catch (error) {
    console.error('Error displaying prices:', error);
    showNotification('Error displaying prices', 'error');
  }
}

// Delete price entry
async function deletePrice(index) {
  const confirmed = await customConfirm(
    'Are you sure you want to delete this price entry?',
    'Delete Price Entry'
  );

  if (confirmed) {
    trackedPrices.splice(index, 1);
    await saveData();
    await displayPrices();

    // Update items list if needed
    updateTrackedItems();
    displayItems();

    // Update current item display
    await displayCurrentItem();

    showNotification('Price entry deleted', 'success');
  }
}

// Update tracked items based on price entries
function updateTrackedItems() {
  const urls = new Set();

  // Collect all URLs that still have price entries
  trackedPrices.forEach(entry => {
    urls.add(entry.url);
  });

  // Remove items that no longer have price entries
  Object.keys(trackedItems).forEach(url => {
    if (!urls.has(url)) {
      delete trackedItems[url];
    }
  });
}

// Display tracked items
function displayItems() {
  const itemsList = document.getElementById('items-list');
  itemsList.innerHTML = '';

  const items = Object.entries(trackedItems);

  if (items.length === 0) {
    const noItemsDiv = document.createElement('div');
    noItemsDiv.style.textAlign = 'center';
    noItemsDiv.style.padding = '20px';
    noItemsDiv.textContent = 'No items tracked yet';
    itemsList.appendChild(noItemsDiv);
    return;
  }

  items.forEach(([url, item]) => {
    const itemEntry = document.createElement('div');
    itemEntry.className = 'item-entry';

    // Truncate name if too long
    const truncatedName = item.name.length > 40 ? 
      item.name.substring(0, 37) + '...' : 
      item.name;

    // Create item name div
    const itemNameDiv = document.createElement('div');
    itemNameDiv.className = 'item-name';
    itemNameDiv.setAttribute('title', item.name);
    itemNameDiv.setAttribute('data-url', url);
    itemNameDiv.textContent = truncatedName;
    itemEntry.appendChild(itemNameDiv);

    // Create delete item div
    const deleteItemDiv = document.createElement('div');
    deleteItemDiv.className = 'delete-item';
    deleteItemDiv.setAttribute('data-url', url);
    deleteItemDiv.textContent = '🗑️';
    itemEntry.appendChild(deleteItemDiv);

    itemsList.appendChild(itemEntry);
  });

  // Add event listeners to item names (for navigation)
  document.querySelectorAll('.item-name').forEach(item => {
    item.addEventListener('click', function() {
      const url = this.getAttribute('data-url');
      browser.tabs.update({ url: url });
    });
  });

  // Add event listeners to delete buttons
  document.querySelectorAll('.delete-item').forEach(button => {
    button.addEventListener('click', async function() {
      const url = this.getAttribute('data-url');
      await deleteItem(url);
    });
  });
}

// Delete item and all its price entries
async function deleteItem(url) {
  const confirmed = await customConfirm(
    'Are you sure you want to delete this item and all its price history?',
    'Delete Item'
  );

  if (confirmed) {
    // Remove all price entries for this URL
    trackedPrices = trackedPrices.filter(entry => entry.url !== url);

    // Remove the item
    delete trackedItems[url];

    // Save data
    await saveData();

    // Update displays
    await displayPrices();
    displayItems();
    await displayCurrentItem();

    showNotification('Item and all its price history deleted', 'success');
  }
}

// Open settings page in a new tab
function openSettings() {
  browser.runtime.openOptionsPage();
}
