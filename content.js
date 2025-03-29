// Creamy extension - Content Script
// Handles region selection, screenshot capture, and OCR processing

/*
 * CLEANUP NOTE - Q&A Helper Removal
 * ---------------------------------
 * The Q&A Helper functionality has been removed from the UI in popup.html and popup.js.
 * The following parts of this content script relate to Q&A Helper and can be removed in a future cleanup:
 * 
 * - Functions related to text selection and capture:
 *   - getSelectedText()
 *   - Any handler for 'getSelectedText' message action
 *   - Functions specifically called by the transcript capture feature
 * 
 * - Any variables or functions exclusively used by the transcript functionality
 * 
 * NOTE: A careful code review should be performed before removal to ensure no functionality
 * needed by the OCR and CREAM button features is affected.
 */

// Global variables
let port = null;
let isProcessing = false;
let isContentScriptReady = false; // Track content script readiness

// Logging functions
function logDebug(source, message) {
  console.log(`[Creamy Debug] [${source}]: ${message}`);
}

function logError(source, error) {
  console.error(`[Creamy Error] [${source}]: ${error.message || error}`);
}

// Check if extension is available
function checkRuntimeAvailability() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    logError('runtime', 'Extension context invalidated');
    return false;
  }
  return true;
}

// Setup connection to background script
function setupConnectionPort() {
  // Clear any existing port
  if (port) {
    try {
      port.disconnect();
    } catch (e) {
      // Ignore disconnection errors
    }
    port = null;
  }
  
    if (!checkRuntimeAvailability()) {
      return;
    }
    
  try {
    port = chrome.runtime.connect({name: "content-script"});
    
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
      logDebug('connection', `Port disconnected: ${error ? error.message : 'unknown reason'}`);
        port = null;
      isContentScriptReady = false; // Mark script as not ready when disconnected
      
      // Don't try to reconnect if the extension is being reloaded or uninstalled
      if (checkRuntimeAvailability()) {
        setTimeout(reconnectPort, 1000);
      }
    });
    
    // Add message listener
    port.onMessage.addListener((message) => {
      // Handle incoming messages
      if (message.action === 'ocrResult') {
        handleOCRResult(message.text, message.position);
      } else if (message.action === 'ping') {
        // Respond to ping to confirm content script is ready
        port.postMessage({ action: 'pong', timestamp: Date.now() });
      }
    });
    
    // Notify background script that content script is ready
    port.postMessage({ 
      action: 'contentScriptReady', 
      url: window.location.href,
      timestamp: Date.now() 
    });
    
    isContentScriptReady = true;
    logDebug('connection', 'Connection established with background script');
  } catch (e) {
    logError('connection', e);
    isContentScriptReady = false;
    setTimeout(reconnectPort, 2000);
  }
}

// Reconnect port if disconnected
function reconnectPort() {
  if (!checkRuntimeAvailability()) {
    return;
  }
  
  logDebug('connection', 'Attempting to reconnect port...');
      setupConnectionPort();
}

// Send message to background script
function sendMessageToBackground(message, callback) {
  if (!checkRuntimeAvailability()) {
    if (callback) callback({error: "Extension not available"});
      return;
    }

  if (!isContentScriptReady) {
    if (callback) callback({error: "Content script not ready"});
            return;
          }
          
  try {
    if (port) {
      port.postMessage(message);
      if (callback) callback({success: true});
  } else {
      // Port not ready, try to reconnect
      setupConnectionPort();
          setTimeout(() => {
        if (port) {
          port.postMessage(message);
          if (callback) callback({success: true});
      } else {
          if (callback) callback({error: "Failed to establish connection"});
        }
      }, 500);
    }
  } catch (e) {
    logError('messaging', e);
    if (callback) callback({error: e.message});
  }
}

