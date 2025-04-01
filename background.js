/*
 * CLEANUP NOTE:
 * The Q&A Helper functionality has been removed from the UI.
 * The following code related to the Q&A Helper can be removed later:
 * 
 * 1. The 'processQuestionWithOpenAI' message handler
 * 2. The handlers for 'scanForQuestions' and 'triggerPaiButtons' in the content script
 * 3. Any other Q&A Helper related message handlers
 * 
 * This will require a more thorough code review to remove without breaking existing functionality.
 */

// Track active connections
const activeConnections = new Map();
// Track content script readiness by tab ID
const readyContentScripts = new Map();

// Listen for connection attempts from content scripts
chrome.runtime.onConnect.addListener(port => {
  console.log(`[Creamy Debug] [background]: New connection established from ${port.name}`);
  
  // Store the connection with a timestamp
  const connectionId = `${port.name}-${Date.now()}`;
  activeConnections.set(connectionId, {
    port: port,
    timestamp: Date.now(),
    lastActivity: Date.now()
  });
  
  // Send acknowledgment
  try {
    port.postMessage({ 
      action: 'connected', 
      message: 'Background script connected successfully',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error(`[Creamy Error] [connection]: Failed to acknowledge connection: ${error.message}`);
  }
  
  // Set up message listener for this connection
  port.onMessage.addListener(message => {
    // Update last activity time
    const connection = activeConnections.get(connectionId);
    if (connection) {
      connection.lastActivity = Date.now();
    }
    
    // Handle content script ready message
    if (message.action === 'contentScriptReady') {
      // Store the tab as having a ready content script
      if (port.sender && port.sender.tab && port.sender.tab.id) {
        readyContentScripts.set(port.sender.tab.id, {
          url: message.url,
          timestamp: Date.now()
        });
        console.log(`[Creamy Debug] [readiness]: Content script ready in tab ${port.sender.tab.id}`);
      }
    }
    
    // Handle heartbeat messages
    if (message.action === 'heartbeat') {
      // Respond to heartbeat to keep connection alive
      try {
        port.postMessage({ 
          action: 'heartbeat-response', 
          timestamp: Date.now(),
          received: message.timestamp
        });
      } catch (error) {
        console.error(`[Creamy Error] [heartbeat]: Failed to respond to heartbeat: ${error.message}`);
      }
    }
    
    // Handle other messages as needed
    console.log(`[Creamy Debug] [port-message]: Received message from content script: ${JSON.stringify(message)}`);
  });
  
  // Handle disconnection
  port.onDisconnect.addListener(() => {
    console.log(`[Creamy Debug] [background]: Connection ${connectionId} disconnected`);
    // Remove from active connections
    activeConnections.delete(connectionId);
    
    // Remove from ready content scripts if this is the tab's connection
    if (port.sender && port.sender.tab && port.sender.tab.id) {
      readyContentScripts.delete(port.sender.tab.id);
    }
    
    // Check for error
    if (chrome.runtime.lastError) {
      console.error(`[Creamy Error] [connection]: Port disconnected with error: ${chrome.runtime.lastError.message}`);
    }
  });
});

// Function to check if a content script is ready in a tab
function isContentScriptReady(tabId) {
  return readyContentScripts.has(tabId);
}

// Function to ensure a content script is ready before proceeding
function ensureContentScriptReady(tabId) {
  return new Promise((resolve, reject) => {
    // If we already know it's ready, resolve immediately
    if (isContentScriptReady(tabId)) {
      resolve(true);
      return;
    }
    
    // Otherwise, ask the content script directly
    chrome.tabs.sendMessage(tabId, { action: 'checkContentScriptReady' }, response => {
      if (chrome.runtime.lastError) {
        // If there was an error, the content script may not be injected yet
        reject(new Error(`Content script not ready: ${chrome.runtime.lastError.message}`));
        return;
      }
      
      // If we got a valid response, update our tracking and resolve
      if (response && response.ready === true) {
        readyContentScripts.set(tabId, {
          timestamp: Date.now()
        });
        resolve(true);
      } else {
        reject(new Error('Content script reports not ready'));
      }
    });
  });
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Track when content scripts report as ready
  if (message.action === 'contentScriptReady' && sender.tab) {
    readyContentScripts.set(sender.tab.id, {
      url: sender.url,
      timestamp: Date.now()
    });
    sendResponse({success: true});
    return true;
  }
  
  // Handle requests to check if a content script is ready
  if (message.action === 'isContentScriptReady') {
    const tabId = message.tabId;
    if (!tabId) {
      sendResponse({ready: false, error: 'No tab ID provided'});
      return true;
    }
    
    const isReady = readyContentScripts.has(tabId);
    console.log(`[Creamy Debug] [readiness-check]: Tab ${tabId} readiness: ${isReady}`);
    
    // If not ready, try to inject the content script
    if (!isReady) {
      try {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[Creamy Warning] [script-injection]: Failed to inject content script: ${chrome.runtime.lastError.message}`);
          } else {
            console.log(`[Creamy Debug] [script-injection]: Content script injected in tab ${tabId}`);
          }
          
          // Still respond with current readiness state
          sendResponse({ready: isReady});
        });
        return true; // Will send response asynchronously
      } catch (error) {
        console.error(`[Creamy Error] [script-injection]: ${error.message}`);
        sendResponse({ready: isReady, error: error.message});
        return true;
      }
    }
    
    sendResponse({ready: isReady});
    return true;
  }
  
  // Handle requests to relay messages to content scripts
  if (message.action === 'relayToContentScript') {
    const tabId = message.tabId;
    const contentMessage = message.message;
    
    if (!tabId || !contentMessage) {
      sendResponse({error: 'Missing tabId or message'});
      return true;
    }
    
    // Try to send the message to the content script
    chrome.tabs.sendMessage(tabId, contentMessage, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`[Creamy Error] [relay]: ${chrome.runtime.lastError.message}`);
        sendResponse({error: chrome.runtime.lastError.message});
      } else {
        sendResponse(response);
      }
    });
    
    return true; // Will send response asynchronously
  }
  
  // Handle captureVisibleTab action for OCR
  if (message.action === 'captureVisibleTab') {
    console.log('[Creamy Debug] [screenshot]: Capturing visible tab');
    
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 }, dataUrl => {
        if (chrome.runtime.lastError) {
          console.error('[Creamy Error] [screenshot]:', chrome.runtime.lastError);
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        
        if (!dataUrl) {
          console.error('[Creamy Error] [screenshot]: No data URL returned');
          sendResponse({ error: 'Failed to capture screenshot' });
          return;
        }
        
        console.log('[Creamy Debug] [screenshot]: Screenshot captured successfully');
        sendResponse({ dataUrl: dataUrl });
      });
    } catch (error) {
      console.error('[Creamy Error] [screenshot]:', error);
      sendResponse({ error: `Screenshot capture failed: ${error.message}` });
    }
    
    return true; // Keep the message channel open for asynchronous response
  }
  
  // If message requires a ready content script
  if (['enableRegionSelection', 'captureVisibleTab', 'processImageWithOpenAI'].includes(message.action)) {
    // Check if content script is ready
    const tabId = sender.tab ? sender.tab.id : null;
    
    if (tabId && !isContentScriptReady(tabId)) {
      console.warn(`[Creamy Warning] [messaging]: Content script not ready for action ${message.action} in tab ${tabId}`);
      sendResponse({error: 'Content script not ready. Please refresh the page and try again.'});
      return true;
    }
  }
  
  // Handle Question Answer Request
  if (message.action === 'getQuestionAnswer') {
    console.log('[Creamy Debug] [question-answer]: Processing question answer request');
    
    chrome.storage.local.get('openaiApiKey', async (data) => {
      const apiKey = data.openaiApiKey;
      
      if (!apiKey) {
        console.error('[Creamy Error] [question-answer]: No OpenAI API key set');
        sendResponse({ error: 'Please set your OpenAI API key in the extension settings.' });
        return;
      }
      
      try {
        // Extract question data
        const { questionNumber, questionText, options } = message.questionData;
        
        if (!questionText) {
          sendResponse({ error: 'No question text provided' });
          return;
        }
        
        console.log(`[Creamy Debug] [question-answer]: Processing Question ${questionNumber}`);
        console.log(`[Creamy Debug] [question-answer]: Question text: ${questionText.substring(0, 100)}...`);
        
        // Format options for the prompt if available
        let optionsText = '';
        if (options && options.length > 0) {
          optionsText = '\n\nOptions:\n' + options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('\n');
        }
        
        // Build the prompt for OpenAI
        const prompt = `I need the correct answer to this question:

Question ${questionNumber}: ${questionText}${optionsText}

Please provide the answer in a clear, concise format. If this is a multiple choice question, specify which option is correct (A, B, C, etc.) and explain why. If it's not multiple choice, provide the direct answer.`;
        
        console.log(`[Creamy Debug] [question-answer]: Sending request to OpenAI API`);
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { 
                role: 'system', 
                content: 'You are an expert tutor that provides accurate, clear, and concise answers to questions. Your answers should be straightforward and focused on providing the correct answer with a brief explanation of why it is correct if you see options just tell me correct one same goes for blank MCQs'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            max_tokens: 500,
            temperature: 0.3
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Creamy Error] [question-answer]: API returned status ${response.status}: ${errorText}`);
          sendResponse({ error: `OpenAI API Error (${response.status}): ${errorText}` });
          return;
        }
        
        const data = await response.json();
        
        if (data.choices && data.choices.length > 0) {
          const answer = data.choices[0].message.content;
          console.log(`[Creamy Debug] [question-answer]: Successfully received answer (${answer.length} chars)`);
          
          // Send response back to content script
          sendResponse({ answer: answer, success: true });
        } else {
          console.error('[Creamy Error] [question-answer]: No content in API response', data);
          sendResponse({ error: 'Failed to get content from OpenAI API' });
        }
      } catch (error) {
        console.error('[Creamy Error] [question-answer]:', error);
        sendResponse({ error: `Error processing question: ${error.message}` });
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  // Handle processImageWithOpenAI - region selection OCR
  if (message.action === 'processImageWithOpenAI') {
    console.log('[Creamy Debug] [ocr]: Processing image from region selection');
    
    // Get the tab ID from the sender if available
    const tabId = sender.tab ? sender.tab.id : null;
    
    // Check if we have a position property (for displaying the result)
    const position = message.position || null;
    
    // Log information about the request for debugging
    console.log('[Creamy Debug] [ocr]: Request details:', {
      hasImageData: !!message.imageData,
      imageDataLength: message.imageData ? message.imageData.length : 0,
      position: position,
      tabId: tabId
    });
    
    // Forward to the existing analyzeImageWithOpenAI handler with some modifications
    chrome.storage.local.get('openaiApiKey', async (data) => {
      const apiKey = data.openaiApiKey;
      if (!apiKey) {
        console.error('[Creamy Error] [ocr]: No OpenAI API key set');
        sendResponse({ error: 'Please set your OpenAI API key in the extension settings.' });
        return;
      }
      
      try {
        console.log('[Creamy Debug] [ocr]: Starting OCR with OpenAI');
        
        if (!message.imageData) {
          console.error('[Creamy Error] [ocr]: No image data provided');
          sendResponse({ error: 'No image data provided' });
          return;
        }
        
        // Ensure the imageData is in correct data URL format
        let imageUrl = message.imageData;
        if (!imageUrl.startsWith('data:')) {
          // If it's raw base64, convert it to a data URL
          imageUrl = `data:image/jpeg;base64,${imageUrl}`;
        }
        
        // Calculate image size from base64 data to check if it's within limits
        const imageSizeInBytes = Math.ceil((imageUrl.length * 3) / 4);
        const imageSizeInMB = imageSizeInBytes / (1024 * 1024);
        
        console.log(`[Creamy Debug] [ocr]: Image size approximately ${imageSizeInMB.toFixed(2)} MB`);
        
        if (imageSizeInMB > 20) {
          sendResponse({ error: `Image too large (${imageSizeInMB.toFixed(2)} MB). OpenAI has a 20MB limit.` });
          return;
        }
        
        // Use a more comprehensive prompt that extracts text AND provides an answer/analysis
        console.log('[Creamy Debug] [ocr]: Sending request to OpenAI API');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { 
                role: 'system', 
                content: 'You are a brilliant undergraduate student with exceptionally high IQ and deep knowledge across multiple disciplines. You excel at solving problems, answering questions accurately, and explaining complex topics clearly. When presented with questions or problems, you provide direct, accurate answers rather than just analyzing what you see. You have a knack for quickly understanding the context and requirements of any academic question.'
              },
              {
                role: 'user',
                content: [
                  { 
                    type: 'text', 
                    text: 'Look at this image and answer any question or solve any problem it contains. Don\'t just describe what you see or analyze the content - focus on providing the correct answer or solution directly. If there\'s a question or problem, I need your best answer as a brilliant student.'
                  },
                  {
                    type: 'image_url',
                    image_url: { 
                      url: imageUrl 
                    }
                  }
                ]
              }
            ],
            max_tokens: 4000
          })
        });

        console.log('[Creamy Debug] [ocr]: API response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Creamy Error] [ocr]: API returned status ${response.status}: ${errorText}`);
          
          // Check for OpenAI content policy rejection messages
          if (errorText.includes("content policy") || 
              errorText.includes("real people") || 
              errorText.includes("content management") ||
              response.status === 400) {
            console.log('[Creamy Debug] [ocr]: Detected possible content policy rejection');
            
            sendResponse({ 
              error: `OpenAI Content Policy Alert: The selected image appears to contain people or other content that OpenAI's services cannot process due to their content policies. 
              
Please try selecting a region without people or try a different image.`,
              isPolicyError: true
            });
            return;
          }
          
          sendResponse({ error: `OpenAI API Error (${response.status}): ${errorText}` });
          return;
        }

        const data = await response.json();
        console.log('[Creamy Debug] [ocr]: API response data:', data);
        
        // Check for content policy messages in the response text
        if (data.choices && data.choices.length > 0) {
          const result = data.choices[0].message.content;
          
          // Check if the response contains content policy rejection messages
          if (result.includes("can't process") && 
             (result.includes("real people") || result.includes("content policy"))) {
            console.log('[Creamy Debug] [ocr]: Detected content policy message in response text');
            
            sendResponse({ 
              error: `OpenAI Content Policy Alert: The selected image appears to contain people or other content that OpenAI's services cannot process due to their content policies.
              
Please try selecting a region without people or try a different image.`,
              isPolicyError: true
            });
            return;
          }
          
          console.log(`[Creamy Debug] [ocr]: Successfully received OCR text and analysis (${result.length} chars)`);
          
          // Send response back to content script
          sendResponse({ text: result, success: true });
          
          // If we have tab ID and position, we can also send a message directly to the content script
          // This is an alternative method in case the sendResponse doesn't work well
          if (tabId) {
            try {
              chrome.tabs.sendMessage(tabId, {
                action: 'ocrResult',
                text: result,
                position: position
              });
            } catch (err) {
              console.error('[Creamy Error] [ocr]: Failed to send message to tab', err);
            }
          }
        } else {
          console.error('[Creamy Error] [ocr]: No content in API response', data);
          sendResponse({ error: 'Failed to get content from OpenAI API' });
        }
      } catch (error) {
        console.error('[Creamy Error] [ocr]:', error);
        sendResponse({ error: `Error analyzing image: ${error.message}` });
      }
    });
    return true; // Keep the message channel open for asynchronous response
  }

  
  


  // Add a handler for getSolution action
  if (message.action === 'getSolution') {
    console.log('[Creamy Debug] [get-solution]: Processing solution request for text input');
    
    chrome.storage.local.get('openaiApiKey', async (data) => {
      const apiKey = data.openaiApiKey;
      
      if (!apiKey) {
        console.error('[Creamy Error] [openai-solution]: No OpenAI API key set');
        sendResponse({ error: 'Please set your OpenAI API key in the extension settings.' });
        return;
      }
      
      try {
        const question = message.question;
        
        if (!question || question.trim().length === 0) {
          sendResponse({ error: 'No question text provided' });
          return;
        }
        
        console.log('[Creamy Debug] [openai-solution]: Sending question to OpenAI');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { 
                role: 'system', 
                content: 'You are a brilliant undergraduate student with exceptionally high IQ and deep knowledge across multiple disciplines. You excel at solving problems, answering questions accurately, and explaining complex topics clearly. When presented with questions or problems, you provide direct, accurate answers rather than just analyzing what you see. You have a knack for quickly understanding the context and requirements of any academic question.'
              },
              {
                role: 'user',
                content: question
              }
            ],
            max_tokens: 1500
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          sendResponse({ error: `OpenAI API Error: ${errorText}` });
          return;
        }

        const data = await response.json();
        
        if (data.choices && data.choices.length > 0) {
          const solution = data.choices[0].message.content;
          sendResponse({ solution: solution, success: true });
        } else {
          sendResponse({ error: 'Failed to get content from OpenAI API' });
        }
      } catch (error) {
        sendResponse({ error: `Error processing question: ${error.message}` });
      }
    });
    
    return true; // Keep messaging channel open for async response
  }

  // Handler for processQuestionWithOpenAI (CREAM button functionality)
  if (message.action === 'processQuestionWithOpenAI') {
    console.log('[Creamy Debug] [cream-analysis]: Processing question with OpenAI');
    
    chrome.storage.local.get('openaiApiKey', async (data) => {
      const apiKey = data.openaiApiKey;
      
      if (!apiKey) {
        console.error('[Creamy Error] [cream-analysis]: No OpenAI API key set');
        sendResponse({ error: 'Please set your OpenAI API key in the extension settings.' });
        return;
      }
      
      try {
        // Extract the question data
        const { question, options, fullText, contextText, images } = message.questionData;
        
        if (!question || (!fullText && !contextText)) {
          console.error('[Creamy Error] [cream-analysis]: Insufficient question data provided');
          sendResponse({ error: 'Insufficient question data provided' });
          return;
        }
        
        // Format the prompt for OpenAI - use contextText if available for better context
        let promptText = contextText || fullText || question;
        
        // If we have options but not in the prompt already, format them nicely
        if (options && options.length > 0 && !promptText.includes("Options:")) {
          promptText += "\n\nOptions:\n" + options.map((opt, i) => `${i+1}) ${opt}`).join("\n");
        }
        
        // Log the prompt length and if images are included
        const imageCount = images ? images.length : 0;
        console.log(`[Creamy Debug] [cream-analysis]: Sending to OpenAI (${promptText.length} chars text, ${imageCount} images): ${promptText.substring(0, 200)}...`);
        
        // Check if this question requires external knowledge
        const forceAnswer = message.questionData.forceAnswer || false;
        
        // Improved system prompt (kept the same as before)
        const systemPrompt = forceAnswer ? 
        `You are a brilliant undergraduate student with exceptional knowledge across many fields including history, science, geography, literature, mathematics, and other academic subjects. You have a talent for answering questions clearly and accurately.

Your approach:
1. Draw from your broad knowledge base to provide well-reasoned, accurate answers
2. For questions referencing external content you don't have direct access to, use contextual clues and logical reasoning
3. For hypothetical questions, provide thoughtful analysis based on relevant principles and theories
4. Always provide a specific answer rather than disclaimers about missing information
5. Think creatively and analytically about the subject matter

Format your response as follows:
- Analyze the question with a clear, confident approach
- Consider each option carefully using your knowledge of the subject matter
- Conclude with "Suggested Answer: Option X" (where X is the number)

Remember: The user needs your best assessment based on your knowledge as a top student. You're known for your ability to excel on exams and assignments.` 
        : 
        `You are a brilliant undergraduate student with exceptional knowledge across many fields including history, science, geography, literature, mathematics, and other academic subjects. You have a talent for answering questions clearly and accurately.

Your approach:
1. Draw from your broad knowledge base to provide well-reasoned, accurate answers
2. Analyze the question carefully, considering all information provided in the question and context
3. For hypothetical scenarios, apply relevant principles and theories to reach a logical conclusion
4. Think critically about each answer option before making your selection
5. Be precise and direct when identifying the correct answer

Format your response as follows:
- Start with a clear analysis of the question
- Explain your reasoning using facts and concepts from the relevant field
- Conclude with "Suggested Answer: Option X" (where X is the number)

If the information in the question is genuinely insufficient to determine an answer, briefly explain why, but still provide your best educated guess as a top student would on an exam.`;

        // Always use GPT-4o regardless of context length
        const model = 'gpt-4o';

        // --- START OpenAI MESSAGE CONSTRUCTION ---
        const messages = [
          { 
            role: 'system', 
            content: systemPrompt
          },
          {
            role: 'user',
            // Content will be populated below
            content: [] // Initialize as an array for multi-modal input
          }
        ];

        // Add the main text prompt first
        messages[1].content.push({ 
          type: 'text', 
          text: `What is the correct answer to this question? Analyze it carefully and completely. If there isn't enough information to determine the answer with certainty, explain what's missing.\n\n${promptText}` 
        });

        // --- START IMAGE FETCHING AND PROCESSING ---
        let imageFetchPromises = [];
        if (images && images.length > 0) {
          console.log(`[Creamy Debug] [cream-analysis]: Fetching ${images.length} images...`);
          imageFetchPromises = images.map(async (imageUrl) => {
            if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
              try {
                // Fetch the image using the background script's context
                const response = await fetch(imageUrl);
                if (!response.ok) {
                  throw new Error(`Failed to fetch image ${imageUrl}: ${response.status} ${response.statusText}`);
                }
                const blob = await response.blob();
                
                // Convert blob to base64 data URL
                return new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    // Ensure the result is a valid data URL string
                    if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
                      // Basic size check (OpenAI limit is 20MB)
                      const imageSizeInMB = (reader.result.length * 3 / 4) / (1024 * 1024);
                      if (imageSizeInMB > 19.5) { // Leave a small margin
                        console.warn(`[Creamy Warning] [cream-analysis]: Image ${imageUrl} (${imageSizeInMB.toFixed(2)}MB) exceeds size limit, skipping.`);
                        resolve(null); // Resolve with null to indicate skip
                      } else {
                        resolve(reader.result); // Resolve with the data URL
                      }
                    } else {
                      reject(new Error(`Failed to read image ${imageUrl} as data URL.`));
                    }
                  };
                  reader.onerror = (error) => reject(error);
                  reader.readAsDataURL(blob);
                });
              } catch (error) {
                console.error(`[Creamy Error] [cream-analysis]: Error fetching image ${imageUrl}:`, error);
                return null; // Return null on fetch error
              }
            } else {
              console.warn(`[Creamy Warning] [cream-analysis]: Skipping invalid or non-http image URL: ${imageUrl}`);
              return null; // Return null for invalid URLs
            }
          });
        }
        
        // Wait for all image fetches to complete
        const imageDataUrls = (await Promise.all(imageFetchPromises)).filter(url => url !== null);
        console.log(`[Creamy Debug] [cream-analysis]: Successfully fetched and converted ${imageDataUrls.length} images to data URLs.`);
        // --- END IMAGE FETCHING AND PROCESSING ---

        // Add the fetched image data URLs to the messages
        if (imageDataUrls.length > 0) {
          imageDataUrls.forEach(dataUrl => {
            messages[1].content.push({
              type: 'image_url',
              image_url: { 
                url: dataUrl,
                // Optional: Set detail level if needed (e.g., 'low' for large images)
                // detail: "auto"
              } 
            });
          });
          console.log(`[Creamy Debug] [cream-analysis]: Added ${imageDataUrls.length} data URLs to the OpenAI request.`);
        } else if (images && images.length > 0) {
          console.warn(`[Creamy Warning] [cream-analysis]: Failed to fetch any valid images from the provided URLs.`);
          // If images were expected but none fetched, send only text
          messages[1].content = messages[1].content[0].text;
        } else {
          // If no images were ever present, send only text
          messages[1].content = messages[1].content[0].text;
        }
        // --- END OpenAI MESSAGE CONSTRUCTION ---
        
        // Increase max_tokens if images are present
        const maxTokens = imageDataUrls.length > 0 ? 2000 : 800;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: messages, // Use the constructed messages array
            max_tokens: maxTokens, // Adjusted max_tokens
            temperature: 0.1
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Creamy Error] [cream-analysis]: API returned status ${response.status}: ${errorText}`);
          sendResponse({ error: `OpenAI API Error (${response.status}): ${errorText}` });
          return;
        }
        
        const data = await response.json();
        
                if (data.choices && data.choices.length > 0) {
          const analysis = data.choices[0].message.content;
          
          console.log(`[Creamy Debug] [cream-analysis]: Successfully received analysis (${analysis.length} chars)`);
          
          // Try to extract suggested option from the analysis using multiple patterns
          let suggestedOption = null;
          
          // Pattern 1: Look for "Suggested Answer: Option X" format
          const suggestedMatch = analysis.match(/Suggested Answer: Option (\d+|[A-D])/i);
          if (suggestedMatch && suggestedMatch[1]) {
            suggestedOption = suggestedMatch[1];
          } 
          // Pattern 2: Look for "The answer is option X" format
          else {
            const answerIsMatch = analysis.match(/The answer is(?: option)? (\d+|[A-D])/i) || 
                                 analysis.match(/correct(?:| answer| option) is (\d+|[A-D])/i);
            if (answerIsMatch && answerIsMatch[1]) {
              suggestedOption = answerIsMatch[1];
            }
          }
          
          // Convert letter options to numbers if needed
          if (suggestedOption && /^[A-D]$/i.test(suggestedOption)) {
            suggestedOption = suggestedOption.toUpperCase().charCodeAt(0) - 64; // A=1, B=2, etc.
          } else if (suggestedOption) {
            suggestedOption = parseInt(suggestedOption);
          }
          
          console.log(`[Creamy Debug] [cream-analysis]: Extracted suggested option: ${suggestedOption}`);
          
          // Send the analysis back to the content script
          sendResponse({ 
            answer: analysis, 
            suggestedOption: suggestedOption,
            success: true,
            timestamp: Date.now()
          });
        } else {
          console.error('[Creamy Error] [cream-analysis]: No content in API response', data);
          sendResponse({ error: 'Failed to get content from OpenAI API' });
        }
      } catch (error) {
        console.error('[Creamy Error] [cream-analysis]:', error);
        sendResponse({ error: `Error analyzing question: ${error.message}` });
      }
    });
    
    return true; // Keep message channel open for async response
  }

  // Handle other messages
  // ... existing message handling code ...
});

// Every 5 minutes, clean up stale connections and readiness data
setInterval(() => {
  const now = Date.now();
  
  // Clean up active connections
  activeConnections.forEach((connection, id) => {
    // If no activity for more than 10 minutes, consider it stale
    if (now - connection.lastActivity > 10 * 60 * 1000) {
      console.log(`[Creamy Debug] [background]: Cleaning up stale connection ${id}`);
      try {
        connection.port.disconnect();
      } catch (error) {
        // Ignore errors when disconnecting
      }
      activeConnections.delete(id);
    }
  });
  
  // Clean up stale readiness data (tabs that haven't been active for over 30 minutes)
  readyContentScripts.forEach((data, tabId) => {
    if (now - data.timestamp > 30 * 60 * 1000) {
      readyContentScripts.delete(tabId);
    }
  });
}, 5 * 60 * 1000);

// Debugging utilities
function logError(source, error) {
  console.error(`[Creamy Error] [${source}]:`, error);
  // Optionally log to storage for later review
  chrome.storage.local.get('errorLogs', data => {
    const logs = data.errorLogs || [];
    logs.push({
      timestamp: new Date().toISOString(),
      source: source,
      error: typeof error === 'object' ? (error.message || JSON.stringify(error)) : error
    });
    // Keep only the last 20 errors
    if (logs.length > 20) logs.shift();
    chrome.storage.local.set({ errorLogs: logs });
  });
}

// Context menu for Scan to Solve4
// First remove any existing items to prevent duplicates
try {
  chrome.contextMenus.removeAll(() => {
    // Then create the menu item
    try {
      chrome.contextMenus.create({
        id: "scanToSolve",
        title: "Scan to Solve",
        contexts: ["selection", "image"]
      });
    } catch (error) {
      logError('context-menu-create', error);
    }
  });
      } catch (error) {
  logError('context-menu-removeAll', error);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "scanToSolve") {
    if (info.selectionText) {
      // Send the selected text directly to the getSolution handler in the current background script
      // This avoids the message port issue by keeping communication within the background script
      console.log('[Creamy Debug] [context-menu]: Processing selected text:', info.selectionText);
      
    chrome.storage.local.get('openaiApiKey', async (data) => {
        try {
      const apiKey = data.openaiApiKey;
          
      if (!apiKey) {
            console.error('[Creamy Error] [context-menu]: No OpenAI API key set');
            chrome.runtime.sendMessage({ 
              action: 'showScanResult', 
              error: 'Please set your OpenAI API key in the extension settings.' 
            });
        return;
      }
      
          // Process the text with OpenAI
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
              model: 'gpt-4o',
            messages: [
              { 
                role: 'system', 
                  content: 'You are a brilliant undergraduate student with exceptionally high IQ and deep knowledge across multiple disciplines. You excel at solving problems, answering questions accurately, and explaining complex topics clearly. When presented with questions or problems, you provide direct, accurate answers rather than just analyzing what you see. You have a knack for quickly understanding the context and requirements of any academic question.'
              },
              {
                role: 'user',
                  content: info.selectionText
                }
              ],
              max_tokens: 1500
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
            chrome.runtime.sendMessage({ 
              action: 'showScanResult', 
              error: `OpenAI API Error: ${errorText}` 
            });
          return;
        }
        
        const data = await response.json();
          
        if (data.choices && data.choices.length > 0) {
            const solution = data.choices[0].message.content;
            chrome.runtime.sendMessage({ 
              action: 'showScanResult', 
              solution: solution
            });
        } else {
            chrome.runtime.sendMessage({ 
              action: 'showScanResult', 
              error: 'Failed to get content from OpenAI API' 
            });
        }
      } catch (error) {
          console.error('[Creamy Error] [context-menu]:', error);
          chrome.runtime.sendMessage({ 
            action: 'showScanResult', 
            error: `Error processing text: ${error.message}` 
          });
        }
      });
      
    } else if (info.srcUrl) {
      // For images, use direct OpenAI Vision analysis
      fetch(info.srcUrl)
        .then(response => response.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            const imageData = reader.result;
            
            console.log('[Creamy Debug] [context-menu]: Using OpenAI Vision for image analysis');
            
            // Process with OpenAI Vision API
            analyzeImageWithOpenAI(imageData);
            
            // Function to process image with OpenAI Vision
            function analyzeImageWithOpenAI(imageData) {
              chrome.storage.local.get('openaiApiKey', async (data) => {
                const apiKey = data.openaiApiKey;
                
                if (!apiKey) {
                  console.error('[Creamy Error] [openai-vision]: No OpenAI API key set');
                  chrome.runtime.sendMessage({ 
                    action: 'showScanResult', 
                    error: 'Please set your OpenAI API key in the extension settings.' 
                  });
        return;
      }
      
      try {
                  console.log('[Creamy Debug] [openai-vision]: Starting analysis with OpenAI');
        
        // Ensure the imageData is in correct data URL format
                  let imageUrl = imageData;
        if (!imageUrl.startsWith('data:')) {
          // If it's raw base64, convert it to a data URL
          imageUrl = `data:image/jpeg;base64,${imageUrl}`;
        }
        
                  // Calculate image size from base64 data to check if it's within limits
                  const imageSizeInBytes = Math.ceil((imageUrl.length * 3) / 4);
                  const imageSizeInMB = imageSizeInBytes / (1024 * 1024);
                  
                  console.log(`[Creamy Debug] [openai-vision]: Image size approximately ${imageSizeInMB.toFixed(2)} MB`);
                  
                  if (imageSizeInMB > 20) {
                    chrome.runtime.sendMessage({ 
                      action: 'showScanResult', 
                      error: `Image too large (${imageSizeInMB.toFixed(2)} MB). OpenAI has a 20MB limit.` 
              });
              return;
                  }
                  
                  // Send to OpenAI Vision API
                  console.log('[Creamy Debug] [openai-vision]: Sending request to OpenAI API');
                  const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
                      'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                          content: 'You are a brilliant undergraduate student with exceptionally high IQ and deep knowledge across multiple disciplines. You excel at solving problems, answering questions accurately, and explaining complex topics clearly. When presented with questions or problems, you provide direct, accurate answers rather than just analyzing what you see. You have a knack for quickly understanding the context and requirements of any academic question.'
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                              text: 'Look at this image and answer any question or solve any problem it contains. Don\'t just describe what you see or analyze the content - focus on providing the correct answer or solution directly. If there\'s a question or problem, I need your best answer as a brilliant student.'
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: imageUrl
                      }
                    }
                  ]
                }
              ],
                      max_tokens: 4000
            })
          });
          
                  console.log('[Creamy Debug] [openai-vision]: API response status:', response.status);
                  
                  if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`[Creamy Error] [openai-vision]: API returned status ${response.status}: ${errorText}`);
                    
                    // Check for OpenAI content policy rejection messages
                    if (errorText.includes("content policy") || 
                        errorText.includes("real people") || 
                        errorText.includes("content management") ||
                        response.status === 400) {
                      console.log('[Creamy Debug] [openai-vision]: Detected possible content policy rejection');
                      
                      chrome.runtime.sendMessage({ 
                        action: 'showScanResult', 
                        error: `OpenAI Content Policy Alert: The selected image appears to contain people or other content that OpenAI's services cannot process due to their content policies.
                        
