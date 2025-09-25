// Creamy extension - Question Transcript Feature
// Adds "CREAM" buttons next to questions to quickly capture and analyze content

// Wrap everything in an IIFE to avoid global variable collisions
(function() {
  // Global variables (now scoped to this IIFE)
  let questionButtons = new Map();
  let isProcessing = false;
  let isCanvasPage = false;
  let isMHEPage = false; // track McGraw Hill page
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
  
  // Check if this is a McGraw-Hill Education page
  function checkIfMHE() {
    const isMHEURL = window.location.hostname.includes('mheducation.com');
    const hasMHEElements = document.querySelector('.multiple-choice-component, .multiple-select-component, .assessment-part') !== null;
    isMHEPage = isMHEURL || hasMHEElements;
    if (isMHEPage) {
      logDebug('Detected McGraw-Hill Learning page - using specialized handling');
    }
    return isMHEPage;
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
    // --- REMOVE LOGGING ---
    // console.log('[CreamHelper DIAGNOSTIC] Starting extraction within container:', container);
    let result = {
      question: "",
      options: [],
      fullText: "",
      contextText: "", // Additional field for context
      source: "standard_extraction",
      images: [] // Add an array to store image URLs
    };
    let headerText = ""; // Initialize headerText

    try {
      // First, temporarily hide any CREAM buttons
      const creamButtons = container.querySelectorAll('.cream-btn');
      creamButtons.forEach(btn => {
        btn.dataset.originalDisplay = btn.style.display;
        btn.style.display = 'none';
      });

      result.contextText = container.textContent.trim();

      // --- MODIFIED EXTRACTION LOGIC --- 
      // Priority 1: Look for a specific question body element first
      const questionBodyElement = container.querySelector('.question_text, .text, .stem'); // Common classes for question body
      if (questionBodyElement) {
        const clonedBody = questionBodyElement.cloneNode(true);
        const buttonsInClone = clonedBody.querySelectorAll('.cream-btn');
        buttonsInClone.forEach(btn => btn.remove());
        headerText = clonedBody.textContent.trim();
        // --- REMOVE LOGGING ---
        // logDebug(`[DIAGNOSTIC] Text found via Question Body Strategy (.question_text, .text, .stem): ${headerText.substring(0, 150)}...`);
      }

      // Priority 2: If no body found, look for the header element (like .question_name)
      if (!headerText) {
        const questionHeader = container.querySelector('h1, h2, h3, h4, h5, h6, .question_name, .question-header, .questionHeader, .quiz_question');
        if (questionHeader) {
          // Found the header, BUT DON'T use its text directly yet.
          // Try to find the actual question text nearby, e.g., the next sibling div
          let sibling = questionHeader.nextElementSibling;
          while (sibling && sibling.nodeName !== 'DIV' && !sibling.textContent.trim()) {
            // Skip non-divs or empty siblings
            sibling = sibling.nextElementSibling;
          }
          if (sibling && sibling.nodeName === 'DIV' && sibling.textContent.trim()) {
            const clonedSibling = sibling.cloneNode(true);
            const buttonsInSiblingClone = clonedSibling.querySelectorAll('.cream-btn');
            buttonsInSiblingClone.forEach(btn => btn.remove());
            headerText = clonedSibling.textContent.trim();
            // --- REMOVE LOGGING ---
            // logDebug(`[DIAGNOSTIC] Text found via Header's Next Sibling Div Strategy: ${headerText.substring(0, 150)}...`);
          } else {
            // --- REMOVE LOGGING ---
            // logDebug(`[DIAGNOSTIC] Found header (.question_name, h*, etc.), but couldn't find suitable sibling text. Will proceed to container/paragraph checks.`);
          }
          // NOTE: We no longer assign the header's own text here initially
          // logDebug(`Extracted header text: ${headerText.substring(0, 50)}...`); 
        }
      }

      // Priority 3: Look for specific question containers (if header/body strategies failed)
      if (!headerText) {
        const possibleQuestionContainers = container.querySelectorAll('.question-text, .question-stem, [aria-label*="question"]');
        for (const qContainer of possibleQuestionContainers) {
          if (qContainer.textContent && qContainer.textContent.trim().length > 10) {
            headerText = qContainer.textContent.trim();
            // --- REMOVE LOGGING ---
            // logDebug(`[DIAGNOSTIC] Text found via Container Strategy: ${headerText.substring(0, 150)}...`);
            break;
          }
        }
      }

      // Priority 4: Paragraph strategy (if others failed)
      if (!headerText) {
        const paragraphs = container.querySelectorAll('p, div:not(:has(*))');
        for (const p of paragraphs) {
          if (p.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
          if (p.textContent.trim().length < 10) continue;
          if (p.offsetParent === null || getComputedStyle(p).display === 'none') continue;
          headerText = p.textContent.trim();
          // --- REMOVE LOGGING ---
          // logDebug(`[DIAGNOSTIC] Text found via Paragraph Strategy: ${headerText.substring(0, 150)}...`);
          break;
        }
      }

      // Priority 5: Final fallback (if nothing else worked)
      if (!headerText && container.textContent.trim().length > 0) {
        // Try to be smarter: Exclude known header patterns from the start of the text
        let fullContainerText = container.textContent.trim();
        fullContainerText = fullContainerText.replace(/^\s*Unanswered\s*Question\s*\d+\s*/i, '').trim(); // Remove header pattern
        headerText = fullContainerText.split(/\n/)[0]; // First line of remaining text
        if (headerText.length > 200) headerText = headerText.substring(0, 200) + '...';
        // --- REMOVE LOGGING ---
        // logDebug(`[DIAGNOSTIC] Text found via Fallback Strategy (First line of container minus header): ${headerText}`);
      }
      // --- END OF MODIFIED EXTRACTION LOGIC ---

      // Assign the found text (if any) to result.question
      result.question = headerText; // Assign whatever was found (could still be empty)

      // Restore CREAM buttons visibility
      creamButtons.forEach(btn => {
        btn.style.display = btn.dataset.originalDisplay || '';
        delete btn.dataset.originalDisplay;
      });

      // Clean up the question text (even if it's empty)
      const originalQuestionText = result.question; // Store before cleaning
      result.question = cleanQuestionText(result.question);
      // --- REMOVE LOGGING ---
      // logDebug(`[DIAGNOSTIC] Question text BEFORE cleaning: ${originalQuestionText.substring(0, 150)}...`);
      // logDebug(`[DIAGNOSTIC] Question text AFTER cleaning: ${result.question.substring(0, 150)}...`);

      // Find answer options
      findAnswerOptionsImproved(container, result);

      // Image extraction (remains the same)
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

      // Create formatted full text
      result.fullText = result.question + "\n\n";
      if (result.images.length > 0) {
          result.fullText += `\n[Image${result.images.length > 1 ? 's' : ''} present in question]\n`;
      }
      if (result.options.length > 0) {
        result.fullText += "Options:\n";
        result.options.forEach((option, index) => {
          result.fullText += `${index + 1}. ${option}\n`;
        });
      }

      // Validation check (now uses the potentially cleaned, possibly empty, question text)
      if (!result.question || result.question.length < 10) {
        // Log error if still invalid after all attempts and cleaning
        console.error('[CreamHelper] Failed to extract valid question text after cleaning from', container);
        // Keep placeholder logic
        result.question = "Unable to extract question content. Please try selecting a more specific element.";
        result.source = "extraction_failed";
      } else {
        logDebug(`Successfully extracted question with ${result.options.length} options`);
      }

    } catch (error) {
      console.error('[CreamHelper] Error extracting question content:', error);
      result.fullText = container.textContent.trim();
      result.question = "Error extracting question. Please try again or select a more specific element.";
      result.source = "error";
    }

    // --- REMOVE LOGGING ---
    logDebug('[CreamHelper DIAGNOSTIC] Final extracted data before return:', JSON.stringify(result, null, 2));
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
    // --- ADDED LOGGING ---
    logDebug('[CreamHelper DIAGNOSTIC] Starting findAnswerOptionsImproved within:', container);
    
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
            // --- ADDED LOGGING ---
            logDebug(`[DIAGNOSTIC] Found option via Radio Strategy: ${optionText}`);
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
            // --- ADDED LOGGING ---
            logDebug(`[DIAGNOSTIC] Found option via List/Div Strategy: ${text}`);
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
            // --- ADDED LOGGING ---
            logDebug(`[DIAGNOSTIC] Found option via Sibling Div Strategy: ${text}`);
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
              // --- ADDED LOGGING ---
              logDebug(`[DIAGNOSTIC] Found option via Parent Scan Strategy: ${combined}`);
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
        // --- ADDED LOGGING ---
        logDebug('[DIAGNOSTIC] Added True/False options');
      }
      
      // For fill-in-the-blank questions
      if (result.question.includes('_____') && result.options.length === 0) {
        result.options.push("[Fill in the blank]");
        // --- ADDED LOGGING ---
        logDebug('[DIAGNOSTIC] Added Fill-in-the-blank option marker');
      }
      
      // Log what we found
      // --- ADDED LOGGING ---
      logDebug(`[CreamHelper DIAGNOSTIC] Finished findAnswerOptionsImproved. Found ${result.options.length} options total.`);
      logDebug(`Found ${result.options.length} options with improved method`); // Keep original
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

  // Find question elements on the page (focusing on containers)
  function findQuestionHeaders() {
    logDebug('Looking for main question containers/headers on the page...');
    
    const processedElements = new Set();
    const questionElements = []; // Stores { element: containerElement, text: headerText }
    
    // --- Priority 1: Canvas Question Containers (div[id^="question_"]) ---
    if (isCanvasPage || checkIfCanvas()) {
      const canvasContainers = document.querySelectorAll('div[id^="question_"]');
      logDebug(`Priority 1: Found ${canvasContainers.length} potential Canvas containers (div[id^=question_])`);
      canvasContainers.forEach(container => {
        if (processedElements.has(container) || !container.querySelector('.question_text, .text, .answer')) {
          return;
        }
        const header = container.querySelector('.question_name, .header .name, h1, h2, h3');
        const headerText = header ? header.textContent.trim() : container.textContent.trim().substring(0, 100);
        processedElements.add(container);
        questionElements.push({ element: container, text: headerText, isCanvas: true, strategy: 'id_container' });
        logDebug(`Added Canvas container by ID: ${container.id}`);
      });
    }

    // --- Priority 2: Specific Header Structure (<div class="header"><span class="question_name">...) ---
    if (isCanvasPage || checkIfCanvas()) {
      const specificHeaders = document.querySelectorAll('div.header > span.question_name');
      logDebug(`Priority 2: Found ${specificHeaders.length} specific headers (div.header > span.question_name)`);
      specificHeaders.forEach(nameSpan => {
          // Find the closest ancestor container that holds the whole question
          const container = nameSpan.closest('div[id^="question_"], .question_holder, .display_question');
          if (container && !processedElements.has(container)) {
              const headerText = nameSpan.textContent.trim();
              processedElements.add(container);
              questionElements.push({ element: container, text: headerText, isCanvas: true, strategy: 'specific_header' });
              logDebug(`Added Canvas container via specific header: ${headerText}`);
          } else if (container && processedElements.has(container)){
              logDebug(`Skipping specific header container - already processed: ${nameSpan.textContent.trim()}`);
          } else {
              logDebug(`Could not find suitable parent container for specific header: ${nameSpan.textContent.trim()}`);
          }
      });
    }
    
    // --- Fallback 1: Canvas Question Holders/Display Questions ---
    if (questionElements.length === 0 && (isCanvasPage || checkIfCanvas())) {
        const canvasHolders = document.querySelectorAll('.question_holder, .display_question');
        logDebug(`Fallback 1: Found ${canvasHolders.length} .question_holder/.display_question elements`);
        canvasHolders.forEach(holder => {
            if (processedElements.has(holder)) return;
            const header = holder.querySelector('.question_name, .header .name, h1, h2, h3');
            const headerText = header ? header.textContent.trim() : holder.textContent.trim().substring(0, 100);
            processedElements.add(holder);
            questionElements.push({ element: holder, text: headerText, isCanvas: true, strategy: 'holder_class' });
            logDebug(`Added Canvas holder by class: ${holder.className}`);
        });
    }

    // --- Fallback 2: Generic Heading Elements (Question X) ---
    if (questionElements.length === 0) {
      logDebug('Fallback 2: Looking for generic heading elements (h1-h6 with Question X pattern)...');
    const questionHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    questionHeadings.forEach(heading => {
      const text = heading.textContent.trim();
        if ((/^Question\s+\d+/i.test(text) || /^Q\.?\s*\d+/i.test(text)) && text.length < 50) {
          const container = heading.closest('div, section, article') || heading;
          if (processedElements.has(container)) return;
          processedElements.add(container);
          questionElements.push({ element: container, text: text, strategy: 'generic_heading' });
          logDebug(`Added generic heading container: ${text}`);
        }
      });
    }

    // --- Fallback 3: Specific Class Names (less common) ---
    if (questionElements.length === 0) {
        logDebug('Fallback 3: Looking for specific class names like .question-header...');
        const headerElements = document.querySelectorAll('.question-header, .questionHeader, [role="heading"][aria-level]'); // More specific role
        headerElements.forEach(element => {
            const text = element.textContent?.trim();
            if (!text || text.length > 100) return; // Basic text validation

            if (/Question\s+\d+/i.test(text)) {
                const container = element.closest('div, section, article') || element;
                 if (processedElements.has(container)) return;
                processedElements.add(container);
                questionElements.push({ element: container, text: text, strategy: 'class_heading' });
                logDebug(`Added specific class/role header container: ${text}`);
        }
      });
    }
    
    // --- Priority MHE: Multiple Choice Component ---
    if (isMHEPage || checkIfMHE()) {
      const mheContainers = document.querySelectorAll('div.multiple-choice-component, div.multiple-select-component');
      logDebug(`MHE: Found ${mheContainers.length} .multiple-choice-component and .multiple-select-component elements`);
      mheContainers.forEach(container => {
        if (processedElements.has(container)) return;
        const headerDiv = container.closest('div').querySelector('.prompt');
        const headerText = headerDiv ? headerDiv.textContent.trim() : container.textContent.trim().substring(0,100);
        processedElements.add(container);
        questionElements.push({ element: container, text: headerText, strategy: 'mhe_multiple_choice' });
      });
    }
    
    logDebug(`Finished finding questions. Total unique containers found: ${questionElements.length}`);
    
    // Return the array (already ensures unique containers because we check processedElements)
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
  async function analyzeQuestionWithAI(questionData) { // Removed updateCallback, added async
    // First, check if Chrome runtime is valid
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      console.warn('[CreamHelper] Extension context appears to be invalidated');
      // Use mock analysis as fallback
      const fallbackText = mockAnalyzeQuestion(questionData);
      // Reject the promise with fallback info
      return Promise.reject({ 
        error: "Extension Context Error. Using offline mode.", 
        fallbackText: fallbackText 
      });
    }
    
    console.log('[CreamHelper Debug] Preparing to send data to OpenAI:', questionData);
    
    const formattedQuestionData = {
      question: questionData.question,
      options: questionData.options || [],
      fullText: questionData.fullText,
      contextText: questionData.contextText || questionData.fullText || questionData.question,
      images: questionData.images || [] 
    };
    
    const needsExternalKnowledge = 
        questionData.question.includes("according to") || 
        questionData.question.includes("in the video") || 
        questionData.question.includes("scammer videos") ||
        questionData.question.includes("Browning's");
        
    if (needsExternalKnowledge) {
      formattedQuestionData.contextText += "\n\nNote: This question requires knowledge about external content. If you don't have this information, please provide your best guess based on the options and context clues. Select the most likely answer rather than stating you cannot determine the answer.";
      formattedQuestionData.forceAnswer = true;
    }
    
    logDebug(`Question being sent: ${formattedQuestionData.question.substring(0, 100)}...`);
    logDebug(`Options count: ${formattedQuestionData.options.length}`);
    formattedQuestionData.options.forEach((opt, idx) => {
      logDebug(`Option ${idx + 1}: ${opt.substring(0, 50)}...`);
    });
    
    const requestData = {
      action: 'processQuestionWithOpenAI',
      questionData: formattedQuestionData
    };
    
    // Return a Promise that handles the async message passing
    return new Promise((resolve, reject) => {
    let responseReceived = false;
    const timeoutDuration = 20000; // 20 seconds timeout

    const timeoutId = setTimeout(() => {
      if (!responseReceived) {
        console.warn('[CreamHelper] Analysis request timed out');
        const fallbackText = mockAnalyzeQuestion(questionData);
          reject({ 
            error: "Request timed out. Using offline mode.", 
            fallbackText: fallbackText 
          });
      }
    }, timeoutDuration);
    
    try {
      const checkExtensionContext = () => {
        try {
          return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
        } catch (e) {
          return false;
        }
      };
      
      if (!checkExtensionContext()) {
        clearTimeout(timeoutId);
        const fallbackText = mockAnalyzeQuestion(questionData);
          reject({ 
            error: "Extension context lost before sending. Using offline mode.", 
            fallbackText: fallbackText 
          });
        return;
      }
      
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
        
        if (!checkExtensionContext()) {
          const fallbackText = mockAnalyzeQuestion(questionData);
            reject({ 
              error: "Extension context lost after receiving response. Using offline mode.", 
              fallbackText: fallbackText 
            });
          return;
        }
        
        if (chrome.runtime.lastError) {
          console.error('[CreamHelper] Runtime error:', chrome.runtime.lastError);
          const errorMsg = chrome.runtime.lastError.message || "Unknown error";
          if (errorMsg.includes('invalid') || errorMsg.includes('port closed')) {
            const fallbackText = mockAnalyzeQuestion(questionData);
              reject({ 
                error: "Extension service unavailable. Using offline mode.", 
                fallbackText: fallbackText 
              });
          } else {
              reject({ error: "Runtime Error: " + errorMsg });
          }
          return;
        }
        
        if (!response) {
          console.log('[CreamHelper Debug] Empty response received');
          const fallbackText = mockAnalyzeQuestion(questionData);
            reject({ 
              error: "No response received. Using offline mode.", 
              fallbackText: fallbackText 
            });
          return;
        }
        
        if (response.error) {
          console.log('[CreamHelper Debug] Error in response:', response.error);
          if (response.error.includes('context') || response.error.includes('port')) {
            const fallbackText = mockAnalyzeQuestion(questionData);
              reject({ 
                error: "Extension error: " + response.error + ". Using offline mode.", 
                fallbackText: fallbackText 
              });
          } else {
              reject({ error: "Error from background: " + response.error });
          }
          return;
        }
        
          // Format and RESOLVE the AI response
        console.log('[CreamHelper Debug] Formatting successful response:', response);
          let analysisResult = { 
            answer: "", 
            suggestedOption: null,
            suggestedOptions: []
          };
        
        if (response.answer) {
            analysisResult.answer = response.answer;
          
          if (response.suggestedOption && response.suggestedOption > 0) {
              analysisResult.suggestedOption = response.suggestedOption;
          } else {
              // Try to extract option number from the answer text
            const optionMatch = response.answer.match(/\b(?:option|answer|choice)\s+(\d+|[A-D])\b/i);
            if (optionMatch) {
              const extractedOption = optionMatch[1];
              if (/^[A-D]$/i.test(extractedOption)) {
                  analysisResult.suggestedOption = extractedOption.toUpperCase().charCodeAt(0) - 64;
              } else {
                  analysisResult.suggestedOption = parseInt(extractedOption);
              }
            }
            
            // Extract multiple option numbers/letters
            const multiMatch = response.answer.match(/(?:option|choice|answer)?\s*([A-D]|\d)+(?:\s*,\s*|\s+and\s+|\s+&\s+|\s+)([A-D]|\d)+/ig);
            if (multiMatch) {
              const nums = [];
              multiMatch.forEach(seg => {
                seg.split(/[^A-D0-9]+/i).forEach(tok=>{
                  if(tok){nums.push(tok);}
                });
              });
              analysisResult.suggestedOptions = nums.map(t=>/^[A-D]$/i.test(t)? t.toUpperCase().charCodeAt(0)-64 : parseInt(t));
            }
            
            // Check for true/false recommendations
              if (!analysisResult.suggestedOption && 
                formattedQuestionData.options.includes('True') && 
                formattedQuestionData.options.includes('False')) {
                if (analysisResult.answer.match(/\b(?:answer|correct\s+(?:answer|option|choice))\s+is\s+(?:"|')?true(?:"|')?/i) ||
                    analysisResult.answer.match(/\b(?:statement|question)\s+is\s+(?:"|')?true(?:"|')?/i) ||
                    analysisResult.answer.includes('answer is True') ||
                    analysisResult.answer.includes('TRUE')) {
                  analysisResult.suggestedOption = formattedQuestionData.options.indexOf('True') + 1;
                } 
                else if (analysisResult.answer.match(/\b(?:answer|correct\s+(?:answer|option|choice))\s+is\s+(?:"|')?false(?:"|')?/i) ||
                         analysisResult.answer.match(/\b(?:statement|question)\s+is\s+(?:"|')?false(?:"|')?/i) ||
                         analysisResult.answer.includes('answer is False') ||
                         analysisResult.answer.includes('FALSE')) {
                  analysisResult.suggestedOption = formattedQuestionData.options.indexOf('False') + 1;
              }
            }
          }
        } else {
            analysisResult.answer = "The AI was unable to provide a specific answer for this question.";
        }
        
          resolve(analysisResult); // Resolve the promise with the result
      });
    } catch (error) {
      clearTimeout(timeoutId);
      responseReceived = true;
        console.error('[CreamHelper] Error sending message in analyzeQuestionWithAI:', error);
      const fallbackText = mockAnalyzeQuestion(questionData);
        reject({ 
          error: "Error: " + error.message + ". Using offline mode.", 
          fallbackText: fallbackText 
        });
    }
    }); // End of Promise
  } // End of function

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
    
    // Process with AI - MODIFIED to handle the Promise correctly
    analyzeQuestionWithAI(questionData)
      .then(analysisResult => {
        const optionsArr = analysisResult.suggestedOptions && analysisResult.suggestedOptions.length ? analysisResult.suggestedOptions : analysisResult.suggestedOption;
        updateAnalysis(analysisResult.answer, optionsArr, false);
      })
      .catch(errorInfo => {
        // On error, call updateAnalysis with the error message and fallback
        updateAnalysis(
          errorInfo.error + (errorInfo.fallbackText ? "\n\n" + errorInfo.fallbackText : ""), 
          null, 
          false
        );
      });
  }

  // New function to auto-select the answer in the original question
  function autoSelectAnswer(questionElement, optionNumber) {
    try {
      // Handle array of options for multiple selection
      if (Array.isArray(optionNumber)) {
        return autoSelectMultipleOptions(questionElement, optionNumber);
      }
      
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
      
      // >>> NEW SIMPLE INDEX FALLBACK <<<
      const selectByIndexFallback = () => {
        if (optionNumber > inputElements.length) return false;
        const targetInput = inputElements[optionNumber - 1];
        if (!targetInput) return false;
        let clickTarget = targetInput;
        const mheWrapper = targetInput.closest('mhe-checkbox');
        const spanContainer = targetInput.closest('label')?.querySelector('span.choice-container');
        if (spanContainer) {
          clickTarget = spanContainer;
        } else if (mheWrapper) {
          clickTarget = mheWrapper;
        }
        const clickSequence = (el) => {
          const rect = el.getBoundingClientRect();
          const cx = Math.floor(rect.left + rect.width/2);
          const cy = Math.floor(rect.top + rect.height/2);
          ['mousedown','mouseup','click'].forEach(ev=>{
            el.dispatchEvent(new MouseEvent(ev,{view:window,bubbles:true,cancelable:true,clientX:cx,clientY:cy,button:0}));
          });
        };
        clickSequence(clickTarget);
        targetInput.checked = true;
        const changeEv = new Event('change',{bubbles:true});
        targetInput.dispatchEvent(changeEv);
        const inputEv = new Event('input',{bubbles:true});
        targetInput.dispatchEvent(inputEv);
        return true;
      };
      
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
           
           // Select random confidence and click next button
           selectRandomConfidence();
           setTimeout(() => {
             const nextButton = document.querySelector('button.btn.btn-primary.next-button, .btn.btn-primary.next-button, button[class*="next-button"]');
             if (nextButton && !nextButton.disabled) {
               nextButton.click();
             }
           }, 500);
           
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
           
           // Select random confidence and click next button
           selectRandomConfidence();
           setTimeout(() => {
             const nextButton = document.querySelector('button.btn.btn-primary.next-button, .btn.btn-primary.next-button, button[class*="next-button"]');
             if (nextButton && !nextButton.disabled) {
               nextButton.click();
             }
           }, 500);
           
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
  
  // Add the message listener for 'creamAllQuestions'
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'creamAllQuestions') {
      logDebug('Received request to cream all questions');
      
      // Make this async to handle the loop properly
      (async () => {
        try {
          // Find all question headers/containers using the updated function
          const questionsToProcess = findQuestionHeaders();
          logDebug(`Found ${questionsToProcess.length} question containers/headers to process.`);

          // Improved check for no questions found
          if (questionsToProcess.length === 0) {
            sendResponse({ 
              status: 'error', 
              message: 'No questions found. Selectors might need adjustment for this page layout.' 
            });
            return;
          }

          let processedCount = 0;
          let errorCount = 0;

          // Process each question sequentially with a small delay
          for (const questionInfo of questionsToProcess) {
            // The element found by findQuestionHeaders is the container (or best guess)
            const questionContainer = questionInfo.element; 
            logDebug(`Processing question in container: ${questionContainer.id || questionContainer.className || 'no id/class'}`);
            
            try {
              // Indicate processing visually with smooth transition
              questionContainer.style.transition = 'outline 0.3s ease-in-out'; 
              questionContainer.style.outline = '2px solid #333333'; // Dark gray outline during processing
              
              // 1. Get question content (using the container)
              const questionData = getFullQuestionContent(questionContainer);
              
              // **Check if valid question content was extracted**
              if (!questionData || !questionData.question || questionData.question.length < 5) {
                  logDebug(`Skipping container - failed to extract valid question content.`);
                  questionContainer.style.outline = '1px dashed #888888'; // Gray dashed outline for skipped
                  // Remove outline after a delay
                  setTimeout(() => { 
                      if(questionContainer.style.outline.includes('#888888')) { // Check if still skipped
                          questionContainer.style.outline = ''; 
                          questionContainer.style.transition = '';
                      }
                  }, 2000); 
                  continue; // Skip to the next container
              }

              // 2. Analyze with AI (using the refactored async function)
              const analysisResult = await analyzeQuestionWithAI(questionData);
              logDebug(`Analysis complete. Suggested option: ${analysisResult.suggestedOption}`);

              // 3. Auto-select answer if suggested (using the container)
              const optionsToSelect = analysisResult.suggestedOptions && analysisResult.suggestedOptions.length > 0 
                ? analysisResult.suggestedOptions 
                : analysisResult.suggestedOption;
              
              if (optionsToSelect) {
                const selectResult = autoSelectAnswer(questionContainer, optionsToSelect);
                if (selectResult.success) {
                  const optionText = Array.isArray(optionsToSelect) 
                    ? `options ${optionsToSelect.join(', ')}` 
                    : `option ${optionsToSelect}`;
                  logDebug(`Successfully auto-selected ${optionText}`);
                  questionContainer.style.outline = '3px solid #1e3a00'; // Thicker Green on success
                  selectRandomConfidence();
                  setTimeout(()=>{
                    const nextBtn=document.querySelector('button.btn.btn-primary.next-button, .btn.btn-primary.next-button, button[class*="next-button"], button.submit_button.next-question');
                    if(nextBtn && !nextBtn.disabled) nextBtn.click();
                  },600);
                } else {
                  const optionText = Array.isArray(optionsToSelect) 
                    ? `options ${optionsToSelect.join(', ')}` 
                    : `option ${optionsToSelect}`;
                  logDebug(`Failed to auto-select ${optionText}: ${selectResult.message}`);
                  questionContainer.style.outline = '3px solid #3a0000'; // Thicker Red on selection failure
                  errorCount++;
                }
              } else {
                logDebug('No specific option suggested by AI.');
                questionContainer.style.outline = '3px solid #444400'; // Thicker Yellow if no suggestion
                // Optionally count no-suggestion as an error
                // errorCount++; 
              }
              processedCount++;

            } catch (analysisError) {
              console.error('[CreamHelper] Error processing a single question:', analysisError);
              questionContainer.style.outline = '3px solid #3a0000'; // Thicker Red on analysis error
              errorCount++;
              // Optionally display fallback info if available
              if (analysisError.fallbackText) {
                logDebug(`Fallback Analysis: ${analysisError.fallbackText}`);
              }
            }

            // Add a small delay between processing each question
            await new Promise(resolve => setTimeout(resolve, 750)); // 0.75 second delay
            
            // Reset outline color after a bit more delay (only for success outline)
             if (questionContainer.style.outline.includes('#1e3a00')) { // Check if it was success green
               setTimeout(() => { 
                   questionContainer.style.outline = ''; 
                   questionContainer.style.transition = ''; // Remove transition after reset
               }, 1500);
             }
             // Keep error/warning outlines visible longer or indefinitely for feedback

          } // End of loop

          logDebug(`Finished processing all questions. Processed: ${processedCount}, Errors: ${errorCount}`);
          if (errorCount === 0) {
            sendResponse({ status: 'completed' });
          } else {
            sendResponse({ status: 'completed_with_errors', message: `Processed ${processedCount} questions with ${errorCount} errors.` });
          }

        } catch (e) {
          console.error('[CreamHelper] Error in creamAllQuestions handler:', e);
          sendResponse({ status: 'error', message: `An unexpected error occurred: ${e.message}` });
        }
      })(); // End of async IIFE

      // Return true to indicate that sendResponse will be called asynchronously
      return true; 
    }
    
    // --- Ensure other listeners don't conflict --- 
    // It's generally safer to have one primary listener or ensure actions are unique
    // If the initialize function also adds a listener, review its logic.
    
    return true; // Return true from the top-level listener if any async response is possible
  });

  // Core logic to process all questions found on the current page
  async function processAllQuestionsOnPage(sendResponse) {
    try {
      // Find all question headers/containers using the updated function
      const questionsToProcess = findQuestionHeaders();
      logDebug(`Found ${questionsToProcess.length} question containers/headers to process.`);

      // Flag to determine if we should click 'Next' at the end
      let shouldClickNext = false;
      const nextButtonSelector = 'button.submit_button.next-question, button.next-button, .next-button-container button';

      if (questionsToProcess.length === 0) {
        // Before sending error, check if maybe we just navigated and should stop
        if (sessionStorage.getItem('creamAutoNextActive') === 'true') {
            logDebug('Auto-next sequence finished or encountered page with no questions.');
            sessionStorage.removeItem('creamAutoNextActive');
            if(sendResponse) sendResponse({ status: 'completed', message: 'Auto-next sequence finished.' });
        } else if (sendResponse) {
            sendResponse({ 
                status: 'error', 
                message: 'No questions found. Selectors might need adjustment or sequence ended.' 
            });
        }
        return; // Stop processing
      }

      let processedCount = 0;
      let errorCount = 0;

      // Process each question sequentially
      for (const questionInfo of questionsToProcess) {
        const questionContainer = questionInfo.element; 
        logDebug(`Processing question in container: ${questionContainer.id || questionContainer.className || 'no id/class'}`);
        
        try {
          questionContainer.style.transition = 'outline 0.3s ease-in-out'; 
          questionContainer.style.outline = '2px solid #333333'; // Dark gray outline during processing
          
          const questionData = getFullQuestionContent(questionContainer);
          
          if (!questionData || !questionData.question || questionData.question.length < 5) {
              logDebug(`Skipping container - failed to extract valid question content.`);
              questionContainer.style.outline = '1px dashed #888888'; // Gray dashed outline for skipped
              setTimeout(() => { 
                  if(questionContainer.style.outline.includes('#888888')) { 
                      questionContainer.style.outline = ''; 
                      questionContainer.style.transition = '';
                  }
              }, 2000); 
              continue; 
          }

          const analysisResult = await analyzeQuestionWithAI(questionData);
          logDebug(`Analysis complete. Suggested option: ${analysisResult.suggestedOption}`);

          const optionsToSelect = analysisResult.suggestedOptions && analysisResult.suggestedOptions.length > 0 
            ? analysisResult.suggestedOptions 
            : analysisResult.suggestedOption;
          
          if (optionsToSelect) {
            const selectResult = autoSelectAnswer(questionContainer, optionsToSelect);
            if (selectResult.success) {
              const optionText = Array.isArray(optionsToSelect) 
                ? `options ${optionsToSelect.join(', ')}` 
                : `option ${optionsToSelect}`;
              logDebug(`Successfully auto-selected ${optionText}`);
              questionContainer.style.outline = '3px solid #1e3a00'; // Thicker Green on success
              selectRandomConfidence();
              setTimeout(()=>{
                const nextBtn=document.querySelector('button.btn.btn-primary.next-button, .btn.btn-primary.next-button, button[class*="next-button"], button.submit_button.next-question');
                if(nextBtn && !nextBtn.disabled) nextBtn.click();
              },600);
            } else {
              const optionText = Array.isArray(optionsToSelect) 
                ? `options ${optionsToSelect.join(', ')}` 
                : `option ${optionsToSelect}`;
              logDebug(`Failed to auto-select ${optionText}: ${selectResult.message}`);
              questionContainer.style.outline = '3px solid #3a0000'; // Thicker Red on selection failure
              errorCount++;
            }
          } else {
            logDebug('No specific option suggested by AI.');
            questionContainer.style.outline = '3px solid #444400'; // Thicker Yellow if no suggestion
            // errorCount++; 
          }
          processedCount++;

        } catch (analysisError) {
          console.error('[CreamHelper] Error processing a single question:', analysisError);
          questionContainer.style.outline = '3px solid #3a0000'; // Thicker Red on analysis error
          errorCount++;
          if (analysisError.fallbackText) {
            logDebug(`Fallback Analysis: ${analysisError.fallbackText}`);
          }
        }

        // Add a small delay between processing each question (only if multiple questions)
        if (questionsToProcess.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 750)); 
        }
        
        // Reset outline color (only for success green)
         if (questionContainer.style.outline.includes('#1e3a00')) { 
           setTimeout(() => { 
               questionContainer.style.outline = ''; 
               questionContainer.style.transition = ''; 
           }, 1500);
         }
         
      } // End of loop

      logDebug(`Finished processing page questions. Processed: ${processedCount}, Errors: ${errorCount}`);

      // --- Check for Next Button Logic ---
      if (processedCount === questionsToProcess.length && errorCount === 0) {
        const nextButton = document.querySelector(nextButtonSelector);
        if (nextButton) {
          logDebug('All questions processed successfully and Next button found. Proceeding to next page.');
          shouldClickNext = true;
        } else {
          logDebug('All questions processed, but no Next button found.');
          shouldClickNext = false;
        }
      } else {
         shouldClickNext = false;
         if (processedCount !== questionsToProcess.length) logDebug('Not all questions processed, not clicking Next.');
         if (errorCount > 0) logDebug('Errors encountered, not clicking Next.');
      }

      if (shouldClickNext) {
          const nextButton = document.querySelector(nextButtonSelector);
          if (!nextButton) { // Double-check button exists before proceeding
              logError('next-button', 'Next button disappeared before click attempt.');
              sessionStorage.removeItem('creamAutoNextActive');
              if(sendResponse) sendResponse({ status: 'error', message: 'Next button not found unexpectedly.' });
              return;
          }
          try {
              sessionStorage.setItem('creamAutoNextActive', 'true');
              logDebug('Set creamAutoNextActive flag.');
              
              // Send a response *before* initiating navigation
              if (sendResponse) {
                  sendResponse({ status: 'navigating' });
                  logDebug('Sent navigating status to caller.');
              } else {
                  logDebug('Auto-next triggered, no sendResponse callback to call.');
              }
              
              // Add visual confirmation before clicking
              nextButton.style.outline = '3px solid #007bff';
              nextButton.style.transition = 'outline 0.2s ease-in-out';
              logDebug('Clicking Next button...');
              await new Promise(resolve => setTimeout(resolve, 300)); // Short delay for visual feedback
              
              // if disabled, trigger review concept flow with loop
              if(nextButton.disabled || nextButton.hasAttribute('disabled')){
                logDebug('Next button disabled – triggering Review Concept fallback loop');
                let reviewAttempts = 0;
                const maxAttempts = 10; // Prevent infinite loop
                while ((nextButton.disabled || nextButton.hasAttribute('disabled')) && reviewAttempts < maxAttempts) {
                  const reviewBtn = document.querySelector('.btn.btn-tertiary.lr-tray-button');
                  if(!reviewBtn){
                    logDebug('No more Review Concept button found. Aborting loop.');
                    break;
                  }
                  logDebug(`Review attempt ${reviewAttempts + 1}: Clicking Review Concept button`);
                  reviewBtn.click();
                  await new Promise(r=>setTimeout(r,1000));
                  const continueBtn = document.querySelector('.button-bar-wrapper button');
                  if(continueBtn){
                    logDebug('Clicking Continue button after review');
                    continueBtn.click();
                  }
                  await new Promise(r=>setTimeout(r,800));
                  // Re-query nextButton in case DOM changed
                  nextButton = document.querySelector(nextButtonSelector);
                  if (!nextButton) {
                    logDebug('Next button disappeared during review loop.');
                    break;
                  }
                  reviewAttempts++;
                }
              }
              // re-check after potential loop
              if(nextButton.disabled || nextButton.hasAttribute('disabled')){
                logDebug('Next button still disabled after review attempts, aborting auto-next.');
              } else {
                nextButton.style.outline='3px solid #007bff';
                await new Promise(res=>setTimeout(res,300));
                nextButton.click();
                return;
              }
          } catch (e) {
              logError('next-button', e);
              sessionStorage.removeItem('creamAutoNextActive'); // Clear flag on error
              // Avoid calling sendResponse again if it was already called above
              // The initial caller (popup) would have already received 'navigating' or an error.
              console.error('Error occurred during next button click or flag setting.');
          }
      } else {
          // Normal completion, clear the flag
          sessionStorage.removeItem('creamAutoNextActive');
          logDebug('Cleared creamAutoNextActive flag (normal completion or no next button).');
          if(sendResponse) { // Only send response if initiated by popup
            if (errorCount === 0) {
              sendResponse({ status: 'completed' });
            } else {
              sendResponse({ status: 'completed_with_errors', message: `Processed ${processedCount} questions with ${errorCount} errors.` });
            }
          }
      }

    } catch (e) {
      console.error('[CreamHelper] Unexpected error in processAllQuestionsOnPage:', e);
      sessionStorage.removeItem('creamAutoNextActive'); // Clear flag on unexpected error
      if(sendResponse) sendResponse({ status: 'error', message: `An unexpected error occurred: ${e.message}` });
    }
  } // End of processAllQuestionsOnPage

  // --- Update the message listener --- 
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'creamAllQuestions') {
      logDebug('Received request to cream all questions via message');
      // Call the core processing function, passing the sendResponse callback
      processAllQuestionsOnPage(sendResponse);
      // Return true to indicate that sendResponse will be called asynchronously
      return true; 
    }
    
    // --- Keep other listeners if needed, ensuring no action conflicts ---
    // e.g., if (message.action === 'someOtherAction') { ... }
    
    // If the action isn't handled, return false or undefined implicitly
  });


  // --- Add Initialization Check --- 
  function runAutoNextIfActive() {
      try {
          if (sessionStorage.getItem('creamAutoNextActive') === 'true') {
              logDebug('Cream auto-next flag is active. Starting processing automatically.');
              // Call core logic automatically, don't need sendResponse here
              // Use a short delay to ensure page elements might be ready
              setTimeout(() => processAllQuestionsOnPage(null), 500); 
          } else {
              logDebug('Cream auto-next flag is not active.');
          }
      } catch (e) {
          logError('auto-next-init', e);
          // Clear flag if error occurs during check
          try { sessionStorage.removeItem('creamAutoNextActive'); } catch (se) {}
      }
  }

  // Modify initialization
  function safeInitialize() {
    try {
      logDebug('SafeInitialize running...');
      initialize(); // Runs original init (adds buttons etc.)
      runAutoNextIfActive(); // Check and potentially run auto-next
    } catch (e) {
      console.error('[CreamHelper] Error during initialization:', e);
      setTimeout(() => {
        try {
          addTranscriptButtons();
          runAutoNextIfActive(); // Also check here as fallback
        } catch (innerError) {
          console.error('[CreamHelper] Fatal error adding transcript buttons:', innerError);
        }
      }, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInitialize);
  } else {
    safeInitialize();
  }

  // Consider adding check on window.load as well for SPA/late loading scenarios
  window.addEventListener('load', () => {
      logDebug('Window load event fired, checking auto-next again.');
      // Delay slightly more on window.load
      setTimeout(runAutoNextIfActive, 1000); 
  });

  function selectRandomConfidence() {
    try {
      if (!isMHEPage && !checkIfMHE()) return;
      const container = document.querySelector('.confidence-buttons-container');
      if (!container) return;
      const buttons = container.querySelectorAll('button, [role="button"]');
      if (buttons.length === 0) return;
      const randomBtn = buttons[Math.floor(Math.random() * buttons.length)];
      randomBtn.click();
      logDebug('Clicked random confidence button');
    } catch (e) {
      console.error('[CreamHelper] Error selecting confidence button:', e);
    }
  }

  // Enhanced function to select multiple options for checkbox questions
  function autoSelectMultipleOptions(questionElement, optionNumbers) {
    try {
      logDebug(`Attempting to select multiple options: ${optionNumbers.join(', ')}`);
      
      const container = questionElement.closest('.question_holder, .display_question, [id^="question_"]') || questionElement;
      const inputElements = container.querySelectorAll('input[type="checkbox"]');
      
      if (inputElements.length === 0) {
        logDebug('No checkbox elements found for multiple selection');
        return { success: false, message: "No checkbox options found" };
      }
      
      let successCount = 0;
      let totalAttempts = optionNumbers.length;
      
      optionNumbers.forEach(optionNum => {
        if (optionNum > 0 && optionNum <= inputElements.length) {
          const targetInput = inputElements[optionNum - 1];
          
          if (targetInput) {
            try {
              // Find the best click target
              let clickTarget = targetInput;
              const mheWrapper = targetInput.closest('mhe-checkbox');
              const labelWrapper = targetInput.closest('label');
              const spanContainer = labelWrapper?.querySelector('span.choice-container, .choice-row, .printable-option');
              
              if (spanContainer) {
                clickTarget = spanContainer;
              } else if (mheWrapper) {
                clickTarget = mheWrapper;
              } else if (labelWrapper) {
                clickTarget = labelWrapper;
              }
              
              // Simulate mouse click sequence
              const rect = clickTarget.getBoundingClientRect();
              const centerX = Math.floor(rect.left + rect.width / 2);
              const centerY = Math.floor(rect.top + rect.height / 2);
              
              const mouseEvents = ['mousedown', 'mouseup', 'click'];
              mouseEvents.forEach(eventType => {
                clickTarget.dispatchEvent(new MouseEvent(eventType, {
                  view: window,
                  bubbles: true,
                  cancelable: true,
                  clientX: centerX,
                  clientY: centerY,
                  button: 0
                }));
              });
              
              // Ensure checkbox is checked
              if (!targetInput.checked) {
                targetInput.checked = true;
                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                targetInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              
              logDebug(`Successfully selected option ${optionNum}`);
              successCount++;
              
            } catch (error) {
              logError(`Error selecting option ${optionNum}:`, error);
            }
          }
        } else {
          logDebug(`Invalid option number: ${optionNum} (valid range: 1-${inputElements.length})`);
        }
      });
      
      const success = successCount > 0;
      const message = `Selected ${successCount} out of ${totalAttempts} options`;
      
      logDebug(message);
      return { success, message };
      
    } catch (error) {
      logError('Error in autoSelectMultipleOptions:', error);
      return { success: false, message: `Error selecting multiple options: ${error.message}` };
    }
  }

  // Legacy helper function (kept for compatibility)
  function autoSelectMultiple(questionElement, optionNumbers) {
    return autoSelectMultipleOptions(questionElement, optionNumbers);
  }

})(); // End of IIFE