// Initialize extension
function initializeExtension() {
  logDebug('init', 'Initializing content script');
  
  // Setup connection to background script
  setupConnectionPort();
  
  // Remove keyboard shortcut code (Alt+R)
  // No keyboard shortcut for region selection
  
  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Provide immediate response to readiness checks
    if (message.action === 'checkContentScriptReady') {
      sendResponse({ready: isContentScriptReady});
    return true;
  }
  
    // Handle region selection request
    if (message.action === 'enableRegionSelection') {
      if (isContentScriptReady) {
        enableRegionSelectionMode();
        sendResponse({success: true});
          } else {
        sendResponse({error: "Content script not ready. Please refresh the page and try again."});
      }
    return true;
    }
    
    return false;
  });
  
  // Set a flag that content script is ready
  isContentScriptReady = true;
  
  // Notify that we're ready through a more reliable method
  if (checkRuntimeAvailability()) {
    chrome.runtime.sendMessage({
      action: 'contentScriptReady',
      url: window.location.href,
      timestamp: Date.now()
    });
  }
  
  // Add the floating camera button
  addFloatingCameraButton();
  
  logDebug('init', 'Content script initialized and ready');
}

// Create and show loading indicator
function showLoadingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'ocr-loading-indicator';
  indicator.style.position = 'fixed';
  indicator.style.top = '50%';
  indicator.style.left = '50%';
  indicator.style.transform = 'translate(-50%, -50%)';
  indicator.style.padding = '24px 32px';
  indicator.style.backgroundColor = '#000000';
  indicator.style.color = '#FFFFFF';
  indicator.style.borderRadius = '16px';
  indicator.style.boxShadow = '0 8px 32px rgba(0,0,0,0.25)';
  indicator.style.zIndex = '2147483647';
  indicator.style.display = 'flex';
  indicator.style.flexDirection = 'column';
  indicator.style.alignItems = 'center';
  indicator.style.justifyContent = 'center';
  indicator.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  
  const spinner = document.createElement('div');
  spinner.style.borderRadius = '50%';
  spinner.style.width = '40px';
  spinner.style.height = '40px';
  spinner.style.border = '4px solid rgba(255,255,255,0.1)';
  spinner.style.borderTopColor = '#FFFFFF';
  spinner.style.animation = 'ocr-spinner 1s linear infinite';
  
  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ocr-spinner {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  
  const text = document.createElement('div');
  text.style.marginTop = '16px';
  text.style.fontSize = '16px';
  text.style.fontWeight = '500';
  text.style.color = '#FFFFFF';
  text.textContent = 'Processing...';
  
  indicator.appendChild(spinner);
  indicator.appendChild(text);
  document.body.appendChild(indicator);
  
  return {
    element: indicator,
    text: text
  };
}

// Update loading indicator text
function updateLoadingIndicator(indicator, message) {
  if (!indicator || !indicator.text) return;
  indicator.text.textContent = message;
}

// Hide loading indicator
function hideLoadingIndicator(indicator) {
  if (!indicator || !indicator.element) return;
  
  if (document.body.contains(indicator.element)) {
    document.body.removeChild(indicator.element);
  }
}

