// Creamy extension - Question Transcript Feature
// Adds "CREAM" buttons next to questions to quickly capture and analyze content

// Wrap everything in an IIFE to avoid global variable collisions
(function() {
  // Global variables (now scoped to this IIFE)
  let questionButtons = new Map();
  let isProcessing = false;
  let isCanvasPage = false;
  // Make sure all variables are scoped inside the IIFE
  let creamPort = null; // Renamed from 'port' to avoid collisions with content.js

  // Logging function
  function logDebug(message) {
    console.log(`[CreamHelper] ${message}`);
  }

  // Check if this is a Canvas page
  function checkIfCanvas() {
    // Look for Canvas-specific elements or URLs
    const isCanvasURL = window.location.hostname.includes('canvas') || 
                      window.location.pathname.includes('/courses/') || 
                      document.querySelector('meta[name="csrf-token"]');
    
    const hasCanvasElements = document.querySelector('.quiz-header') || 
                            document.querySelector('.question_holder') || 
                            document.querySelector('.quiz_sortable');
    
    isCanvasPage = isCanvasURL || hasCanvasElements;
    
    if (isCanvasPage) {
      logDebug('Detected Canvas LMS page - using specialized handling');
    }
    
    return isCanvasPage;
  }
  
  // Get full question content including answer options
  function getFullQuestionContent(element) {
    // Try to find the complete question container including answers
    let container = element;
    
    // For Canvas, find the full question container with answers
    if (isCanvasPage) {
      container = element.closest('.question_holder, .display_question, [id^="question_"]') || element;
    } else {
      // For other sites, try to find a parent container that likely contains the whole question
      // Look up the DOM tree for potential parent containers
      let parent = element.parentElement;
      const maxDepth = 4; // Don't go too far up the tree
      let depth = 0;
      
      while (parent && depth < maxDepth) {
        // Check if this parent contains input elements or answer options
        const hasOptions = parent.querySelectorAll('input[type="radio"], input[type="checkbox"], .answer, .option, .choice, li').length > 0;
        
        if (hasOptions) {
          container = parent;
          break;
        }
        
        parent = parent.parentElement;
        depth++;
      }
    }
    
    // Extract the full content including question and answer options
    const fullContent = extractQuestionAndAnswers(container);
    
    return fullContent;
  }
  
  // Extract formatted question and answers from container
  function extractQuestionAndAnswers(container) {
    let result = {
      question: "",
      options: [],
      fullText: "",
      contextText: "", // Additional field for context
      source: "standard_extraction",
      images: [] // Add an array to store image URLs
    };
    
    try {
      // First, temporarily hide any CREAM buttons to prevent picking up their text
      const creamButtons = container.querySelectorAll('.cream-btn');
      creamButtons.forEach(btn => {
        btn.dataset.originalDisplay = btn.style.display;
        btn.style.display = 'none';
      });
      
      // Get the full container text for context
      result.contextText = container.textContent.trim();
      
      // Get question header and content separately for better extraction
      // 1. Extract the question header first
      const questionHeader = container.querySelector('h1, h2, h3, h4, h5, h6, .question_text, .question_name, .question-header, .questionHeader, .quiz_question');
      let headerText = "";
      
      if (questionHeader) {
        // Clone the element to safely get its text without buttons
        const clonedHeader = questionHeader.cloneNode(true);
        const buttonsInClone = clonedHeader.querySelectorAll('.cream-btn');
        buttonsInClone.forEach(btn => btn.remove()); // Remove buttons from clone
        headerText = clonedHeader.textContent.trim();
        logDebug(`Extracted header text: ${headerText.substring(0, 50)}...`);
      }
      
      // 2. If no text in header or no header found, look for question text directly
      if (!headerText) {
        // Try to find question text in common question containers
        const possibleQuestionContainers = container.querySelectorAll('.question-text, .question_text, .question-stem, .stem, [aria-label*="question"]');
        
        for (const qContainer of possibleQuestionContainers) {
          if (qContainer.textContent && qContainer.textContent.trim().length > 10) {
            headerText = qContainer.textContent.trim();
            logDebug(`Found question text in container: ${headerText.substring(0, 50)}...`);
            break;
          }
        }
      }
      
      // 3. If still no question text, look for paragraphs or divs at the beginning
      if (!headerText) {
        const paragraphs = container.querySelectorAll('p, div:not(:has(*))');
        
        // Get only the first visible paragraph/div with substantial text
        for (const p of paragraphs) {
          // Skip if contains a radio button (likely an answer)
          if (p.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
          
          // Skip if very short
          if (p.textContent.trim().length < 10) continue;
          
          // Skip if hidden or empty
          if (p.offsetParent === null || getComputedStyle(p).display === 'none') continue;
          
          headerText = p.textContent.trim();
          logDebug(`Using first paragraph as question text: ${headerText.substring(0, 50)}...`);
          break;
        }
      }
      
      // 4. Final fallback - get the first 200 characters of the container if it has text
      if (!headerText && container.textContent.trim().length > 0) {
        headerText = container.textContent.trim().split(/\n/)[0]; // First line only
        if (headerText.length > 200) headerText = headerText.substring(0, 200) + '...';
        logDebug(`Using container first line as question text: ${headerText}`);
      }
      
      // Set the question to the header text we found
      result.question = headerText;
      
      // Restore CREAM buttons visibility
      creamButtons.forEach(btn => {
        btn.style.display = btn.dataset.originalDisplay || '';
        delete btn.dataset.originalDisplay;
      });
      
      // Clean up the question text
      result.question = cleanQuestionText(result.question);
      
      // Now focus on finding all answer options - this is the key improvement
      findAnswerOptionsImproved(container, result);
      
      // --- START IMAGE EXTRACTION ---
      const imageElements = container.querySelectorAll('img');
      logDebug(`Found ${imageElements.length} image elements in the container.`);

      imageElements.forEach(img => {
          // Basic filtering: Skip tiny images if possible (using attributes)
          const width = parseInt(img.getAttribute('width') || img.style.width || '0');
          const height = parseInt(img.getAttribute('height') || img.style.height || '0');

          // Skip if width or height is explicitly set to something small (e.g., < 30px)
          if ((width > 0 && width < 30) || (height > 0 && height < 30)) {
              logDebug(`Skipping potentially small image: ${img.src}`);
              return;
          }

          // Skip if image is inside a button (like the CREAM button itself)
          if (img.closest('.cream-btn, button')) {
              logDebug(`Skipping image inside a button: ${img.src}`);
              return;
          }
          
          // Skip decorative images (basic check)
          if (img.getAttribute('alt') === '' || img.getAttribute('role') === 'presentation') {
               logDebug(`Skipping potentially decorative image: ${img.src}`);
               return;
          }

          if (img.src) {
              try {
                  // Resolve relative URLs to absolute URLs
                  const absoluteUrl = new URL(img.src, window.location.href).href;
                  
                  // Basic check to avoid data URIs for now
                  if (!absoluteUrl.startsWith('data:')) {
                      result.images.push(absoluteUrl);
                      logDebug(`Added image URL: ${absoluteUrl}`);
                  } else {
                       logDebug(`Skipping data URI image: ${absoluteUrl.substring(0, 50)}...`);
                  }
              } catch (urlError) {
                  console.warn(`[CreamHelper] Could not parse image src: ${img.src}`, urlError);
              }
          }
      });
      // --- END IMAGE EXTRACTION ---
      
      // Create formatted full text with question and options
      result.fullText = result.question + "\n\n";
      
      // Add image references to fullText if any were found
      if (result.images.length > 0) {
          result.fullText += `\n[Image${result.images.length > 1 ? 's' : ''} present in question]\n`;
      }
      
      if (result.options.length > 0) {
        result.fullText += "Options:\n";
        result.options.forEach((option, index) => {
          result.fullText += `${index + 1}. ${option}\n`;
        });
      }
      
      // If failed to extract question or it's too short after cleaning, log error
      if (!result.question || result.question.length < 10) {
        console.error('[CreamHelper] Failed to extract valid question text from', container);
        result.question = "Unable to extract question content. Please try selecting a more specific element.";
        result.source = "extraction_failed";
      } else {
        // Log success
        logDebug(`Successfully extracted question with ${result.options.length} options`);
      }
    } catch (error) {
      console.error('[CreamHelper] Error extracting question content:', error);
      result.fullText = container.textContent.trim();
      result.question = "Error extracting question. Please try again or select a more specific element.";
      result.source = "error";
    }
    
    return result;
  }
  
  // Dedicated function to clean question text (for better organization and reuse)
  function cleanQuestionText(text) {
    // Skip if no text
    if (!text) return "";
    
    let cleaned = text;
    
    // Remove "CREAM" text (case insensitive with word boundaries)
    cleaned = cleaned.replace(/\b(CREAM|cream)\b/gi, '');
    
    // Remove "UnansweredQuestion X" pattern
    cleaned = cleaned.replace(/Unanswered\s*Question\s*\d+/gi, '');
    
    // Remove generic "Question X" if that's all that's left
    if (/^\s*Question\s+\d+\s*$/i.test(cleaned)) {
      cleaned = '';
    }
    
    // Remove boilerplate and debug text for fill-in-the-blank questions
    if (cleaned.includes('_____')) {
      // Remove any "all possible answers" text
      cleaned = cleaned.replace(/all\s+possible\s+answers/gi, '');
      
      // Remove "exact_answer none [numbers]" patterns
      cleaned = cleaned.replace(/exact_answer\s+none\s+\d+/gi, '');
      
      // Remove plain number sequences (often debug info)
      cleaned = cleaned.replace(/\b\d{5,}\b/g, '');
      
      // Remove "margin of error +/-" patterns
      cleaned = cleaned.replace(/margin\s+of\s+error\s+\+\/\-\s+\d+/gi, '');
      
      // Remove repeated phrases (common in auto-generated content)
      const sentences = cleaned.split(/[.!?]+/);
      const uniqueSentences = [];
      const seen = new Set();
      
      sentences.forEach(sentence => {
        const trimmed = sentence.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          uniqueSentences.push(trimmed);
        }
      });
      
      cleaned = uniqueSentences.join('. ');
      
      // Ensure clean fill-in-the-blank format
      if (cleaned && !cleaned.startsWith('Fill in the blank:')) {
        if (cleaned.toLowerCase().includes('fill in the blank')) {
          // Already mentions fill in the blank, just clean it up
          cleaned = cleaned.replace(/fill\s+in\s+the\s+blank[:\s]*/i, 'Fill in the blank: ');
        } else {
          // Add the prefix
          cleaned = 'Fill in the blank: ' + cleaned;
        }
      }
    }
    
    // Final whitespace cleanup
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // If no good question text remains, use a generic placeholder
    if (!cleaned) {
      cleaned = "Question Analysis";
    }
    
    return cleaned;
  }
  
  // Enhanced version specifically for handling radio button options better
  function findAnswerOptionsImproved(container, result) {
    const uniqueOptions = new Set();
    result.options = [];
    
    try {
      // First look for radio buttons - most reliable for multiple choice
      const radioButtons = container.querySelectorAll('input[type="radio"]');
      
      if (radioButtons.length > 0) {
        logDebug(`Found ${radioButtons.length} radio buttons for options`);
        
        // Group by name attribute
        const radioGroups = {};
        radioButtons.forEach(radio => {
          const name = radio.name || 'unknown';
          if (!radioGroups[name]) radioGroups[name] = [];
          radioGroups[name].push(radio);
        });
        
        // Process each group
        Object.values(radioGroups).forEach(group => {
          group.forEach(radio => {
            // Use multiple methods to find option text
            let optionText = '';
        
        // Method 1: Associated label
            if (radio.id) {
              const labelFor = document.querySelector(`label[for="${radio.id}"]`);
              if (labelFor) {
                optionText = labelFor.textContent.trim();
              }
            }
            
            // Method 2: Containing label
        if (!optionText) {
              const parentLabel = radio.closest('label');
          if (parentLabel) {
                // Clone to remove the radio button itself
                const clone = parentLabel.cloneNode(true);
                const radioInClone = clone.querySelector('input[type="radio"]');
                if (radioInClone) radioInClone.remove();
                
                optionText = clone.textContent.trim();
              }
            }
            
            // Method 3: Parent div/span content
        if (!optionText) {
              const parentDiv = radio.closest('div, span');
              if (parentDiv) {
                // Clone to remove the radio button itself
                const clone = parentDiv.cloneNode(true);
                const radioInClone = clone.querySelector('input[type="radio"]');
                if (radioInClone) radioInClone.remove();
                
                // Remove any buttons from the clone
                const buttonsInClone = clone.querySelectorAll('button, .cream-btn');
                buttonsInClone.forEach(btn => btn.remove());
                
                optionText = clone.textContent.trim();
              }
            }
            
            // Method 4: Next element sibling text
        if (!optionText) {
              let sibling = radio.nextElementSibling;
              if (sibling && sibling.textContent.trim()) {
                optionText = sibling.textContent.trim();
              }
            }
            
            // Method 5: Adjacent text node
        if (!optionText) {
              let node = radio.nextSibling;
              while (node) {
                if (node.nodeType === 3 && node.textContent.trim()) {
                  optionText = node.textContent.trim();
                  break;
                }
                node = node.nextSibling;
              }
            }
            
            // Clean up the option text and add it if found
        if (optionText) {
          optionText = optionText.replace(/\s+/g, ' ').trim();
              if (optionText && !uniqueOptions.has(optionText)) {
                uniqueOptions.add(optionText);
            result.options.push(optionText);
          }
        }
      });
        });
      }
      
      // If no options found yet, check for list items that might contain options
      if (result.options.length === 0) {
        // Look for list items or divs with text that might be options
        const potentialOptionElements = container.querySelectorAll('li, div.option, div.answer, .choice');
        
        potentialOptionElements.forEach(element => {
          // Skip if this element has already been processed or has a radio button
          if (element.querySelector('input[type="radio"], input[type="checkbox"]')) {
            return;
          }
          
          const text = element.textContent.trim();
          if (text && !uniqueOptions.has(text)) {
            uniqueOptions.add(text);
            result.options.push(text);
          }
        });
      }
      
      // Special case: look for divs that follow clear patterns of options
      if (result.options.length === 0) {
        // Look for consecutive divs with consistent styling that might be options
        const allDivs = Array.from(container.querySelectorAll('div'));
        
        const siblings = [];
        for (let i = 0; i < allDivs.length; i++) {
          if (allDivs[i].textContent.trim().length < 200) { // Not too long
            // Find consecutive siblings
            const siblingTexts = [];
            let current = allDivs[i];
            
            while (current && siblingTexts.length < 6) { // Look for up to 6 consecutive options
              if (current.tagName === 'DIV' && current.textContent.trim().length < 200) {
                siblingTexts.push(current.textContent.trim());
              }
              
              current = current.nextElementSibling;
            }
            
            // If we found at least 2 consecutive divs, they might be options
            if (siblingTexts.length >= 2) {
              siblings.push(siblingTexts);
            }
          }
        }
        
        // Find the group with the most consistent formatting (likely options)
        let bestOptionGroup = [];
        siblings.forEach(group => {
          // Only consider if better than current best
          if (group.length > bestOptionGroup.length) {
            // Check if elements are similar in length (option-like)
            const lengths = group.map(t => t.length);
            const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
            const allSimilar = lengths.every(l => l > avg * 0.3 && l < avg * 3);
            
            if (allSimilar) {
              bestOptionGroup = group;
            }
          }
        });
        
        // Add these as options
        bestOptionGroup.forEach(text => {
          if (text && !uniqueOptions.has(text)) {
            uniqueOptions.add(text);
            result.options.push(text);
            }
          });
        }
        
      // Last attempt for the specific pattern in the screenshot (text next to radio buttons)
        if (result.options.length === 0) {
        const radioParents = container.querySelectorAll('input[type="radio"]');
        
        radioParents.forEach(radio => {
          // Try to scan the entire parent element
          let parentDiv = radio.parentElement;
          let scanning = 0;
          
          // Look up to 3 levels up
          while (parentDiv && scanning < 3) {
            // Get all text nodes and elements directly in this parent
            const textContent = [];
            
            // Process all child nodes
            Array.from(parentDiv.childNodes).forEach(node => {
              // Skip the radio button itself and any cream buttons
              if (node === radio || 
                  (node.classList && node.classList.contains('cream-btn'))) {
                return;
              }
              
              // Text node - add directly
              if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                textContent.push(node.textContent.trim());
              }
              // Element node with text - add its text
              else if (node.nodeType === Node.ELEMENT_NODE && 
                       node.textContent.trim() && 
                       !node.querySelector('input[type="radio"], input[type="checkbox"]')) {
                textContent.push(node.textContent.trim());
              }
            });
            
            const combined = textContent.join(' ').replace(/\s+/g, ' ').trim();
            if (combined && !uniqueOptions.has(combined)) {
              uniqueOptions.add(combined);
              result.options.push(combined);
              break; // Found good content, stop scanning up
            }
            
            parentDiv = parentDiv.parentElement;
            scanning++;
          }
        });
      }
      
      // Check if this might be a true/false question
      const isTrueFalseQuestion = (
        result.question.toLowerCase().includes('true or false') ||
        result.question.toLowerCase().includes('true/false') ||
        /\btrue\b.*\bfalse\b/i.test(result.question)
      );
      
      if (isTrueFalseQuestion && result.options.length === 0) {
        result.options.push('True');
        result.options.push('False');
      }
      
      // For fill-in-the-blank questions
      if (result.question.includes('_____') && result.options.length === 0) {
        result.options.push("[Fill in the blank]");
      }
      
      // Log what we found
      logDebug(`Found ${result.options.length} options with improved method`);
      result.options.forEach((opt, i) => {
        logDebug(`Option ${i+1}: ${opt.substring(0, 50)}...`);
      });
    } catch (error) {
      console.error('[CreamHelper] Error in findAnswerOptionsImproved:', error);
    }
  }

  // Check if element is a main question header (not just any element with "Question" text)
  function isMainQuestionHeader(element) {
    if (!element || !element.textContent) return false;
    
    // Skip elements that are obviously not headers
    if (['INPUT', 'TEXTAREA', 'BUTTON', 'IMG', 'A', 'LI'].includes(element.tagName)) return false;
    
    const text = element.textContent.trim();
    
    // Check for strong patterns that indicate a main question header
    // This is more restrictive to target only main headers like "Question 1"
    if (/^Question\s+\d+\s*$/.test(text)) return true; // Exactly "Question X" 
    if (/^Q\.?\s*\d+\s*$/.test(text)) return true; // Exactly "Q.X" or "Q X"
    
    // Canvas-specific question headers
    if (element.classList.contains('question_name') || 
        element.classList.contains('header_content') ||
        element.closest('.question_name, .header_content')) return true;
    
    // Check if it's a heading element with a question number and very little other text
    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName) && 
        /Question\s+\d+/i.test(text) && 
        text.length < 30) return true;
    
    // For Canvas quizzes
    if (element.id && element.id.startsWith('question_') && 
        element.querySelector('.question_name, .header_content')) return true;
    
    return false;
  }

  // Find question headers on the page (only main question headers)
  function findQuestionHeaders() {
    logDebug('Looking for main question headers on the page...');
    
    // Keep track of elements already processed to avoid duplicates
    const processedElements = new Set();
    const questionElements = [];
    
    // Special handling for Canvas LMS
    if (isCanvasPage || checkIfCanvas()) {
      // Canvas-specific question selectors (only target main headers)
      const canvasMainHeaders = document.querySelectorAll('.question_name, .header_content');
      
      logDebug(`Found ${canvasMainHeaders.length} Canvas question headers`);
      
      canvasMainHeaders.forEach(header => {
        // Skip if already has our button or if already processed
        if (header.querySelector('.cream-btn') || processedElements.has(header)) {
          return;
        }
        
        // Mark as processed
        processedElements.add(header);
        
        // Get the parent question container for context
        const container = header.closest('.question_holder, .display_question, [id^="question_"]') || header;
        
        questionElements.push({
          element: header,
          text: container.textContent.trim().substring(0, 300),
          isCanvas: true
        });
      });
    }
    
    // Method 1: Find heading elements with "Question X" pattern (more precise)
    const questionHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    questionHeadings.forEach(heading => {
      // Skip if already processed
      if (processedElements.has(heading)) return;
      
      const text = heading.textContent.trim();
      
      // Only match explicit "Question X" or "Q.X" patterns
      if ((/^Question\s+\d+/i.test(text) || /^Q\.?\s*\d+/i.test(text)) && 
          text.length < 50 && 
          !heading.querySelector('.cream-btn')) {
        
        // Mark as processed
        processedElements.add(heading);
        
        questionElements.push({
          element: heading,
          text: text,
          isHeading: true
        });
      }
    });
    
    // Method 2: Find specific question header elements by class or role
    const headerElements = document.querySelectorAll('.question-header, .questionHeader, [role="heading"]');
    headerElements.forEach(element => {
      // Skip if already processed
      if (processedElements.has(element)) return;
      
      if (element.textContent && 
          /Question\s+\d+/i.test(element.textContent) && 
          !element.querySelector('.cream-btn') &&
          !questionElements.some(q => q.element === element || element.contains(q.element) || q.element.contains(element))) {
        
        // Mark as processed
        processedElements.add(element);
        
        questionElements.push({
          element: element,
          text: element.textContent.trim()
        });
      }
    });
    
    // Method 3: Advanced search for standalone question headers (less selective - only use if needed)
    if (questionElements.length === 0) {
      const potentialHeaders = document.querySelectorAll('div, span');
      potentialHeaders.forEach(element => {
        // Skip if already processed
        if (processedElements.has(element)) return;
        
        const text = element.textContent.trim();
        
        // Only consider standalone question headers
        if (isMainQuestionHeader(element) && 
            !element.querySelector('.cream-btn') && 
            !questionElements.some(q => q.element === element || q.element.contains(element) || element.contains(q.element))) {
          
          // Mark as processed
          processedElements.add(element);
          
          questionElements.push({
            element: element,
            text: text,
            isStandalone: true
          });
        }
      });
    }
    
    logDebug(`Found ${questionElements.length} main question headers`);
    return questionElements;
  }

  // Utility function to remove all existing CREAM buttons from the page
  function removeExistingButtons() {
    const buttons = document.querySelectorAll('.cream-btn');
    buttons.forEach(button => {
      if (button && button.parentElement) {
        button.parentElement.removeChild(button);
        logDebug('Removed existing CREAM button');
      }
    });
    
    // Clear our tracking map
    questionButtons.clear();
  }

  // Extract question number from text
  function extractQuestionNumber(text) {
    // Try to find "Question X" pattern (most precise)
    const questionMatch = text.match(/Question\s+(\d+)/i);
    if (questionMatch && questionMatch[1]) {
      return 'q' + questionMatch[1]; // Prefix with 'q' to avoid number collisions
    }
    
    // Try to find "Q.X" pattern
    const qMatch = text.match(/Q\.?\s*(\d+)/i);
    if (qMatch && qMatch[1]) {
      return 'q' + qMatch[1]; // Prefix with 'q' to avoid number collisions
    }
    
    // Try to find a standalone number at the beginning of text
    const numMatch = text.match(/^\s*(\d+)[\.\)]/);
    if (numMatch && numMatch[1]) {
      return 'num' + numMatch[1]; // Prefix with 'num' to distinguish from question numbers
    }
    
    // Default to a hash of the text if no number is found
    // Make the hash shorter and prefix it to avoid collisions
    return 'hash' + Math.abs(text.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0)).toString().substring(0, 5);
  }

  // Before analyzeQuestionWithAI function, add a new function to determine question type
  function determineQuestionType(questionText, options) {
    // First, check for "which is incorrect/false/not true" type questions
    if (questionText.toLowerCase().includes("which statement is incorrect") || 
        questionText.toLowerCase().includes("which is false") ||
        questionText.toLowerCase().includes("which is not true") ||
        questionText.toLowerCase().includes("which one is false") ||
        questionText.toLowerCase().includes("which of the following is false") ||
        questionText.toLowerCase().includes("which of the following statements is false") ||
        (questionText.toLowerCase().includes("false") && 
         questionText.toLowerCase().includes("which"))) {
      return "identify_false";
    }
    
    // Check for true/false questions
    if (options.length === 2 && 
        options.some(o => o.toLowerCase().includes("true")) && 
        options.some(o => o.toLowerCase().includes("false"))) {
      return "true_false";
    }
    
    // Default type
    return "standard";
  }

  // Function to analyze question with AI
  function analyzeQuestionWithAI(questionData, updateCallback) {
    // First, check if Chrome runtime is valid
    // This is a more thorough check for extension context invalidation
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      console.warn('[CreamHelper] Extension context appears to be invalidated');
      // Implement a fallback function
      const fallbackText = mockAnalyzeQuestion(questionData);
      updateCallback("Extension Context Error. Using offline mode:\n\n" + fallbackText);
      return;
    }
    
    console.log('[CreamHelper Debug] Preparing to send data to OpenAI:', questionData);
    
    // Ensure options are included and properly formatted in the question data
    const formattedQuestionData = {
      question: questionData.question,
      options: questionData.options || [],
      fullText: questionData.fullText,
      // Add contextText as an additional field for better AI understanding
      contextText: questionData.contextText || questionData.fullText || questionData.question,
      // Include the extracted image URLs
      images: questionData.images || [] 
    };
    
    // Check if the question requires external knowledge (like about videos or content not in the question)
    const needsExternalKnowledge = 
        questionData.question.includes("according to") || 
        questionData.question.includes("in the video") || 
        questionData.question.includes("scammer videos") ||
        questionData.question.includes("Browning's");
        
    // If it requires external knowledge, add a hint to the contextText
    if (needsExternalKnowledge) {
      formattedQuestionData.contextText += "\n\nNote: This question requires knowledge about external content. If you don't have this information, please provide your best guess based on the options and context clues. Select the most likely answer rather than stating you cannot determine the answer.";
      formattedQuestionData.forceAnswer = true; // Flag to tell the backend to force an answer
    }
    
    // Enhanced logging for debugging question extraction issues
    logDebug(`Question being sent: ${formattedQuestionData.question.substring(0, 100)}...`);
    logDebug(`Options count: ${formattedQuestionData.options.length}`);
    formattedQuestionData.options.forEach((opt, idx) => {
      logDebug(`Option ${idx + 1}: ${opt.substring(0, 50)}...`);
    });
    
    // Properly format the data for the background script
    const requestData = {
      action: 'processQuestionWithOpenAI',
      questionData: formattedQuestionData
    };
    
    // Update the popup immediately with loading state
    updateCallback(`Analyzing question...`, null, true);
    
    // Set timeout to handle non-responsive background
    let responseReceived = false;
    const timeoutDuration = 20000; // 20 seconds timeout
    let startTime = Date.now();
    
    // Update loading message with time elapsed
    const updateLoadingMessage = () => {
      if (responseReceived) return;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      updateCallback(`Getting answer... (${elapsed}s)`, null, true); 
      
      if (elapsed < timeoutDuration/1000) {
        setTimeout(updateLoadingMessage, 1000);
      }
    };
    
    // Start updating the loading message
    updateLoadingMessage();
    
    // Set a timeout
    const timeoutId = setTimeout(() => {
      if (!responseReceived) {
        console.warn('[CreamHelper] Analysis request timed out');
        // Automatically use the fallback on timeout
        const fallbackText = mockAnalyzeQuestion(questionData);
        updateCallback("Request timed out. Here are some tips instead:\n\n" + fallbackText);
      }
    }, timeoutDuration);
    
    try {
      // Use a safer message sending pattern with error checking
      const checkExtensionContext = () => {
        try {
          return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
        } catch (e) {
          return false;
        }
      };
      
      // Only proceed if extension context is still valid
      if (!checkExtensionContext()) {
        clearTimeout(timeoutId);
        const fallbackText = mockAnalyzeQuestion(questionData);
        updateCallback("Extension context lost. Using offline mode:\n\n" + fallbackText);
        return;
      }
      
      // Send the request to the background script - include raw data for debugging
      requestData.debugInfo = {
        timestamp: new Date().toISOString(),
        source: 'question_transcript.js',
        optionsCount: formattedQuestionData.options.length,
        questionLength: formattedQuestionData.question.length,
        questionType: questionData.questionType || 'standard'
      };
      
      chrome.runtime.sendMessage(requestData, function(response) {
        responseReceived = true;
        clearTimeout(timeoutId);
        
        console.log('[CreamHelper Debug] Received response:', response);
        
        // Check if extension context is still valid
        if (!checkExtensionContext()) {
          const fallbackText = mockAnalyzeQuestion(questionData);
          updateCallback("Extension context lost. Using offline mode:\n\n" + fallbackText);
          return;
        }
        
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          console.error('[CreamHelper] Runtime error:', chrome.runtime.lastError);
          
          // Handle specific error types
          const errorMsg = chrome.runtime.lastError.message || "Unknown error";
          console.log('[CreamHelper Debug] Error message:', errorMsg);
          
          // For context invalidation, use fallback
          if (errorMsg.includes('invalid') || errorMsg.includes('port closed')) {
            const fallbackText = mockAnalyzeQuestion(questionData);
            updateCallback("Extension service unavailable. Using offline mode:\n\n" + fallbackText);
          } else {
            updateCallback("Error: " + errorMsg);
          }
          return;
        }
        
        // Handle empty response
        if (!response) {
          console.log('[CreamHelper Debug] Empty response received');
          const fallbackText = mockAnalyzeQuestion(questionData);
          updateCallback("No response received. Using offline mode:\n\n" + fallbackText);
          return;
        }
        
        // Handle error in response
        if (response.error) {
          console.log('[CreamHelper Debug] Error in response:', response.error);
          // Check if the error is due to extension context issues
          if (response.error.includes('context') || response.error.includes('port')) {
            const fallbackText = mockAnalyzeQuestion(questionData);
            updateCallback("Extension error: " + response.error + "\n\nUsing offline mode:\n\n" + fallbackText);
          } else {
            updateCallback("Error: " + response.error);
          }
          return;
        }
        
        // Format and display the AI response
        console.log('[CreamHelper Debug] Formatting successful response:', response);
        let displayText = "";
        let suggestedOptionNumber = null;  // Track the suggested option number
        
        if (response.answer) {
          displayText += response.answer;
          
          // If AI is confident about a specific option
          if (response.suggestedOption && response.suggestedOption > 0) {
            suggestedOptionNumber = response.suggestedOption;
            // Only add the suggested answer if it's not already in the text
            if (!displayText.includes('Suggested Answer:') && !displayText.includes(`Option ${response.suggestedOption}`)) {
            displayText += `\n\nSuggested Answer: Option ${response.suggestedOption}`;
            }
          } else {
            // Try to extract option number from the answer text if it contains a pattern like "option 3" or "answer B"
            const optionMatch = response.answer.match(/\b(?:option|answer|choice)\s+(\d+|[A-D])\b/i);
            if (optionMatch) {
              const extractedOption = optionMatch[1];
              // Convert letter options (A,B,C,D) to numbers (1,2,3,4)
              if (/^[A-D]$/i.test(extractedOption)) {
                suggestedOptionNumber = extractedOption.toUpperCase().charCodeAt(0) - 64; // A=1, B=2, etc.
              } else {
                suggestedOptionNumber = parseInt(extractedOption);
              }
            }
            
            // Check for true/false recommendations
            if (!suggestedOptionNumber && 
                formattedQuestionData.options.includes('True') && 
                formattedQuestionData.options.includes('False')) {
              // Check for various ways the AI might indicate "True" is the answer
              if (displayText.match(/\bthe\s+(?:answer|correct\s+(?:answer|option|choice))\s+is\s+(?:"|')?true(?:"|')?/i) ||
                  displayText.match(/\b(?:statement|question)\s+is\s+(?:"|')?true(?:"|')?/i) ||
                  displayText.includes('answer is True') ||
                  displayText.includes('TRUE')) {
                suggestedOptionNumber = formattedQuestionData.options.indexOf('True') + 1;
              } 
              // Check for various ways the AI might indicate "False" is the answer
              else if (displayText.match(/\bthe\s+(?:answer|correct\s+(?:answer|option|choice))\s+is\s+(?:"|')?false(?:"|')?/i) ||
                       displayText.match(/\b(?:statement|question)\s+is\s+(?:"|')?false(?:"|')?/i) ||
                       displayText.includes('answer is False') ||
                       displayText.includes('FALSE')) {
                suggestedOptionNumber = formattedQuestionData.options.indexOf('False') + 1;
              }
            }
          }
        } else {
          displayText += "The AI was unable to provide a specific answer for this question.";
        }
        
        // Pass both the display text and the suggested option number to the callback
        updateCallback(displayText, suggestedOptionNumber);
      });
    } catch (error) {
      // Clear the timeout
      clearTimeout(timeoutId);
      responseReceived = true;
      
      console.error('[CreamHelper] Error in analyzeQuestionWithAI:', error);
      
      // Always fall back to the mock analysis on any error
      const fallbackText = mockAnalyzeQuestion(questionData);
      updateCallback("Error: " + error.message + "\n\nUsing offline mode:\n\n" + fallbackText);
    }
  }

  // Add a mock analysis function for fallback when OpenAI API is unavailable
  function mockAnalyzeQuestion(questionData) {
    const question = questionData.question || '';
    const options = questionData.options || [];
    
    // Basic analysis based on keywords in the question
    let analysis = "As a student, I'll analyze this question based on my knowledge and academic experience.\n\n";
    
    // Add some general tips based on question type
    if (question.toLowerCase().includes('true or false') || 
        (options.length === 2 && 
         options.some(o => o.toLowerCase().includes('true')) && 
         options.some(o => o.toLowerCase().includes('false')))) {
      // True/False question tips
      analysis += "This looks like a True/False question. Here's my approach:\n";
      analysis += "• Check for absolute terms like 'always', 'never', 'all', or 'none' - these often indicate false statements\n";
      analysis += "• Verify if any part of the statement is incorrect - if so, the entire statement is false\n";
      analysis += "• Remember that partially true statements are still false if any element is incorrect\n";
      analysis += "• Look for qualifiers like 'sometimes', 'often', or 'may' which might make a statement true\n";
    } else if (options.length >= 3) {
      // Multiple choice question tips
      analysis += "For this multiple-choice question, I recommend:\n";
      analysis += "• Eliminate obviously incorrect options first\n";
      analysis += "• Look for trick answers that are partially correct but not the best answer\n";
      analysis += "• Pay attention to qualifiers in the question like 'MOST likely' or 'BEST describes'\n";
      analysis += "• Use specific knowledge from your studies in " + detectSubject(question) + " to determine the correct answer\n";
    } else if (options.length === 0) {
      // Open-ended or fill-in-the-blank question
      analysis += "This appears to be an open-ended or fill-in-the-blank question. When approaching these:\n";
      analysis += "• Be precise with terminology - use the exact terms from your course materials\n";
      analysis += "• Keep answers concise but complete, covering all key points\n"; 
      analysis += "• Draw from your understanding of " + detectSubject(question) + " concepts\n";
      analysis += "• If unsure, try relating the answer to fundamental principles from your coursework\n";
    }
    
    // Add a more engaged, personalized conclusion
    analysis += "\nIf I were answering this on an exam, I'd carefully review all options, eliminate distractors, and choose the answer that best aligns with what I've learned in class. Remember to apply critical thinking and trust your knowledge!";
    
    return analysis;
  }

  // Helper function to detect the likely subject of a question
  function detectSubject(question) {
    const q = question.toLowerCase();
    
    if (q.includes('history') || q.includes('century') || q.includes('war') || 
        q.includes('revolution') || q.includes('civilization') || q.includes('empire')) {
      return 'history';
    } 
    else if (q.includes('biology') || q.includes('cell') || q.includes('organism') || 
             q.includes('species') || q.includes('dna') || q.includes('ecosystem')) {
      return 'biology';
    }
    else if (q.includes('chemistry') || q.includes('element') || q.includes('compound') || 
             q.includes('reaction') || q.includes('acid') || q.includes('molecule')) {
      return 'chemistry';
    }
    else if (q.includes('physics') || q.includes('force') || q.includes('energy') || 
             q.includes('motion') || q.includes('gravity') || q.includes('quantum')) {
      return 'physics';
    }
    else if (q.includes('math') || q.includes('equation') || q.includes('function') || 
             q.includes('calculate') || q.includes('solve for') || q.includes('value')) {
      return 'mathematics';
    }
    else if (q.includes('geography') || q.includes('country') || q.includes('continent') || 
             q.includes('capital') || q.includes('region') || q.includes('population')) {
      return 'geography';
    }
    else if (q.includes('literature') || q.includes('author') || q.includes('novel') || 
             q.includes('character') || q.includes('poem') || q.includes('wrote')) {
      return 'literature';
    }
    else if (q.includes('psychology') || q.includes('behavior') || q.includes('mental') || 
             q.includes('cognition') || q.includes('theory') || q.includes('development')) {
      return 'psychology';
    }
    else if (q.includes('economics') || q.includes('market') || q.includes('demand') || 
             q.includes('supply') || q.includes('price') || q.includes('economy')) {
      return 'economics';
    }
    else {
      return 'the relevant subject area';
    }
  }

  // Show popup for transcript with AI analysis capability
  function showTranscriptPopup(questionElement, position) {
    // Get the full question content with answers
    const questionData = getFullQuestionContent(questionElement);
    
    // Keep track of retry attempts
    let retryCount = 0;
    const MAX_RETRIES = 2;
    let currentSuggestedOption = null; // Track the current suggested option
    
    // Create the popup container
    const popup = document.createElement('div');
    popup.className = 'cream-popup';
    popup.style.position = 'fixed';
    popup.style.zIndex = '9999999';
    popup.style.backgroundColor = '#000000'; // Changed from white to black
    popup.style.color = 'white'; // Added white text color
    popup.style.borderRadius = '10px';
    popup.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5)';
    popup.style.width = '500px'; // Slightly wider for better readability
    popup.style.maxWidth = '90vw';
    popup.style.maxHeight = '80vh';
    popup.style.display = 'flex';
    popup.style.flexDirection = 'column';
    popup.style.overflow = 'hidden';
    
    // Position near the button
    popup.style.left = `${position.x}px`;
    popup.style.top = `${position.y}px`;
    
    // Create header bar
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '8px 12px';
    header.style.backgroundColor = '#000000'; // Changed from blue to black
    header.style.color = 'white';
    header.style.fontFamily = 'Arial, sans-serif';
    header.style.fontSize = '16px';
    header.style.fontWeight = 'bold';
    header.style.borderRadius = '10px 10px 0 0';
    header.style.borderBottom = '1px solid #333333'; // Added border for separation
    header.style.cursor = 'move'; // Add move cursor to indicate draggable
    
    const title = document.createElement('span');
    title.textContent = 'CREAM';
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.backgroundColor = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = 'white';
    closeBtn.style.fontSize = '24px';
    closeBtn.style.padding = '0';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.width = '30px';
    closeBtn.style.height = '30px';
    closeBtn.style.display = 'flex';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.lineHeight = '1';
    
    closeBtn.addEventListener('click', () => {
      // Close the popup
      if (popup.parentNode) {
        popup.parentNode.removeChild(popup);
      }
    });
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // Make popup draggable
    let isDragging = false;
    let offsetX, offsetY;
    
    header.addEventListener('mousedown', (e) => {
      // Ensure we're not clicking the close button
      if (e.target === closeBtn || e.target.closest('button')) {
        return;
      }
      
      isDragging = true;
      
      // Calculate the offset from the mouse position to the popup corner
      const popupRect = popup.getBoundingClientRect();
      offsetX = e.clientX - popupRect.left;
      offsetY = e.clientY - popupRect.top;
      
      // Prevent text selection during drag
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      // Update popup position as the mouse moves
      popup.style.left = (e.clientX - offsetX) + 'px';
      popup.style.top = (e.clientY - offsetY) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // Create content area for transcript
    const content = document.createElement('div');
    content.style.padding = '15px';
    content.style.overflowY = 'auto';
    content.style.maxHeight = 'calc(80vh - 80px)';
    content.style.backgroundColor = '#000000'; // Changed from white to black
    content.style.color = 'white'; // Added white text color
    
    // Create area for AI analysis
    const analysisArea = document.createElement('div');
    analysisArea.style.marginTop = '15px';
    analysisArea.style.padding = '15px';
    analysisArea.style.backgroundColor = '#111111'; // Dark gray background
    analysisArea.style.color = 'white'; // White text
    analysisArea.style.borderRadius = '8px';
    analysisArea.style.fontSize = '14px';
    analysisArea.style.lineHeight = '1.5';
    analysisArea.style.fontFamily = 'Arial, sans-serif';
    
    // Function to update analysis text
    const updateAnalysis = (analysisText, suggestedOption, isLoading) => {
      analysisArea.innerHTML = ''; // Clear previous content
      
      if (isLoading) {
        // Show loading spinner
        const loadingSpinner = document.createElement('div');
        loadingSpinner.style.width = '28px';
        loadingSpinner.style.height = '28px';
        loadingSpinner.style.borderRadius = '50%';
        loadingSpinner.style.border = '3px solid rgba(50,50,50,0.3)'; // Darker loading spinner
        loadingSpinner.style.borderTopColor = 'white'; // White spinner
        loadingSpinner.style.margin = '20px auto';
        loadingSpinner.style.animation = 'cream-spin 1s linear infinite';
        
        // Add animation style if not already added
        if (!document.querySelector('style[data-cream="spinner-animation"]')) {
          const style = document.createElement('style');
          style.dataset.cream = 'spinner-animation';
          style.textContent = `
            @keyframes cream-spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `;
          document.head.appendChild(style);
        }
        
        const loadingText = document.createElement('div');
        loadingText.textContent = analysisText || 'Analyzing...';
        loadingText.style.textAlign = 'center';
        loadingText.style.marginTop = '10px';
        loadingText.style.color = 'white'; // White text
        
        analysisArea.appendChild(loadingSpinner);
        analysisArea.appendChild(loadingText);
      } else {
        // Format the analysis text
        const formattedText = analysisText
          .replace(/\n\n/g, '<br/><br/>')
          .replace(/\n/g, '<br/>');
        
        analysisArea.innerHTML = formattedText;
        
        // If there's a suggested option, highlight it and auto-select it
        if (suggestedOption && typeof suggestedOption === 'number') {
          // Store the current suggestion
          currentSuggestedOption = suggestedOption;
          
          // Auto-select the answer immediately
          const autoSelectResult = autoSelectAnswer(questionElement, suggestedOption);
          
          // Create feedback about auto-selection
          const autoFeedback = document.createElement('div');
          autoFeedback.style.marginTop = '15px';
          autoFeedback.style.padding = '8px';
          autoFeedback.style.borderRadius = '4px';
          autoFeedback.style.fontSize = '13px';
          autoFeedback.style.textAlign = 'center';
          
          if (autoSelectResult.success) {
            autoFeedback.style.backgroundColor = '#1e3a00';
            autoFeedback.style.color = 'white';
            autoFeedback.textContent = `✓ Answer automatically selected: Option ${suggestedOption}`;
          } else {
            autoFeedback.style.backgroundColor = '#3a0000';
            autoFeedback.style.color = 'white';
            autoFeedback.textContent = `✗ Couldn't auto-select Option ${suggestedOption}`;
          }
          
          analysisArea.appendChild(autoFeedback);
          
          // Add button to manually select the answer (in case auto-select failed)
          const selectBtn = document.createElement('button');
          selectBtn.textContent = autoSelectResult.success ? 
            `Selected Option ${suggestedOption}` : 
            `Try selecting Option ${suggestedOption} again`;
          selectBtn.style.marginTop = '15px';
          selectBtn.style.padding = '8px 16px';
          selectBtn.style.backgroundColor = '#333333'; // Dark gray button
          selectBtn.style.color = 'white';
          selectBtn.style.border = 'none';
          selectBtn.style.borderRadius = '4px';
          selectBtn.style.cursor = 'pointer';
          selectBtn.style.display = 'block';
          selectBtn.style.width = '100%';
          
          // If auto-selection was successful, show a "selected" state
          if (autoSelectResult.success) {
            selectBtn.style.backgroundColor = '#1e3a00'; // Success green
            selectBtn.disabled = true;
          }
          
          selectBtn.addEventListener('mouseover', () => {
            if (!selectBtn.disabled) {
              selectBtn.style.backgroundColor = '#555555';
            }
          });
          
          selectBtn.addEventListener('mouseout', () => {
            if (!selectBtn.disabled) {
              selectBtn.style.backgroundColor = '#333333';
            } else {
              selectBtn.style.backgroundColor = '#1e3a00'; // Keep green if disabled
            }
          });
          
          selectBtn.addEventListener('click', () => {
            if (!selectBtn.disabled) {
              const result = autoSelectAnswer(questionElement, suggestedOption);
              
              // Show feedback
              const feedback = document.createElement('div');
              feedback.style.marginTop = '10px';
              feedback.style.padding = '8px';
              feedback.style.borderRadius = '4px';
              feedback.style.fontSize = '13px';
              
              if (result.success) {
                feedback.style.backgroundColor = '#1e3a00';
                feedback.style.color = 'white';
                feedback.textContent = `✓ ${result.message}`;
                selectBtn.disabled = true;
                selectBtn.style.backgroundColor = '#1e3a00';
                selectBtn.textContent = `Selected Option ${suggestedOption}`;
              } else {
                feedback.style.backgroundColor = '#3a0000';
                feedback.style.color = 'white';
                feedback.textContent = `✗ ${result.message}`;
              }
              
              analysisArea.appendChild(feedback);
            }
          });
          
          analysisArea.appendChild(selectBtn);
        }
        
        // Add retry button if the question wasn't answered well
        if (analysisText.includes("unable to provide") && retryCount < MAX_RETRIES) {
          const retryBtn = document.createElement('button');
          retryBtn.textContent = 'Try Again';
          retryBtn.style.marginTop = '15px';
          retryBtn.style.padding = '8px 16px';
          retryBtn.style.backgroundColor = '#333333'; // Dark gray button
          retryBtn.style.color = 'white';
          retryBtn.style.border = 'none';
          retryBtn.style.borderRadius = '4px';
          retryBtn.style.cursor = 'pointer';
          
          retryBtn.addEventListener('mouseover', () => {
            retryBtn.style.backgroundColor = '#555555';
          });
          
          retryBtn.addEventListener('mouseout', () => {
            retryBtn.style.backgroundColor = '#333333';
          });
          
          retryBtn.addEventListener('click', () => {
            retryCount++;
            retryBtn.textContent = `Retrying (${retryCount}/${MAX_RETRIES})...`;
            retryBtn.disabled = true;
            
            // Try again with the question
            analyzeQuestionWithAI(questionData, updateAnalysis);
          });
          
          analysisArea.appendChild(retryBtn);
        }
      }
    };
    
    // Add question to the content
    const questionHeader = document.createElement('div');
    questionHeader.style.fontWeight = 'bold';
    questionHeader.style.marginBottom = '10px';
    questionHeader.style.fontSize = '16px';
    questionHeader.textContent = 'Question:';
    
    const questionText = document.createElement('div');
    questionText.style.marginBottom = '15px';
    questionText.style.lineHeight = '1.4';
    
    // Format question text with options
    let formattedQuestion = questionData.question;
    
    if (questionData.options && questionData.options.length > 0) {
      formattedQuestion += '\n\nOptions:';
      questionData.options.forEach((option, index) => {
        formattedQuestion += `\n${index + 1}. ${option}`;
      });
    }
    
    // Format with line breaks
    questionText.innerHTML = formattedQuestion
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
    
    content.appendChild(questionHeader);
    content.appendChild(questionText);
    content.appendChild(analysisArea);
    
    // Assemble the popup
    popup.appendChild(header);
    popup.appendChild(content);
    
    // Add to body
    document.body.appendChild(popup);
    
    // Center horizontally if it would go offscreen
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth) {
      popup.style.left = `${Math.max(0, window.innerWidth - popupRect.width - 20)}px`;
    }
    if (popupRect.left < 0) {
      popup.style.left = '20px';
    }
    
    // Position vertically if it would go offscreen
    if (popupRect.bottom > window.innerHeight) {
      popup.style.top = `${Math.max(0, window.innerHeight - popupRect.height - 20)}px`;
    }
    
    // Initial loading state
    updateAnalysis('Analyzing your question...', null, true);
    
    // Process with AI
    analyzeQuestionWithAI(questionData, updateAnalysis);
  }

  // New function to auto-select the answer in the original question
  function autoSelectAnswer(questionElement, optionNumber) {
    try {
      if (!optionNumber || optionNumber <= 0) {
        console.warn('[CreamHelper] No valid option number provided for auto-selection');
        return { success: false, message: "No valid option number available" };
      }
      
      // Find all radio buttons and checkboxes in the question container
      const container = questionElement.closest('.question_holder, .display_question, [id^="question_"]') || questionElement;
      const inputElements = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      
      if (inputElements.length === 0) {
        console.warn('[CreamHelper] No input elements found for auto-selection');
        return { success: false, message: "No answer options found" };
      }
      
      // Canvas LMS typically has inputs grouped by the answer index
      const optionGroups = new Map();
      let lastLabelText = '';
      
      // First, group inputs by their visual position/label to determine a logical order
      inputElements.forEach(input => {
        // Try to find associated label text
        let labelText = '';
        
        // Method 1: Associated label
        if (input.id) {
          const label = container.querySelector(`label[for="${input.id}"]`);
          if (label) labelText = label.textContent.trim();
        }
        
        // Method 2: Parent label
        if (!labelText) {
          const parentLabel = input.closest('label');
          if (parentLabel) labelText = parentLabel.textContent.trim();
        }
        
        // Method 3: Next sibling text
        if (!labelText) {
          let next = input.nextSibling;
          while (next && (!next.textContent || !next.textContent.trim())) {
            next = next.nextSibling;
          }
          if (next && next.textContent) labelText = next.textContent.trim();
        }
        
        // If we found a label, consider this a separate option
        if (labelText && labelText !== lastLabelText) {
          lastLabelText = labelText;
          const optionCount = optionGroups.size + 1;
          optionGroups.set(optionCount, []);
        }
        
        // If no groups yet (no labels found), create first group
        if (optionGroups.size === 0) {
          optionGroups.set(1, []);
        }
        
        // Add input to its group
        const groupKey = optionGroups.size;
        const group = optionGroups.get(groupKey) || [];
        group.push(input);
        optionGroups.set(groupKey, group);
      });
      
      // If option groups couldn't be determined by labels, fall back to sequential ordering
      if (optionGroups.size <= 1 && inputElements.length > 1) {
        optionGroups.clear();
        inputElements.forEach((input, index) => {
          optionGroups.set(index + 1, [input]);
        });
      }
      
      // Find the option group matching the recommended number
      if (optionGroups.has(optionNumber)) {
        const targetInputs = optionGroups.get(optionNumber);
        
        // Click the first input in the group
        if (targetInputs.length > 0) {
          const targetInput = targetInputs[0];
          
          // Log what we're clicking
          console.log(`[CreamHelper] Auto-selecting option ${optionNumber}:`, targetInput);
          
          // Try Canvas-optimized click sequence for better compatibility
          
          // Find the associated label or clickable parent for better interaction
          let clickTarget = targetInput;
          let parentLabel = targetInput.closest('label');
          let associatedLabel = targetInput.id ? container.querySelector(`label[for="${targetInput.id}"]`) : null;
          
          // Prefer to click the label if available (more like a real user interaction)
          if (parentLabel) {
            clickTarget = parentLabel;
          } else if (associatedLabel) {
            clickTarget = associatedLabel;
          }
          
          // Get element position for realistic mouse events
          const rect = clickTarget.getBoundingClientRect();
          const centerX = Math.floor(rect.left + rect.width / 2);
          const centerY = Math.floor(rect.top + rect.height / 2);
          
          // 1. Create full mouse event sequence (mousedown, mouseup, click)
          // Canvas often checks for real mouse interaction sequence
          
          // MouseDown event - very important for Canvas
          const mouseDownEvent = new MouseEvent('mousedown', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY,
            button: 0, // Left button
            buttons: 1 // Primary button
          });
          clickTarget.dispatchEvent(mouseDownEvent);
          
          // MouseUp event
          const mouseUpEvent = new MouseEvent('mouseup', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY,
            button: 0, // Left button
            buttons: 0 // No buttons
          });
          clickTarget.dispatchEvent(mouseUpEvent);
          
          // Click event with proper coordinates
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY,
            button: 0, // Left button
            buttons: 0 // No buttons pressed during click event
          });
          clickTarget.dispatchEvent(clickEvent);
          
          // 2. Directly set the checked property
          targetInput.checked = true;
          
          // 3. Also try the regular click method as fallback
          if (clickTarget !== targetInput) {
            // If we clicked a label, also try clicking the input directly
            targetInput.click();
          }
          
          // 4. Trigger change & input events to ensure the UI updates
          // Canvas listens for these events
          const changeEvent = new Event('change', {
            bubbles: true,
            cancelable: true
          });
          targetInput.dispatchEvent(changeEvent);
          
          const inputEvent = new Event('input', {
            bubbles: true,
            cancelable: true
          });
          targetInput.dispatchEvent(inputEvent);
          
          // 5. Sometimes Canvas uses custom event listeners with jQuery
          // Try to trigger jQuery events if jQuery is available
          if (window.jQuery) {
            try {
              window.jQuery(targetInput).trigger('change');
              window.jQuery(targetInput).trigger('click');
            } catch (e) {
              console.log('[CreamHelper] jQuery trigger attempt failed:', e);
            }
          }
          
          return { success: true, message: `Selected option ${optionNumber}` };
        }
      }
      
      // If we got here, we couldn't find the right option
      console.warn(`[CreamHelper] Couldn't find option ${optionNumber} to auto-select`);
      return { 
        success: false, 
        message: `Couldn't find option ${optionNumber}. Found ${optionGroups.size} options total.` 
      };
    } catch (error) {
      console.error('[CreamHelper] Error in auto-select:', error);
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  // Create a cream button with standard styling
  function createCreamButton() {
    const button = document.createElement('button');
    button.className = 'cream-btn';
    button.textContent = 'CREAM';
    button.style.backgroundColor = '#000000'; // Changed from blue to black
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '20px';
    button.style.padding = '6px 16px';
    button.style.fontSize = '14px';
    button.style.fontFamily = 'Arial, sans-serif';
    button.style.cursor = 'pointer';
    button.style.marginLeft = '10px';
    button.style.marginRight = '6px'; // Add right margin for better spacing
    button.style.fontWeight = 'bold';
    button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    button.style.position = 'relative';
    button.style.zIndex = '9999999'; // Higher z-index
    button.style.display = 'inline-block'; // Ensure proper display
    button.style.verticalAlign = 'middle'; // Better alignment with text
    button.style.transition = 'all 0.2s ease'; // Smooth hover transition
    
    // Add a timestamp for debugging
    button.dataset.createdAt = Date.now();
    
    // Hover effect
    button.addEventListener('mouseover', () => {
      button.style.backgroundColor = '#333333'; // Changed from blue to dark gray
      button.style.boxShadow = '0 3px 6px rgba(0,0,0,0.3)';
    });
    
    button.addEventListener('mouseout', () => {
      button.style.backgroundColor = '#000000'; // Changed from blue to black
      button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    });
    
    // Focus indicator (accessibility)
    button.addEventListener('focus', () => {
      button.style.outline = '2px solid white';
      button.style.backgroundColor = '#333333'; // Changed from blue to dark gray
    });
    
    button.addEventListener('blur', () => {
      button.style.outline = 'none';
      button.style.backgroundColor = '#000000'; // Changed from blue to black
    });
    
    return button;
  }

  // Add buttons to Canvas question headers (only on main headers)
  function addCanvasButtons() {
    // Canvas uses a different structure for quizzes - target only main headers
    const questionHeaders = document.querySelectorAll('.question_name');
    let canvasButtonsAdded = 0;
    
    // Track elements that already have buttons
    const processedHeaders = new Set();
    
    logDebug(`Found ${questionHeaders.length} Canvas question headers`);
    
    // First, mark all elements that already have buttons
    document.querySelectorAll('.cream-btn').forEach(btn => {
      const parent = btn.parentElement;
      if (parent) {
        processedHeaders.add(parent);
      }
    });
    
    questionHeaders.forEach(header => {
      // Skip if already has our button or is already processed
      if (header.querySelector('.cream-btn') || processedHeaders.has(header)) return;
      
      // Mark this header as processed
      processedHeaders.add(header);
      
      try {
        // Create button
        const button = createCreamButton();
        
        // Click handler
        button.addEventListener('click', (e) => {
          // Prevent default action and stop propagation to prevent form submission
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // Calculate position for popup
          const buttonRect = button.getBoundingClientRect();
          const position = {
            x: buttonRect.left + buttonRect.width / 2,
            y: buttonRect.top + buttonRect.height + 10
          };
          
          // Show the transcript popup with the element (not just text)
          showTranscriptPopup(header, position);
          
          // Return false to prevent default action
          return false;
        });
        
        // Add the button to the header
        header.appendChild(button);
        canvasButtonsAdded++;
        
        logDebug(`Added Canvas CREAM button to: ${header.textContent.substring(0, 50)}...`);
      } catch (error) {
        console.error('[CreamHelper] Error adding Canvas button:', error);
      }
    });
    
    // No fallbacks here - we're being more selective
    return canvasButtonsAdded;
  }

  // Add transcript buttons next to main question headers only
  function addTranscriptButtons() {
    let buttonsAdded = 0;
    
    // Track elements that already have buttons to avoid duplicates
    const processedElements = new Set();
    
    // Check if this is a Canvas page and use specialized handling
    if (isCanvasPage || checkIfCanvas()) {
      const canvasButtonsAdded = addCanvasButtons();
      buttonsAdded += canvasButtonsAdded;
      
      // Mark all elements with buttons as processed
      document.querySelectorAll('.cream-btn').forEach(btn => {
        const parent = btn.parentElement;
        if (parent) {
          processedElements.add(parent);
        }
      });
      
      if (canvasButtonsAdded > 0) {
        logDebug(`Added ${canvasButtonsAdded} buttons using Canvas-specific method`);
        return buttonsAdded;
      }
    }
    
    // Standard method for other pages - find main question headers only
    const questions = findQuestionHeaders();
    
    questions.forEach(({element, text, isCanvas, isHeading}) => {
      try {
        // Skip if we've already added a button to this element or if it's already been processed
        if (element.querySelector('.cream-btn') || processedElements.has(element)) return;
        
        // Mark element as processed
        processedElements.add(element);
        
        // Get question number/ID
        const questionNumber = extractQuestionNumber(text);
        const questionId = `question-${questionNumber}`;
        
        // Skip if we've already added a button to this question ID
        if (questionButtons.has(questionId) && questionButtons.get(questionId).button) return;
        
        // Create the button
        const button = createCreamButton();
        
        // Click handler
        button.addEventListener('click', (e) => {
          // Prevent default action and stop propagation to prevent form submission
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // Calculate position for popup
          const buttonRect = button.getBoundingClientRect();
          const position = {
            x: buttonRect.left + buttonRect.width / 2,
            y: buttonRect.top + buttonRect.height + 10
          };
          
          // Show the transcript popup with the element (not just text)
          const popup = showTranscriptPopup(element, position);
          
          // Store reference to the button and popup
          questionButtons.set(questionId, {
            button,
            popup
          });
          
          // Return false to prevent default action
          return false;
        });
        
        // Add the button to the element
        if (element.querySelector('h1, h2, h3, h4, h5, h6') && !element.closest('h1, h2, h3, h4, h5, h6')) {
          // If the element contains a heading but is not itself a heading, add button after the heading
          const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
          heading.appendChild(button);
        } else {
          // Otherwise add button to the element itself
          element.appendChild(button);
        }
        
        // Store button reference
        questionButtons.set(questionId, {
          button,
          popup: null
        });
        
        buttonsAdded++;
        logDebug(`Added CREAM button to header: ${text.substring(0, 50)}...`);
      } catch (error) {
        console.error('[CreamHelper] Error adding CREAM button:', error);
      }
    });
    
    logDebug(`Added ${buttonsAdded} CREAM buttons to main question headers`);
    return buttonsAdded;
  }

  // Initialize the feature
  function initialize() {
    logDebug('Initializing CREAM button feature for main question headers only');
    
    // First, remove any existing buttons (in case of extension reload)
    removeExistingButtons();
    
    // Check if extension context is valid
    const extensionValid = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    if (!extensionValid) {
      logDebug('Extension context is invalid! Running in offline-only mode');
      // Even without valid extension context, we can still add buttons that will use offline fallback
    }
    
    // Check if we're on Canvas
    if (checkIfCanvas()) {
      logDebug('Canvas LMS detected - using specialized handling');
      // Add Canvas-specific buttons (main headers only)
      addCanvasButtons();
    }
    
    // Add CREAM buttons to existing main question headers
    addTranscriptButtons();
    
    // Set up periodic check for new questions (less frequent)
    const periodicCheck = setInterval(() => {
      // Check if window still exists (page not unloaded)
      if (typeof window === 'undefined') {
        clearInterval(periodicCheck);
        return;
      }
      
      addTranscriptButtons();
      
      // Also check if extension context is still valid
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        // We're still running but extension context is now invalid
        // This is fine - buttons will use offline mode
        logDebug('Extension context has become invalid during execution');
      }
    }, 5000);
    
    // Setup error handler for uncaught errors
    window.addEventListener('error', function(event) {
      console.error('[CreamHelper] Uncaught error:', event.error);
      // Don't rethrow, just log - this prevents crashing when extension context changes
      event.preventDefault();
    });
    
    // Only register message listener if extension context is valid
    if (extensionValid) {
      try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          if (message.action === 'openaiResponse') {
            logDebug('Received AI analysis response');
            sendResponse({success: true});
            return true;
          }
        });
      } catch (e) {
        logDebug('Error setting up message listener: ' + e.message);
        // This is fine - we'll just use offline mode
      }
    }
  }

  // Start on page load with multiple safeguards to ensure buttons are added
  function safeInitialize() {
    try {
      initialize();
    } catch (e) {
      console.error('[CreamHelper] Error during initialization:', e);
      // Try again with a delay in case of temporary issue
      setTimeout(() => {
        try {
          // Even if initialize fails, try to at least add the buttons
          addTranscriptButtons();
        } catch (innerError) {
          console.error('[CreamHelper] Fatal error adding transcript buttons:', innerError);
        }
      }, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInitialize);
  } else {
    // Document already loaded, initialize immediately
    safeInitialize();
  }

  // Also check when the page content changes
  window.addEventListener('load', () => {
    setTimeout(addTranscriptButtons, 1000);
  });

  // Check for URL changes (for single-page applications)
  window.addEventListener('hashchange', () => {
    setTimeout(() => {
      try {
        addTranscriptButtons();
      } catch (e) {
        console.error('[CreamHelper] Error adding buttons after hash change:', e);
      }
    }, 1000);
  });

  // Add DOM mutation observer to detect new content (but with a delay to reduce CPU usage)
  try {
    const observer = new MutationObserver((mutations) => {
      // Debounce - don't check on every single DOM change
      clearTimeout(window.creamDebouncedUpdate);
      window.creamDebouncedUpdate = setTimeout(() => {
        try {
          addTranscriptButtons();
        } catch (e) {
          console.error('[CreamHelper] Error adding buttons after DOM mutation:', e);
        }
      }, 2000);
    });

    // Start observing with more selective options
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false, // Don't need to observe text changes
    });
  } catch (e) {
    console.error('[CreamHelper] Error setting up mutation observer:', e);
    // Still try to add buttons periodically as fallback
    setInterval(() => {
      try {
        addTranscriptButtons();
      } catch (innerError) {
        // Just log, don't crash the extension
        console.error('[CreamHelper] Error in periodic button check:', innerError);
      }
    }, 5000);
  }

  // Initialize immediately to catch any timing issues
  setTimeout(safeInitialize, 500);
  
})(); // End of IIFE - all variables are now contained in this scope 