Please try selecting a region without people or try a different image.`,
                        isPolicyError: true
                      });
            return;
          }
          
                    chrome.runtime.sendMessage({ 
                      action: 'showScanResult', 
                      error: `OpenAI API Error (${response.status}): ${errorText}` 
                    });
                    return;
                  }
                  
                  const data = await response.json();
                  console.log('[Creamy Debug] [openai-vision]: API response data:', data);
                  
                  // Check for content policy messages in the response text
                  if (data.choices && data.choices.length > 0) {
                    const result = data.choices[0].message.content;
                    
                    // Check if the response contains content policy rejection messages
                    if (result.includes("can't process") && 
                      (result.includes("real people") || result.includes("content policy"))) {
                      console.log('[Creamy Debug] [openai-vision]: Detected content policy message in response text');
                      
                      chrome.runtime.sendMessage({ 
                        action: 'showScanResult', 
                        error: `OpenAI Content Policy Alert: The selected image appears to contain people or other content that OpenAI's services cannot process due to their content policies.
                        
Please try selecting a region without people or try a different image.`,
                        isPolicyError: true
                      });
                      return;
                    }
                    
                    console.log(`[Creamy Debug] [openai-vision]: Successfully received analysis (${result.length} chars)`);
                    
                    // Send the result to show in the UI
                    chrome.runtime.sendMessage({ 
                      action: 'showScanResult', 
                      solution: result,
                      success: true 
                    });
        } else {
                    console.error('[Creamy Error] [openai-vision]: No content in API response', data);
                    chrome.runtime.sendMessage({ 
                      action: 'showScanResult', 
                      error: 'Failed to get content from OpenAI API' 
                    });
        }
      } catch (error) {
                  console.error('[Creamy Error] [openai-vision]:', error);
                  chrome.runtime.sendMessage({ 
                    action: 'showScanResult', 
                    error: `Error analyzing image: ${error.message}` 
                  });
                }
              });
            }
          };
          reader.readAsDataURL(blob);
        })
        .catch(error => {
          console.error('[Creamy Error] [context-menu-fetch]:', error);
          chrome.runtime.sendMessage({ 
            action: 'showScanResult', 
            error: `Failed to fetch image: ${error.message}` 
          });
        });
    }
  }
});