// Function to handle OCR result
function handleOCRResult(text, position = {x: window.innerWidth/2, y: window.innerHeight/2}, isError = false, isPolicyError = false) {
  // Create result container
  const resultContainer = document.createElement('div');
  resultContainer.className = 'ocr-result-container';
  resultContainer.style.position = 'fixed';
  resultContainer.style.zIndex = '2147483647';
  resultContainer.style.top = `${position.y}px`;
  resultContainer.style.left = `${position.x}px`;
  resultContainer.style.transform = 'translate(-50%, -50%)';
  resultContainer.style.backgroundColor = '#000000'; // Changed to black
  resultContainer.style.boxShadow = '0 8px 32px rgba(0,0,0,0.25)';
  resultContainer.style.borderRadius = '12px';
  resultContainer.style.maxWidth = '80%';
  resultContainer.style.maxHeight = '80vh';
  resultContainer.style.overflow = 'auto';
  resultContainer.style.padding = '24px';
  resultContainer.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  resultContainer.style.lineHeight = '1.5';
  resultContainer.style.color = '#FFFFFF'; // Changed to white
  
  // Add title
  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.style.fontSize = '22px';
  title.style.marginBottom = '16px';
  title.style.display = 'flex';
  title.style.justifyContent = 'space-between';
  title.style.alignItems = 'center';
  title.style.borderBottom = '1px solid #333333'; // Darker border
  title.style.paddingBottom = '12px';
  
  // Set title text based on result type
  if (isError) {
    title.textContent = isPolicyError ? 'Content Policy Alert' : 'Error';
    title.style.color = isPolicyError ? '#e67e22' : '#e74c3c';
  } else {
    title.textContent = 'Visual Analysis';
    title.style.color = '#FFFFFF'; // Changed to white
  }
  
  // Add close button
  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.background = 'none';
  closeButton.style.border = 'none';
  closeButton.style.fontSize = '28px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.marginLeft = '10px';
  closeButton.style.color = '#9e9ea7';
  closeButton.style.transition = 'color 0.2s';
  closeButton.onmouseover = () => {
    closeButton.style.color = '#FFFFFF'; // Changed to white
  };
  closeButton.onmouseout = () => {
    closeButton.style.color = '#9e9ea7';
  };
  closeButton.onclick = () => {
    if (document.body.contains(resultContainer)) {
      document.body.removeChild(resultContainer);
    }
  };
  
  title.appendChild(closeButton);
  
  // Add content
  const content = document.createElement('div');
  content.style.whiteSpace = 'pre-wrap';
  content.style.wordBreak = 'break-word';
  content.style.fontSize = '16px';
  
  // Style content differently for errors
  if (isError) {
    content.style.padding = '16px';
    content.style.borderRadius = '8px';
    
    if (isPolicyError) {
      // Content policy error styling
      content.style.backgroundColor = '#fff8e6';
      content.style.border = '1px solid #ffe0a6';
      content.style.color = '#7c5e10';
  } else {
      // Regular error styling
      content.style.backgroundColor = '#feeceb';
      content.style.border = '1px solid #fcd0cd';
      content.style.color = '#9a1f11';
    }
    
    content.textContent = text || 'No content found in the image.';
  } else {
    // Process response for better visual analysis display
    // Check if the response contains JSON or structured data
    try {
      // Format HTML content with better styling
      content.style.padding = '16px';
      content.style.backgroundColor = '#111111'; // Changed to dark gray
      content.style.border = '1px solid #333333'; // Darker border
      content.style.borderRadius = '8px';
      
      if (text.includes("VISUAL ANALYSIS:") || text.includes("DETECTED OBJECTS:")) {
        // Enhance formatting for structured content with visual analysis
        let formattedText = text
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#FFFFFF;">$1</strong>') // Changed to white
          .replace(/\n- /g, '<br>• ') // Convert list items to bullets
          .replace(/\n/g, '<br>'); // Convert newlines to <br>
        
        // Highlight section titles
        formattedText = formattedText
          .replace(/(VISUAL ANALYSIS:)/g, '<h2 style="font-size: 18px; margin: 16px 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #333333; color: #FFFFFF;">$1</h2>') // Changed to white
          .replace(/(EXTRACTED TEXT:)/g, '<h2 style="font-size: 18px; margin: 16px 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #333333; color: #FFFFFF;">$1</h2>') // Changed to white
          .replace(/(DETAILED EXPLANATION:)/g, '<h2 style="font-size: 18px; margin: 16px 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #333333; color: #FFFFFF;">$1</h2>'); // Changed to white
        
        content.innerHTML = formattedText;
      } else {
        // Standard text display
        content.innerHTML = text.replace(/\n/g, '<br>') || 'No content found in the image.';
      }
    } catch (e) {
      // Fallback to simple text display
      content.textContent = text || 'No content found in the image.';
    }
  }
  
  // Add copy button only for successful OCR results
  let copyButton = null;
  if (!isError) {
    copyButton = document.createElement('button');
    copyButton.textContent = 'Copy to clipboard';
    copyButton.style.marginTop = '20px';
    copyButton.style.padding = '10px 16px';
    copyButton.style.backgroundColor = '#000000'; // Changed to black
    copyButton.style.color = 'white';
    copyButton.style.border = '1px solid #333333'; // Added border
    copyButton.style.borderRadius = '8px';
    copyButton.style.cursor = 'pointer';
    copyButton.style.fontWeight = '600';
    copyButton.style.fontSize = '14px';
    copyButton.style.transition = 'background-color 0.2s';
    copyButton.onmouseover = () => {
      copyButton.style.backgroundColor = '#333333'; // Changed to dark gray
    };
    copyButton.onmouseout = () => {
      copyButton.style.backgroundColor = '#000000'; // Changed to black
    };
    copyButton.onclick = () => {
      navigator.clipboard.writeText(text).then(() => {
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy to clipboard';
        }, 2000);
      });
    };
  }
  
  // Add new scan button for convenience
  const newScanButton = document.createElement('button');
  newScanButton.textContent = 'New Scan';
  newScanButton.style.marginTop = '20px';
  newScanButton.style.marginLeft = copyButton ? '10px' : '0';
  newScanButton.style.padding = '10px 16px';
  newScanButton.style.backgroundColor = '#000000'; // Changed to black
  newScanButton.style.color = 'white';
  newScanButton.style.border = '1px solid #333333'; // Added border
  newScanButton.style.borderRadius = '8px';
  newScanButton.style.cursor = 'pointer';
  newScanButton.style.fontWeight = '600';
  newScanButton.style.fontSize = '14px';
  newScanButton.style.transition = 'background-color 0.2s';
  newScanButton.onmouseover = () => {
    newScanButton.style.backgroundColor = '#333333'; // Changed to dark gray
  };
  newScanButton.onmouseout = () => {
    newScanButton.style.backgroundColor = '#000000'; // Changed to black
  };
  newScanButton.onclick = () => {
    if (document.body.contains(resultContainer)) {
      document.body.removeChild(resultContainer);
    }
    enableRegionSelectionMode();
  };
  
  // Assemble container
  resultContainer.appendChild(title);
  resultContainer.appendChild(content);
  
  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '10px';
  
  if (copyButton) {
    buttonContainer.appendChild(copyButton);
  }
  buttonContainer.appendChild(newScanButton);
  resultContainer.appendChild(buttonContainer);
  
  // Add try again button for policy errors
  if (isPolicyError) {
    const helpText = document.createElement('div');
    helpText.style.marginTop = '16px';
    helpText.style.fontSize = '14px';
    helpText.style.color = '#7c5e10';
    helpText.style.backgroundColor = '#fffbeb';
    helpText.style.padding = '12px';
    helpText.style.borderRadius = '6px';
    helpText.textContent = 'Try selecting a region without people or use a different image.';
    resultContainer.appendChild(helpText);
    
    const tryAgainButton = document.createElement('button');
    tryAgainButton.textContent = 'Select New Region';
    tryAgainButton.style.marginTop = '16px';
    tryAgainButton.style.padding = '10px 16px';
    tryAgainButton.style.backgroundColor = '#f59e0b';
    tryAgainButton.style.color = 'white';
    tryAgainButton.style.border = 'none';
    tryAgainButton.style.borderRadius = '8px';
    tryAgainButton.style.cursor = 'pointer';
    tryAgainButton.style.fontWeight = '600';
    tryAgainButton.style.fontSize = '14px';
    tryAgainButton.style.transition = 'background-color 0.2s';
    tryAgainButton.onmouseover = () => {
      tryAgainButton.style.backgroundColor = '#d97706';
    };
    tryAgainButton.onmouseout = () => {
      tryAgainButton.style.backgroundColor = '#f59e0b';
    };
    tryAgainButton.onclick = () => {
      if (document.body.contains(resultContainer)) {
        document.body.removeChild(resultContainer);
      }
      enableRegionSelectionMode();
    };
    resultContainer.appendChild(tryAgainButton);
  }
  
  // Add to parent
  document.body.appendChild(resultContainer);
  
  // Make draggable
  let isDragging = false;
  let offsetX, offsetY;
  
  title.style.cursor = 'move';
  title.onmousedown = (e) => {
    isDragging = true;
    offsetX = e.clientX - resultContainer.getBoundingClientRect().left;
    offsetY = e.clientY - resultContainer.getBoundingClientRect().top;
  };
  
  document.onmousemove = (e) => {
    if (!isDragging) return;
    
    resultContainer.style.left = (e.clientX - offsetX) + 'px';
    resultContainer.style.top = (e.clientY - offsetY) + 'px';
    resultContainer.style.transform = 'none';
  };
  
  document.onmouseup = () => {
    isDragging = false;
  };
  
  // Make sure the floating camera button is visible again
  const floatingButton = document.getElementById('floatingCameraButton');
  if (floatingButton) {
    floatingButton.style.display = 'flex';
  }
  
  return resultContainer;
}

