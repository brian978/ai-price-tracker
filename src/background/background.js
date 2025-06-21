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
    // Extract information using OpenAI API
    const extractedData = await extractDataWithOpenAI(url, apiKey)

    return extractedData
  } catch (error) {
    console.error('Error in trackPrice:', error)
    throw new Error('Failed to track price: ' + error.message)
  }
}

// Function to extract data using OpenAI API
async function extractDataWithOpenAI (url, apiKey) {
  try {
    // Prepare the prompt for OpenAI
    const prompt = `
          You are analyzing a product page at this URL: ${url}

          Please extract the following information from the page:
          - The product name
          - The current price (including currency symbol)

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
