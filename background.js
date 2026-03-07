// Fetch with automatic retry on rate limit (429) errors
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0');
      const delay = retryAfter ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 8000);
      console.warn(`[Creamy Warning] [rate-limit]: 429 received, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return response;
  }
}

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

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Track when content scripts report as ready
  if (message.action === 'contentScriptReady' && sender.tab) {
    readyContentScripts.set(sender.tab.id, {
      url: sender.url,
      timestamp: Date.now()
    });
    sendResponse({ success: true });
    return true;
  }

  // Handle requests to check if a content script is ready
  if (message.action === 'isContentScriptReady') {
    const tabId = message.tabId;
    if (!tabId) {
      sendResponse({ ready: false, error: 'No tab ID provided' });
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
          sendResponse({ ready: isReady });
        });
        return true; // Will send response asynchronously
      } catch (error) {
        console.error(`[Creamy Error] [script-injection]: ${error.message}`);
        sendResponse({ ready: isReady, error: error.message });
        return true;
      }
    }

    sendResponse({ ready: isReady });
    return true;
  }

  // Handle requests to relay messages to content scripts
  if (message.action === 'relayToContentScript') {
    const tabId = message.tabId;
    const contentMessage = message.message;

    if (!tabId || !contentMessage) {
      sendResponse({ error: 'Missing tabId or message' });
      return true;
    }

    // Try to send the message to the content script
    chrome.tabs.sendMessage(tabId, contentMessage, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`[Creamy Error] [relay]: ${chrome.runtime.lastError.message}`);
        sendResponse({ error: chrome.runtime.lastError.message });
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

        // Analyze complexity
        const complexityAnalysis = analyzeQuestionComplexity({ question: questionText, options });
        console.log(`[Creamy Debug] [question-answer]: Complexity=${complexityAnalysis.complexity}, reasoning=${complexityAnalysis.reasoningEffort}`);

        console.log(`[Creamy Debug] [question-answer]: Sending request to OpenAI API`);

        // Build request body
        const requestBody = {
          model: 'gpt-5.4',
          reasoning_effort: complexityAnalysis.reasoningEffort,
          messages: [
            {
              role: 'system',
              content: `You are an expert tutor providing accurate, concise answers.

<<output_rules>>
- Default: 1-3 sentences max for simple questions
- For MCQs: State correct option (A/B/C/D) + one-sentence explanation
- For fill-in-blank: Provide the exact answer only
- Never rephrase the question
- No preamble or filler phrases
<</output_rules>>

<<accuracy>>
- If uncertain, state "Based on the provided context..."
- Never fabricate facts
<</accuracy>>`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_completion_tokens: complexityAnalysis.complexity === 'high' ? 1000 : 500
        };

        // Add web search if needed
        if (complexityAnalysis.needsWebSearch) {
          requestBody.tools = [{ type: 'web_search_preview' }];
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
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
            model: 'gpt-5.4',
            reasoning_effort: 'high',
            messages: [
              {
                role: 'system',
                content: `You are a brilliant undergraduate student with exceptional knowledge across multiple disciplines.

<<output_rules>>
- Provide the answer immediately - no preamble
- For questions: 2-4 sentences max unless complexity requires more
- For problems: Show key steps concisely, then final answer
- Translate any non-English content to English
<</output_rules>>

<<behavior>>
- Focus on the correct answer, not describing what you see
- Be direct and confident
- If genuinely uncertain, briefly state why
<</behavior>>`
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
            max_completion_tokens: 4000
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

        // Analyze complexity for dynamic reasoning
        const complexityAnalysis = analyzeQuestionComplexity({ question });
        console.log(`[Creamy Debug] [openai-solution]: Complexity=${complexityAnalysis.complexity}, reasoning=${complexityAnalysis.reasoningEffort}`);

        // Build request body
        const requestBody = {
          model: 'gpt-5.4',
          reasoning_effort: complexityAnalysis.reasoningEffort,
          messages: [
            {
              role: 'system',
              content: `You are a brilliant undergraduate student with exceptional knowledge across multiple disciplines.

<<output_rules>>
- Default: 3-5 sentences for typical answers
- For simple factual questions: 1-2 sentences
- For complex multi-step problems: Brief overview + key steps + final answer
- Be direct - no filler phrases
<</output_rules>>

<<behavior>>
- Provide accurate, well-reasoned answers
- Think critically before answering
- If uncertain, state your confidence level briefly
- Never fabricate specific facts, numbers, or references
<</behavior>>`
            },
            {
              role: 'user',
              content: question
            }
          ],
          max_completion_tokens: complexityAnalysis.complexity === 'high' ? 2500 : 1500
        };

        // Add web search if needed
        if (complexityAnalysis.needsWebSearch) {
          requestBody.tools = [{ type: 'web_search_preview' }];
          console.log('[Creamy Debug] [openai-solution]: Enabling web search');
        }

        console.log('[Creamy Debug] [openai-solution]: Sending question to OpenAI');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
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
        // --- Corrected Data Extraction ---
        // Extract the question data, ensuring 'images' is included
        const { question, options, fullText, contextText, images } = message.questionData;

        if (!question || (!fullText && !contextText)) {
          console.error('[Creamy Error] [cream-analysis]: Insufficient question data provided');
          sendResponse({ error: 'Insufficient question data provided' });
          return;
        }

        // --- Prepare Prompt Text --- 
        // Use contextText if available, otherwise fullText or just question
        let promptText = contextText || fullText || question;
        // Append options if they exist and aren't already in the text
        if (options && options.length > 0 && !promptText.includes("Options:")) {
          promptText += "\n\nOptions:\n" + options.map((opt, i) => `${i + 1}) ${opt}`).join("\n");
        }

        const imageCount = images ? images.length : 0;
        console.log(`[Creamy Debug] [cream-analysis]: Sending to OpenAI (${promptText.length} chars text, ${imageCount} images): ${promptText.substring(0, 200)}...`);

        // Analyze question complexity for dynamic reasoning and web search
        const complexityAnalysis = analyzeQuestionComplexity(message.questionData);
        console.log(`[Creamy Debug] [cream-analysis]: Complexity analysis:`, complexityAnalysis);

        // Check if the question requires external knowledge
        const forceAnswer = message.questionData.forceAnswer || false;

        // --- System Prompt Definition (GPT-5.4 Optimized) ---
        const questionType = message.questionData.questionType || 'multiple_choice';

        let questionTypeRules = '';
        if (questionType === 'fill_in_blank') {
          questionTypeRules = `