// Enable region selection mode
async function enableRegionSelectionMode() {
  logDebug('region-selection', 'Starting region selection mode');
  
  if (!isContentScriptReady) {
    logError('region-selection', 'Content script not ready');
    alert('Content script not ready. Please refresh the page and try again.');
    return;
  }
  
  if (isProcessing) {
    logDebug('region-selection', 'Already processing a request');
    return;
  }
  
  // Set processing flag
  isProcessing = true;
  
  // Hide the floating camera button while selecting region
  const floatingButton = document.getElementById('floatingCameraButton');
  if (floatingButton) {
    floatingButton.style.display = 'none';
  }
  
  // Remove any existing overlay
  if (document.getElementById('screenshotOverlay')) {
    document.getElementById('screenshotOverlay').remove();
  }
  
  // Create overlay for region selection
  const overlay = document.createElement('div');
  overlay.id = 'screenshotOverlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.zIndex = '2147483647'; // Maximum z-index
  overlay.style.cursor = 'crosshair';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.2)'; // Slight darkening
  
  // Add cancel button
  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.position = 'fixed';
  cancelButton.style.top = '20px';
  cancelButton.style.right = '20px';
  cancelButton.style.padding = '8px 16px';
  cancelButton.style.backgroundColor = '#000000';
  cancelButton.style.color = 'white';
  cancelButton.style.border = 'none';
  cancelButton.style.borderRadius = '8px';
  cancelButton.style.cursor = 'pointer';
  cancelButton.style.zIndex = '2147483647';
  cancelButton.onclick = () => {
    document.body.removeChild(overlay);
    isProcessing = false;
    
    // Show the floating camera button again
    if (floatingButton) {
      floatingButton.style.display = 'flex';
    }
    
    logDebug('region-selection', 'Selection canceled by user');
  };
  overlay.appendChild(cancelButton);
  
  // Add instructions
  const instructions = document.createElement('div');
  instructions.textContent = 'Click and drag to select region for visual analysis';
  instructions.style.position = 'fixed';
  instructions.style.top = '20px';
  instructions.style.left = '50%';
  instructions.style.transform = 'translateX(-50%)';
  instructions.style.padding = '12px 20px';
  instructions.style.backgroundColor = '#000000';
  instructions.style.color = '#FFFFFF';
  instructions.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  instructions.style.fontSize = '15px';
  instructions.style.fontWeight = '600';
  instructions.style.borderRadius = '10px';
  instructions.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5)';
  instructions.style.zIndex = '2147483647';
  overlay.appendChild(instructions);
  
  // Create selection box
  const selectionBox = document.createElement('div');
  selectionBox.id = 'selectionBox';
  selectionBox.style.position = 'absolute';
  selectionBox.style.border = '3px dashed #000000'; // Changed from blue to black
  selectionBox.style.backgroundColor = 'rgba(0, 0, 0, 0.1)'; // Changed to black with low opacity
  selectionBox.style.display = 'none';
  selectionBox.style.borderRadius = '4px';
  overlay.appendChild(selectionBox);
  
  // Initialize selection variables
  let isSelecting = false;
  let startX = 0, startY = 0;
  
  try {
    // Mouse down event - start selection
    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

      selectionBox.style.left = startX + 'px';
      selectionBox.style.top = startY + 'px';
      selectionBox.style.width = '0';
      selectionBox.style.height = '0';
      selectionBox.style.display = 'block';
    });
    
    // Mouse move event - update selection
    overlay.addEventListener('mousemove', (e) => {
      if (!isSelecting) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const currentX = e.clientX;
      const currentY = e.clientY;
      
      // Calculate dimensions (handle negative selections)
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      
      // Calculate position (handle selections in any direction)
      const left = Math.min(currentX, startX);
      const top = Math.min(currentY, startY);
    
    // Update selection box
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
    });
    
    // Mouse up event - complete selection
    overlay.addEventListener('mouseup', async (e) => {
      if (!isSelecting) return;
      
      e.preventDefault();
      e.stopPropagation();
      isSelecting = false;
      
      // Get the final selection rectangle
      const rect = {
        x: parseInt(selectionBox.style.left, 10),
        y: parseInt(selectionBox.style.top, 10),
        width: parseInt(selectionBox.style.width, 10),
        height: parseInt(selectionBox.style.height, 10)
      };
      
      // Validate selection size
      if (rect.width < 10 || rect.height < 10) {
        // Too small, ignore
        return;
      }
      
      isProcessing = true;
      logDebug('region-selection', `Selection complete, processing region: ${JSON.stringify(rect)}`);
    
      // Show loading indicator
      const loadingIndicator = showLoadingIndicator();
      updateLoadingIndicator(loadingIndicator, 'Capturing screenshot...');
    
      try {
        // Remove overlay but keep selection visible
        document.body.removeChild(overlay);
        
        // Create marker to show selected area
        const marker = document.createElement('div');
        marker.style.position = 'absolute';
        marker.style.border = '2px solid rgba(0, 0, 0, 0)';
        marker.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
        marker.style.left = rect.x + 'px';
        marker.style.top = rect.y + 'px';
        marker.style.width = rect.width + 'px';
        marker.style.height = rect.height + 'px';
        marker.style.zIndex = '2147483646';
        document.body.appendChild(marker);
      
        // Delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Capture the screenshot using the background script
        updateLoadingIndicator(loadingIndicator, 'Processing image...');
        logDebug('screenshot', 'Capturing visible tab');
        
        // Wrap in a promise for cleaner async handling
        const screenshotData = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ 
            action: 'captureVisibleTab'
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            
            if (!response || response.error) {
              reject(new Error(response?.error || 'Failed to capture screenshot'));
              return;
            }
            
            if (!response.dataUrl) {
              reject(new Error('No image data returned from screenshot'));
              return;
            }
            
            resolve(response.dataUrl);
          });
        });
        
        // Log successful screenshot capture
        logDebug('screenshot', `Screenshot captured: ${Math.round(screenshotData.length / 1024)}KB`);
        
        // Process the screenshot to extract the selected region
        const imageDataUrl = await cropImageFromScreenshot(screenshotData, rect);
        
        // Use our helper function for OpenAI processing
        updateLoadingIndicator(loadingIndicator, 'Analyzing image with AI...');
        const ocrResponse = await processScreenshotWithOpenAI(imageDataUrl, rect, loadingIndicator);
        
        // Remove the marker
        if (document.body.contains(marker)) {
          document.body.removeChild(marker);
        }
        
        hideLoadingIndicator(loadingIndicator);
        isProcessing = false;
        
        // Display result
        handleOCRResult(ocrResponse.text, {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        }, false, false);
        
      } catch (error) {
        logError('region-selection', error);
        hideLoadingIndicator(loadingIndicator);
        isProcessing = false;
        
        // Try to display the error message
        try {
          const isPolicyError = error.isPolicyError === true;
          const errorMessage = error.error || error.message || 'Unknown error';
          handleOCRResult(errorMessage, {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          }, true, isPolicyError);
        } catch (displayError) {
          console.error('Failed to display error message:', displayError);
        }
        
        // Show the floating camera button again
        const floatingButton = document.getElementById('floatingCameraButton');
        if (floatingButton) {
          floatingButton.style.display = 'flex';
        }
      }
    });
    
    // ESC key to cancel
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
        document.removeEventListener('keydown', keyHandler);
        isProcessing = false;
        
        // Show the floating camera button again
        if (floatingButton) {
          floatingButton.style.display = 'flex';
        }
        
        logDebug('region-selection', 'Selection canceled with Escape key');
      }
    };
    document.addEventListener('keydown', keyHandler);
    
    // Add overlay to page
    document.body.appendChild(overlay);
    
    logDebug('region-selection', 'Region selection mode enabled');
  } catch (error) {
    logError('region-selection', error);
    if (overlay && document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
    isProcessing = false;
    
    // Show the floating camera button again
    const floatingButton = document.getElementById('floatingCameraButton');
    if (floatingButton) {
      floatingButton.style.display = 'flex';
    }
  }
}

