document.addEventListener('DOMContentLoaded', () => {
    const statusText = document.getElementById('statusText');
    const ocrStatus = document.getElementById('ocrStatus');
  
    // Function to verify content script is loaded and ready
    function verifyContentScriptLoaded(tabId, callback) {
      // Try the new reliable method first
      chrome.tabs.sendMessage(
        tabId, 
        { action: 'checkContentScriptReady' }, 
        response => {
          if (chrome.runtime.lastError) {
            console.warn('Content script check failed:', chrome.runtime.lastError.message);
            // Fall back to background script's tracking
            chrome.runtime.sendMessage(
              { 
                action: 'isContentScriptReady', 
                tabId: tabId 
              }, 
              readyResponse => {
                if (readyResponse && readyResponse.ready) {
                  callback(true);
                } else {
                  injectContentScript(tabId, callback);
                }
              }
            );
          } else if (response && response.ready) {
            callback(true);
          } else {
            injectContentScript(tabId, callback);
          }
        }
      );
    }
  
    // Function to inject content script if needed
    function injectContentScript(tabId, callback) {
      updateStatus('Injecting content script...');
      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          files: ['content.js']
        },
        () => {
          if (chrome.runtime.lastError) {
            updateStatus(`Error: ${chrome.runtime.lastError.message}`);
            callback(false);
          } else {
            // Give it a moment to initialize
            setTimeout(() => callback(true), 500);
          }
        }
      );
    }
  
    // Function to update status text
    function updateStatus(message, isError = false) {
      statusText.textContent = message;
      statusText.style.color = isError ? '#d32f2f' : '#666';
    }
  
    // Check content script status when popup opens
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tabId = tabs[0].id;
      
      verifyContentScriptLoaded(tabId, (isReady) => {
        if (isReady) {
          updateStatus('Ready to scan. Use the camera button on the page.');
        } else {
          updateStatus('Could not initialize content script. Please refresh the page and try again.', true);
        }
      });
    });
  
    // Handle OCR result display
    function displayOcrResult(result) {
      ocrStatus.innerHTML = '';
      
      const resultDiv = document.createElement('div');
      resultDiv.className = 'ocr-result';
      
      const textContent = document.createElement('div');
      textContent.className = 'ocr-text';
      textContent.style.whiteSpace = 'pre-wrap';
      textContent.style.maxHeight = '300px';
      textContent.style.overflow = 'auto';
      textContent.style.marginBottom = '10px';
      textContent.style.fontSize = '14px';
      textContent.style.lineHeight = '1.5';
      textContent.style.backgroundColor = '#222';
      textContent.style.color = '#fff';
      textContent.style.padding = '10px';
      textContent.style.borderRadius = '4px';
      
      // Format the text for better readability
      textContent.textContent = result;
      
      const copyButton = document.createElement('button');
      copyButton.textContent = 'Copy Text';
      copyButton.style.marginRight = '5px';
      copyButton.style.backgroundColor = '#000000';
      copyButton.style.color = 'white';
      copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(result).then(() => {
          copyButton.textContent = 'Copied!';
          setTimeout(() => {
            copyButton.textContent = 'Copy Text';
          }, 2000);
        });
      });
      
      resultDiv.appendChild(textContent);
      resultDiv.appendChild(copyButton);
      ocrStatus.appendChild(resultDiv);
      updateStatus('Analysis complete');
    }
    
    // Listen for OCR results from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'showScanResult') {
        if (message.error) {
          updateStatus(`Error: ${message.error}`, true);
          ocrStatus.innerHTML = '';
        } else if (message.solution) {
          updateStatus('Analysis complete!');
          displayOcrResult(message.solution);
        }
        sendResponse({received: true});
        return true;
      }
    });
  
    // Add a style for animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  });