- This is a FILL-IN-THE-BLANK question. Do NOT suggest an option number.
- Set suggested_option to null.
- If there is ONE blank: put your answer in fill_in_answer, leave fill_in_answers as empty array.
- If there are MULTIPLE blanks: put each answer in the fill_in_answers array in order (one per blank), set fill_in_answer to null.
- Provide ONLY the text that should go in each blank, nothing extra.`;
        } else if (questionType === 'dropdown') {
          questionTypeRules = `
- This is a DROPDOWN SELECTION question with predefined choices.
- IMPORTANT: NEVER use fill_in_answer or fill_in_answers for dropdown questions. Always use dropdown_answers or suggested_option.
- If there is ONE dropdown: set suggested_option to the 1-indexed option number, leave dropdown_answers as empty array.
- If there are MULTIPLE dropdowns (labeled Dropdown 1, Dropdown 2, etc.): put the EXACT TEXT of the correct choice for each dropdown in the dropdown_answers array in order. Set suggested_option to null.
- Each dropdown has its own independent set of options - choose the correct one for EACH.
- Set fill_in_answer to null and fill_in_answers to empty array.`;
        } else {
          questionTypeRules = `
- End with "Suggested Answer: Option X" (X = number)`;
        }

        const systemPrompt = forceAnswer ?
          `You are a brilliant undergraduate student with exceptional knowledge across all academic subjects.

<<output_rules>>
- Keep analysis to 2-3 sentences max
- Consider each option briefly using subject knowledge${questionTypeRules}
- No disclaimers about missing information - always provide your best answer
<</output_rules>>

<<approach>>
- Draw from broad knowledge for well-reasoned answers
- Use contextual clues and logical reasoning for external references
- Choose the simplest valid interpretation for ambiguous questions
<</approach>>`
          :
          `You are a brilliant undergraduate student with exceptional knowledge across all academic subjects.