// Crop the image from screenshot
async function cropImageFromScreenshot(screenshotDataUrl, rect) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
        img.onload = () => {
        // Create a canvas for the cropped region
          const canvas = document.createElement('canvas');
        canvas.width = rect.width;
        canvas.height = rect.height;
          
        // Get device pixel ratio for proper scaling
        const dpr = window.devicePixelRatio || 1;
          
        // Draw the cropped region to the canvas
          const ctx = canvas.getContext('2d');
        ctx.drawImage(
          img,
          rect.x * dpr, rect.y * dpr, 
          rect.width * dpr, rect.height * dpr,
          0, 0, rect.width, rect.height
        );
        
        // Convert to data URL
        resolve(canvas.toDataURL('image/png'));
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load screenshot image'));
      };
      
      img.src = screenshotDataUrl;
    } catch (error) {
      reject(error);
    }
  });
}

// Function to create and add the floating camera button
function addFloatingCameraButton() {
  // Check if button already exists
  if (document.getElementById('floatingCameraButton')) {
    return;
  }
  
  // Create button container
  const button = document.createElement('div');
  button.id = 'floatingCameraButton';
  button.style.position = 'fixed';
  button.style.bottom = '20px';
  button.style.left = '20px';
  button.style.width = '50px';
  button.style.height = '50px';
  button.style.borderRadius = '50%';
  button.style.backgroundColor = '#000000';
  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
  button.style.cursor = 'pointer';
  button.style.zIndex = '2147483646'; // One less than maximum to not overlap with the selection overlay
  button.style.transition = 'transform 0.2s, background-color 0.2s';
  
  // Create camera icon (using SVG)
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  
  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.textContent = 'Scan Image';
  tooltip.style.position = 'absolute';
  tooltip.style.left = '60px';
  tooltip.style.backgroundColor = '#333';
  tooltip.style.color = 'white';
  tooltip.style.padding = '5px 10px';
  tooltip.style.borderRadius = '4px';
  tooltip.style.fontSize = '14px';
  tooltip.style.whiteSpace = 'nowrap';
  tooltip.style.opacity = '0';
  tooltip.style.transition = 'opacity 0.3s';
  tooltip.style.pointerEvents = 'none';
  button.appendChild(tooltip);
  
  // Add hover effect
  button.onmouseover = () => {
    button.style.backgroundColor = '#333333';
    button.style.transform = 'scale(1.05)';
    tooltip.style.opacity = '1';
  };
  
  button.onmouseout = () => {
    button.style.backgroundColor = '#000000';
    button.style.transform = 'scale(1)';
    tooltip.style.opacity = '0';
  };
  
  // Add click handler with proper initialization check
  button.onclick = () => {
    // Make sure content script is ready
    if (!isContentScriptReady) {
      logDebug('camera-button', 'Content script not ready, initializing...');
      initializeExtension();
      
      // Wait a moment for initialization to complete
      setTimeout(() => {
        logDebug('camera-button', 'Delayed enabling of region selection');
        if (isContentScriptReady) {
          enableRegionSelectionMode();
        } else {
          alert('Content script initialization failed. Please try again or refresh the page.');
        }
      }, 500);
    } else {
      logDebug('camera-button', 'Enabling region selection mode');
      enableRegionSelectionMode();
    }
  };
  
  // Add focus indicators for accessibility
  button.tabIndex = 0; // Make focusable with keyboard
  button.setAttribute('aria-label', 'Scan Image');
  button.setAttribute('role', 'button');
  
  button.addEventListener('focus', () => {
    button.style.outline = '2px solid white';
    button.style.backgroundColor = '#333333';
  });
  
  button.addEventListener('blur', () => {
    button.style.outline = 'none';
    button.style.backgroundColor = '#000000';
  });
  
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click(); // Use the same click handler
    }
  });
  
  // Append to body
  document.body.appendChild(button);
  logDebug('camera-button', 'Floating camera button added');
}

