document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const apiStatus = document.getElementById('apiStatus');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const testStatus = document.getElementById('testStatus');
  const errorLogsContainer = document.getElementById('errorLogs');
  
  // Load saved API key
  chrome.storage.local.get(['openaiApiKey'], (data) => {
    if (data.openaiApiKey) {
      // Show only the first 5 characters and the last 3 characters for security
      const key = data.openaiApiKey;
      const maskedKey = key.substring(0, 5) + '...' + key.substring(key.length - 3);
      apiKeyInput.value = maskedKey;
      apiKeyInput.setAttribute('data-original', maskedKey);
      apiStatus.textContent = 'API key is set';
    }
  });
  
  // Save OpenAI API key
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    
    if (!key) {
      apiStatus.textContent = 'Please enter an API key';
      apiStatus.className = 'status error';
      return;
    }
    
    // Don't save if it's the masked key (user didn't change it)
    if (key === apiKeyInput.getAttribute('data-original')) {
      apiStatus.textContent = 'No changes to save';
      apiStatus.className = 'status';
      return;
    }
    
    // Save the API key
    chrome.storage.local.set({ openaiApiKey: key }, () => {
      apiStatus.textContent = 'API key saved successfully!';
      apiStatus.className = 'status';
      
      // Update the masked view
      const maskedKey = key.substring(0, 5) + '...' + key.substring(key.length - 3);
      apiKeyInput.value = maskedKey;
      apiKeyInput.setAttribute('data-original', maskedKey);
      
      // Test the API key
      testOpenAiKey(key);
    });
  });
  
  // Test connection
  testConnectionBtn.addEventListener('click', () => {
    testStatus.textContent = 'Testing connections...';
    testStatus.className = 'status';
    
    chrome.storage.local.get(['openaiApiKey'], (data) => {
      let testsRunning = 0;
      let results = [];
      
      if (data.openaiApiKey) {
        testsRunning++;
        testOpenAiKey(data.openaiApiKey, (success, message) => {
          results.push(`OpenAI: ${message}`);
          checkAllTestsComplete();
        });
      } else {
        results.push('OpenAI: No API key found');
      }
      
      function checkAllTestsComplete() {
        testsRunning--;
        if (testsRunning <= 0) {
          // All tests complete
          testStatus.textContent = results.join(' | ');
          testStatus.className = 'status';
        }
      }
      
      if (testsRunning === 0) {
        testStatus.textContent = 'No API keys found. Please save API keys first.';
        testStatus.className = 'status error';
      }
    });
  });
  
  // Clear error logs
  clearLogsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all error logs?')) {
      chrome.storage.local.set({ errorLogs: [] }, () => {
        loadErrorLogs();
        testStatus.textContent = 'Error logs cleared';
        testStatus.className = 'status';
      });
    }
  });
  
  // Function to test the OpenAI API key
  function testOpenAiKey(apiKey, callback) {
    if (!callback) {
      testStatus.textContent = 'Testing OpenAI API key...';
    }
    
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5',
        reasoning_effort: 'minimal',
        verbosity: 'low',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say "Hello, Creamy!" to test the connection' }
        ],
        max_completion_tokens: 20
      })
    })
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => { throw new Error(`${response.status}: ${text}`); });
      }
      return response.json();
    })
    .then(data => {
      if (data.choices && data.choices.length > 0) {
        const message = 'API key is valid! Response: ' + data.choices[0].message.content;
        if (callback) {
          callback(true, message);
        } else {
          testStatus.textContent = message;
          testStatus.className = 'status';
        }
      } else {
        const message = 'API returned an unexpected response: ' + JSON.stringify(data);
        if (callback) {
          callback(false, message);
        } else {
          testStatus.textContent = message;
          testStatus.className = 'status error';
        }
      }
    })
    .catch(error => {
      const message = 'API key test failed: ' + error.message;
      if (callback) {
        callback(false, message);
      } else {
        testStatus.textContent = message;
        testStatus.className = 'status error';
      }
      
      // Log this error
      logError('openai-api-test', error.message);
    });
  }
  
  // Log an error
  function logError(source, message) {
    chrome.storage.local.get('errorLogs', data => {
      const logs = data.errorLogs || [];
      logs.push({
        timestamp: new Date().toISOString(),
        source: source,
        error: message
      });
      if (logs.length > 50) logs.shift();
      chrome.storage.local.set({ errorLogs: logs }, loadErrorLogs);
    });
  }
  
  // Load and display error logs
  function loadErrorLogs() {
    chrome.storage.local.get('errorLogs', data => {
      const logs = data.errorLogs || [];
      
      if (logs.length === 0) {
        errorLogsContainer.innerHTML = '<p>No error logs found.</p>';
        return;
      }
      
      // Sort logs in reverse chronological order
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Create HTML for logs
      let html = '';
      logs.forEach(log => {
        const date = new Date(log.timestamp).toLocaleString();
        html += `
          <div class="log-entry">
            <div class="timestamp">${date}</div>
            <strong>Source:</strong> ${log.source}<br>
            <strong>Error:</strong> ${log.error}
          </div>
        `;
      });
      
      errorLogsContainer.innerHTML = html;
    });
  }
  
  // Load error logs on page load
  loadErrorLogs();
});