<<output_rules>>
- Keep analysis to 2-3 sentences max
- Brief reasoning using relevant facts/concepts${questionTypeRules}
- If information is insufficient, briefly note why but still provide best educated guess
<</output_rules>>

<<approach>>
- Analyze carefully, considering all provided information
- Think critically about each option before selecting
- Be direct when identifying the correct answer
<</approach>>`;

        // Use GPT-5.4
        const model = 'gpt-5.4';

        // --- Construct OpenAI Messages Array ---
        const messages = [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: [] // Initialize content as an array for multi-modal
          }
        ];

        // Add the main text part to the user message content
        messages[1].content.push({
          type: 'text',
          text: `What is the correct answer to this question? Analyze it carefully and completely. If there isn't enough information to determine the answer with certainty, explain what's missing.\n\n${promptText}`
        });

        // --- Image Fetching and Processing --- 
        let imageDataUrls = []; // Initialize array for valid data URLs
        if (images && images.length > 0) {
          console.log(`[Creamy Debug] [cream-analysis]: Fetching ${images.length} images...`);

          const imageFetchPromises = images.map(async (imageUrl) => {
            if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
              try {
                const response = await fetch(imageUrl); // Fetch image
                if (!response.ok) {
                  throw new Error(`Failed to fetch image ${imageUrl}: ${response.status} ${response.statusText}`);
                }
                const blob = await response.blob();

                // Convert blob to base64 data URL
                return new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
                      const imageSizeInMB = (reader.result.length * 3 / 4) / (1024 * 1024);
                      if (imageSizeInMB > 20) { // Check size limit
                        console.warn(`[Creamy Warning] [cream-analysis]: Image ${imageUrl} (${imageSizeInMB.toFixed(2)}MB) exceeds size limit, skipping.`);
                        resolve(null); // Skip large images
                      } else {
                        resolve(reader.result); // Valid data URL
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
                return null; // Null on fetch error
              }
            } else {
              console.warn(`[Creamy Warning] [cream-analysis]: Skipping invalid or non-http image URL: ${imageUrl}`);
              return null; // Null for invalid URLs
            }
          });

          // Wait for all fetches and filter out nulls
          imageDataUrls = (await Promise.all(imageFetchPromises)).filter(url => url !== null);
          console.log(`[Creamy Debug] [cream-analysis]: Successfully fetched and converted ${imageDataUrls.length} images to data URLs.`);
        }

        // --- Add Images to OpenAI Messages (if any) ---
        if (imageDataUrls.length > 0) {
          imageDataUrls.forEach(dataUrl => {
            messages[1].content.push({
              type: 'image_url',
              image_url: {
                url: dataUrl
                // detail: "auto" // Optional detail setting
              }
            });
          });
          console.log(`[Creamy Debug] [cream-analysis]: Added ${imageDataUrls.length} data URLs to the OpenAI request.`);
        } else if (images && images.length > 0) {
          console.warn(`[Creamy Warning] [cream-analysis]: Failed to fetch any valid images from the provided URLs.`);
          // If images were expected but none fetched, ensure content is just text
          messages[1].content = messages[1].content[0].text;
        } else {
          // If no images were ever present, ensure content is just text
          messages[1].content = messages[1].content[0].text;
        }

        // --- Prepare API Call --- 
        // Adjust max_tokens based on complexity and images
        // Higher reasoning = more tokens needed for thinking
        let maxTokens = 800;
        if (imageDataUrls.length > 0) maxTokens = 2000;
        if (complexityAnalysis.complexity === 'high') maxTokens = 3000;
        if (complexityAnalysis.needsWebSearch) maxTokens = 2500;

        // --- Structured Outputs JSON Schema (from OpenAI Cookbook) ---
        // Guarantees the model returns exactly these fields, no regex needed
        const responseSchema = {
          type: "json_schema",
          json_schema: {
            name: "question_answer",
            strict: true,
            schema: {
              type: "object",
              properties: {
                reasoning: {
                  type: "string",
                  description: "2-3 sentence analysis of the question and why you chose this answer"
                },
                suggested_option: {
                  type: ["number", "null"],
                  description: "1-indexed option number for single multiple choice or single dropdown questions. null for fill-in-blank or multi-dropdown."
                },
                fill_in_answer: {
                  type: ["string", "null"],
                  description: "The exact text to fill in for single fill-in-blank questions. null for multiple choice, dropdown, or multi-blank."
                },
                dropdown_answers: {
                  type: "array",
                  items: { type: "string" },
                  description: "For questions with MULTIPLE dropdowns: the exact text of the correct option for each dropdown, in order. Empty array if single dropdown or non-dropdown question."
                },
                fill_in_answers: {
                  type: "array",
                  items: { type: "string" },
                  description: "For questions with MULTIPLE blanks: the exact answer text for each blank, in order. Empty array if single blank or non-fill-in question."
                }
              },
              required: ["reasoning", "suggested_option", "fill_in_answer", "dropdown_answers", "fill_in_answers"],
              additionalProperties: false
            }
          }
        };

        // Build request body with dynamic reasoning effort + structured output
        const requestBody = {
          model: model,
          reasoning_effort: complexityAnalysis.reasoningEffort,
          messages: messages,
          max_completion_tokens: maxTokens,
          response_format: responseSchema
        };

        // Add web search tool if question needs current information
        if (complexityAnalysis.needsWebSearch) {
          requestBody.tools = [{ type: 'web_search_preview' }];
          console.log(`[Creamy Debug] [cream-analysis]: Enabling web search for this question`);
        }

        console.log(`[Creamy Debug] [cream-analysis]: Using reasoning_effort=${complexityAnalysis.reasoningEffort}, maxTokens=${maxTokens}, structured_output=true`);

        const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Creamy Error] [cream-analysis]: API returned status ${response.status}: ${errorText}`);
          sendResponse({ error: `OpenAI API Error (${response.status}): ${errorText}` });
          return;
        }

        const data = await response.json();

        if (data.choices && data.choices.length > 0) {
          const rawContent = data.choices[0].message.content;
          console.log(`[Creamy Debug] [cream-analysis]: Raw structured response: ${rawContent}`);

          let parsed;
          try {
            parsed = JSON.parse(rawContent);
          } catch (parseErr) {
            console.error('[Creamy Error] [cream-analysis]: Failed to parse structured JSON:', parseErr);
            // Fallback: treat rawContent as plain text analysis
            sendResponse({
              answer: rawContent,
              suggestedOption: null,
              fillInAnswer: null,
              questionType: questionType,
              success: true,
              timestamp: Date.now()
            });
            return;
          }

          // Clean structured fields directly from guaranteed JSON schema
          let suggestedOption = parsed.suggested_option;
          if (suggestedOption !== null && suggestedOption !== undefined) {
            suggestedOption = Math.round(suggestedOption); // ensure integer
            if (suggestedOption <= 0) suggestedOption = null;
          }

          let fillInAnswer = parsed.fill_in_answer;
          if (fillInAnswer) {
            fillInAnswer = fillInAnswer.trim();
            if (!fillInAnswer) fillInAnswer = null;
          }

          const displayText = parsed.reasoning || 'No analysis provided.';

          console.log(`[Creamy Debug] [cream-analysis]: Structured result - option: ${suggestedOption}, fill_in: ${fillInAnswer}, reasoning: ${displayText.substring(0, 100)}...`);

          // Send the analysis back to the content script
          sendResponse({
            answer: displayText,
            suggestedOption: suggestedOption,
            fillInAnswer: fillInAnswer,
            dropdownAnswers: parsed.dropdown_answers || [],
            fillInAnswers: parsed.fill_in_answers || [],
            questionType: questionType,
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

// Analyze question complexity to determine reasoning effort and web search need
function analyzeQuestionComplexity(questionData) {
  const { question = '', fullText = '', contextText = '', options = [], images = [] } = questionData;
  const text = (contextText || fullText || question).toLowerCase();

  let complexity = 'simple';
  let needsWebSearch = false;

  // Indicators of complex questions requiring deeper reasoning
  const complexIndicators = [
    /explain\s+(why|how)/i,
    /analyze|evaluate|compare|contrast/i,
    /what\s+(would|could|might)\s+happen/i,
    /calculate|solve|derive|prove/i,
    /multi-?step|step.?by.?step/i,
    /consider\s+all|taking into account/i,
    /implications?|consequences?/i,
    // Code/Programming indicators
    /\b(public|private|protected)\s+(static\s+)?(void|int|string|class)/i,
    /\b(def|function|const|let|var)\s+\w+\s*[=(]/i,
    /\b(for|while|if|else|switch|case|try|catch)\s*\(/i,
    /\b(System\.out|console\.log|print|printf)\b/i,
    /\b(ArrayList|HashMap|List|Map|Array|Object)\b/,
    /\b(return|throw|new|import|package|using)\b/,
    /\breturn\s+\w+;/,
    /\{\s*\n|\}\s*\n/,
    /\b(java|python|javascript|c\+\+|code|program|algorithm|function|method|class)\b/i,
    /what\s+(is|does|will)\s+(the\s+)?(output|result|return)/i,
    /debug|error|exception|bug|fix/i,
  ];

  // Indicators needing current/web information
  const webSearchIndicators = [
    /\b(current|latest|recent|today|now|2024|2025|2026)\b/i,
    /\b(news|update|happened|trending)\b/i,
    /\bwho\s+is\s+the\s+(current|present)\b/i,
    /\b(price|cost|rate)\s+of\b/i,
    /\b(CEO|president|leader)\s+of\b/i,
    /\blatest\s+(version|release|update)\b/i,
  ];

  // Check for complex indicators
  const isComplex = complexIndicators.some(pattern => pattern.test(text));

  // Check for web search need
  needsWebSearch = webSearchIndicators.some(pattern => pattern.test(text));

  // Factors that increase complexity
  const hasImages = images && images.length > 0;
  const hasMultipleOptions = options && options.length > 4;
  const isLongText = text.length > 500;
  const hasMathSymbols = /[∫∑∏√∂∇≈≠≤≥±×÷]|\\frac|\\sqrt|\\int/.test(text);

  // Determine complexity level
  if (hasMathSymbols || (isComplex && isLongText) || (hasImages && isComplex)) {
    complexity = 'high';
  } else if (isComplex || hasImages || hasMultipleOptions || isLongText) {
    complexity = 'medium';
  }

  // Map complexity to reasoning_effort (GPT-5.4 supports: none, low, medium, high, xhigh)
  const reasoningEffortMap = {
    'simple': 'low',
    'medium': 'medium',
    'high': 'high'
  };

  console.log(`[Creamy Debug] [complexity]: Detected complexity=${complexity}, needsWebSearch=${needsWebSearch}`);

  return {
    complexity,
    reasoningEffort: reasoningEffortMap[complexity],
    needsWebSearch,
    hasImages: hasImages
  };
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
              model: 'gpt-5.4',
              reasoning_effort: 'high',
              messages: [
                {
                  role: 'system',
                  content: `You are a brilliant undergraduate student with exceptional knowledge across multiple disciplines.

<<output_rules>>
- Default: 3-5 sentences for typical answers
- For simple factual questions: 1-2 sentences
- For complex problems: Brief overview + key steps + final answer
- Be direct - no filler phrases
<</output_rules>>

<<behavior>>
- Provide accurate, well-reasoned answers
- If uncertain, state confidence level briefly
- Never fabricate specific facts or references
<</behavior>>`
                },
                {
                  role: 'user',
                  content: info.selectionText
                }
              ],
              max_completion_tokens: 1500
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

          const result = await response.json();

          if (result.choices && result.choices.length > 0) {
            const solution = result.choices[0].message.content;
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
                      model: 'gpt-5.4',
                      reasoning_effort: 'high',
                      messages: [
                        {
                          role: 'system',
                          content: `You are a brilliant undergraduate student with exceptional knowledge across multiple disciplines.

<<output_rules>>
- For questions: Provide the answer directly in 2-4 sentences
- For problems: Show key steps concisely, then final answer
- Be direct - no descriptions of what you see unless relevant to the answer
<</output_rules>>

<<behavior>>
- Focus on correct answer/solution, not image description
- If uncertain, state briefly why
- Translate any non-English content to English
<</behavior>>`
                        },
                        {
                          role: 'user',
                          content: [
                            {
                              type: 'text',
                              text: 'Look at this image and answer any question or solve any problem it contains. Provide the correct answer or solution directly.'
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
                      max_completion_tokens: 4000
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
