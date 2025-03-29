# Creamy Browser Extension

A powerful browser extension for analyzing selected screen regions and automatically answering questions on Canvas using AI vision technologies.

> **IMPORTANT**: This extension requires an OpenAI API key to function. After installation, go to the extension settings by clicking on the extension icon, then "Options", and enter your OpenAI API key from the [OpenAI website](https://platform.openai.com/).

## Features

- **Region Selection**: Select specific regions of a webpage for analysis
- **Direct Image Analysis**: Uses OpenAI Vision models for accurate text extraction and intelligent analysis
- **Canvas Auto-Answer**: Automatically identifies and answers questions on Canvas learning management system
- **Intelligent Analysis**: OpenAI Vision provides both text extraction and comprehensive analysis in a single step
- **Detailed Results**: Get comprehensive analysis of text content in images

## How It Works

1. **Region Selection and Image Capture**
   - Select a specific region of a webpage you want analyzed
   - The extension captures the selected region as an image
   - Sends it directly to OpenAI Vision API for processing

2. **Analysis with OpenAI**
   - OpenAI Vision extracts text and analyzes the content in a single step
   - Provides detailed explanations, solves problems, and extracts information
   - Results are presented in a clean, readable format

3. **Canvas Integration**
   - Automatically detects question elements on Canvas
   - Adds "CREAM" buttons next to questions for quick analysis
   - Automatically suggests the correct answer option
   - Can auto-select the suggested answer

## Setup Instructions

### Installation

1. Clone this repository or download the source code
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension should now appear in your browser toolbar

### API Key Configuration

This extension requires an OpenAI API key to function properly:

1. Go to [OpenAI's platform](https://platform.openai.com/)
2. Sign in or create an account
3. Navigate to the API keys section
4. Generate a new API key
5. Click the extension icon and go to "Options"
6. Enter your OpenAI API key in the designated field
7. Click "Save" to store your key securely

## Usage

### Analyzing Regions/images

1. Click the Camera icon on botton left 
2. Draw a rectangle around the area you want to analyze
3. The extension will:
   - Send the image to OpenAI Vision
   - Display the analysis results including extracted text and explanations

### Auto-Answering on Canvas

1. Navigate to a Canvas quiz or assignment page
2. The extension automatically adds "CREAM" buttons next to questions
3. Click on the "CREAM" button to analyze the question
4. The extension will:
   - Analyze the question and options
   - Suggest the correct answer
   - Optionally auto-select the suggested answer


## Troubleshooting

### Common Issues

- **"Invalid image data"**: The image may be too small, corrupted, or in an unsupported format
- **"No text detected"**: The image doesn't contain recognizable text or the text is too small/blurry
- **"API Error"**: Check your OpenAI API key and ensure it's valid

### Diagnostic Tools

The extension includes built-in diagnostic tools:

1. Go to the options page
2. Click "Test Connection" to see if your API key is working
3. Click "View Error Logs" to see recent errors
4. Click "Clear Error Logs" to reset the log

## Development

### Project Structure

- `manifest.json`: Extension configuration
- `background.js`: Background script for API communication
- `content.js`: Content script for webpage interaction
- `question_transcript.js`: Handles Canvas question detection and CREAM buttons
- `options.html/js`: Options page for configuration
- `popup.html/js`: Extension popup interface

## Privacy

This extension processes images locally and only sends them to OpenAI for analysis. No data is stored on servers beyond what's required for API processing. Your API key is stored securely in your browser's local storage.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