// Initialize the extension when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    logDebug('init', 'DOM content loaded, initializing immediately');
    // Initialize without delay
    initializeExtension();
    
    // Explicitly notify background script about readiness
    chrome.runtime.sendMessage({ 
      action: 'contentScriptReady', 
      url: window.location.href,
      timestamp: Date.now() 
    }, response => {
      logDebug('init', `Background acknowledged readiness: ${JSON.stringify(response)}`);
    });
  });
        } else {
  // DOM already loaded, initialize immediately
  logDebug('init', 'DOM already loaded, initializing immediately');
  initializeExtension();
  
  // Explicitly notify background script about readiness
  chrome.runtime.sendMessage({ 
    action: 'contentScriptReady', 
    url: window.location.href,
    timestamp: Date.now() 
  }, response => {
    logDebug('init', `Background acknowledged readiness: ${JSON.stringify(response)}`);
  });
}

// Add a fallback initialization with minimal delay
window.addEventListener('load', () => {
  // Check if we're already initialized
  if (!isContentScriptReady) {
    logDebug('init', 'Window load event triggered, attempting re-initialization');
    initializeExtension();
    
    // Explicitly notify background script about readiness
    chrome.runtime.sendMessage({ 
      action: 'contentScriptReady', 
      url: window.location.href,
      timestamp: Date.now() 
    }, response => {
      logDebug('init', `Background acknowledged readiness: ${JSON.stringify(response)}`);
    });
  }
});

