async function getViewMode () {
  const result = await browser.storage.local.get('viewMode')

  return result.viewMode || 'popup'
}

// Set the view mode (popup or sidebar)
async function setViewMode (viewMode) {
  try {
    if (viewMode === 'sidebar') {
      // Disable popup so click handler is called
      await browser.browserAction.setPopup({ popup: '' })
    } else {
      // Enable popup for normal popup behavior
      await browser.browserAction.setPopup({ popup: 'popup/popup.html' })
    }
  } catch (error) {
    console.error('Error setting view mode:', error)
  }
}


// Initialize view mode on startup
async function initializeViewMode () {
  try {
    const viewMode = await getViewMode()
    await setViewMode(viewMode)
  } catch (error) {
    console.error('Error initializing view mode:', error)
    // Default to popup mode
      await setViewMode('popup')
  }
}

// Listen for extension icon clicks (only called when popup is disabled)
browser.browserAction.onClicked.addListener((tab, info) => {
  // Call open() first while still in the user input handler context
  browser.sidebarAction.open().catch(console.error);

  // Then set the panel (this can be async)
  browser.sidebarAction.setPanel({ panel: 'sidebar/sidebar.html' }).catch(console.error);
});

// Listen for storage changes to update view mode
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.viewMode) {
    await setViewMode(changes.viewMode.newValue)
  }
})

browser.runtime.onInstalled.addListener(() => {
  // noinspection JSIgnoredPromiseFromCall
  initializeViewMode()
})

browser.runtime.onStartup.addListener(() => {
  // noinspection JSIgnoredPromiseFromCall
  initializeViewMode()
})

// Listen for messages from the popup/sidebar
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'trackPrice') {
    trackPrice(message.url, message.apiKey).
      then(result => sendResponse(result)).
      catch(error => sendResponse({ error: error.message }))

    // Return true to indicate we will send a response asynchronously
    return true
  }
})

// Function to track price using OpenAI API
async function trackPrice (url, apiKey) {
  try {
    // Get the page content first
    const pageContent = await getPageContent()

    // Extract information using OpenAI API
    const extractedData = await extractDataWithOpenAI(url, apiKey, pageContent)

    return extractedData
  } catch (error) {
    console.error('Error in trackPrice:', error)
    throw new Error('Failed to track price: ' + error.message)
  }
}

// Function to get the content of the current page
async function getPageContent() {
  try {
    // Get the current active tab
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })

    // Execute a content script to get the page content
    const results = await browser.tabs.executeScript(tab.id, {
      code: `
        // Get the body content
        const bodyElement = document.body;
        const bodyText = bodyElement ? bodyElement.innerText : '';

        // Return half of the body content to avoid too large requests
        const halfLength = Math.floor(bodyText.length / 2);
        const halfBodyContent = bodyText.substring(0, halfLength);

        ({
          title: document.title,
          bodyContent: halfBodyContent,
          url: window.location.href
        });
      `
    })

    return results[0]
  } catch (error) {
    console.error('Error getting page content:', error)
    throw new Error('Could not access page content. Make sure you are on a product page.')
  }
}

// Function to extract data using OpenAI API
async function extractDataWithOpenAI (url, apiKey, pageContent) {
  try {
    // Prepare the prompt for OpenAI
    const prompt = `
          You are analyzing a product page at this URL: ${url}

          Page Title: ${pageContent.title}

          Page Content (first half of body):
          ${pageContent.bodyContent}

          Please extract the following information from the page content above:
          - The normalized product name
          - The current price (including currency symbol)

          For example if a product is called "Amazing Phone, Apple iPhone 13 Pro Max, 256 GB, lastest iOS" and the price is $1,000.00,
          the extracted data should be:
          { "name": "Apple iPhone 13 Pro Max, 256 GB", "price": "$1,000.00" }

          Another example, if a product is called "Kärcher 2.863-089.0 Plastic Parking Station" and the price is $1,
          the extracted data should be:
          { "name": "Kärcher Plastic Parking Station", "price": "$1" }

          Last example, if a product is called "Insta360 Ace Pro 2 Double Battery Bundle - 8K Waterproof Action Camera Designed with Leica, 1/1.3 Inch Sensor, Dual AI Chip System, Leading Low Light Performance, Best Audio, Flip Screen & AI Editin" and the price is €100.99,
          then the extracted data should be:
          { "name": "Insta360 Ace Pro 2 Double Battery Bundle", "price": "€100.99" }

          Return ONLY the JSON formatted string with these fields:
          - name: The product name
          - price: The product price
        `

    // Make request to OpenAI API
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
        tool_choice: 'required',
        tools: [
          { type: 'web_search_preview' },
        ],
        instructions: 'You are a helpful assistant that extracts product information from webpages. Do NOT use existing knowledge. Return only a raw JSON string on a single line, with no code block formatting or markdown. Example: {"name": "Product name", "price": "100.00"}',
        input: prompt,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(
        `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`)
    }

    const data = await response.json()

    // Check if the response has the expected structure
    if (!data.output || !Array.isArray(data.output)) {
      console.error('Unexpected API response format:', data)
      throw new Error('Invalid response format from OpenAI API')
    }

    // Find the message output in the response
    const messageOutput = data.output.find(item => item.type === 'message')
    if (!messageOutput || !messageOutput.content ||
      !messageOutput.content.length) {
      console.error('No message output found in response:', data)
      throw new Error('Invalid response format from OpenAI API')
    }

    // Get the text content from the message
    const textContent = messageOutput.content.find(
      item => item.type === 'output_text')
    if (!textContent || !textContent.text) {
      console.error('No text content found in message:', messageOutput)
      throw new Error('No text content found in the API response')
    }

    try {
      const extractedData = JSON.parse(textContent.text)

      // Validate the extracted data
      if (!extractedData.name || !extractedData.price) {
        throw new Error('Could not extract product information from this page')
      }

      return extractedData
    } catch (jsonError) {
      console.error('Error parsing JSON:', jsonError)
      throw new Error(
        'Failed to parse JSON from the API response: ' + jsonError.message)
    }
  } catch (error) {
    console.error('Error extracting data with OpenAI:', error)
    throw new Error('Failed to extract data: ' + error.message)
  }
}