// Add a dedicated message listener for readiness checks
// This will respond even before the full initialization completes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkContentScriptReady' || message.action === 'ping') {
    logDebug('readiness', `Received readiness check: ${message.action}`);
    sendResponse({
      ready: true,
      action: message.action === 'ping' ? 'pong' : 'ready',
      timestamp: Date.now()
    });
    return true;
  }
});

// Final safeguard - mark as ready immediately 
isContentScriptReady = true;
logDebug('init', 'Content script loaded and marked as ready');

// Function to handle OpenAI processing after screenshot capture
function processScreenshotWithOpenAI(imageDataUrl, rect, loadingIndicator) {
  logDebug('ocr', `Sending cropped image to OpenAI: ${Math.round(imageDataUrl.length / 1024)}KB`);
  updateLoadingIndicator(loadingIndicator, 'Analyzing image with AI...');
  
  return new Promise((resolve, reject) => {
    // Add timeout handling for the OpenAI processing
    const timeoutId = setTimeout(() => {
      reject(new Error('OpenAI processing timed out. The image may be too complex or the server may be busy.'));
    }, 30000); // 30 second timeout
    
    chrome.runtime.sendMessage({
      action: 'processImageWithOpenAI',
      imageData: imageDataUrl,
      position: {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      }
    }, (response) => {
      clearTimeout(timeoutId);
      
      if (chrome.runtime.lastError) {
        logError('ocr', `Chrome runtime error: ${chrome.runtime.lastError.message}`);
        reject(chrome.runtime.lastError);
        return;
      }
      
      if (!response || response.error) {
        const isPolicyError = response && response.isPolicyError === true;
        const errorMsg = response?.error || 'Failed to process image';
        logError('ocr', errorMsg);
        reject({error: errorMsg, isPolicyError: isPolicyError});
        return;
      }
      
      // Success
      logDebug('ocr', 'Successfully received OpenAI analysis');
      resolve(response);
    });
  });
}
