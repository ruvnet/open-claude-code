/**
 * Claude API client
 * Handles communication with Anthropic API
 */

import { ANTHROPIC_API_URL } from '../config/constants.mjs';
import fetch from 'node-fetch';

/**
 * Sends a request to Claude AI and handles the response
 */
export async function sendRequest(messages, options = {}) {
  // Check if API key is available
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set. Please add it to your .env file.');
  }
  
  try {
    // For development, return a mock response
    if (process.env.NODE_ENV === 'development' || !apiKey.startsWith('sk-')) {
      return mockResponse(messages);
    }
    
    // Prepare request payload
    const model = process.env.CLAUDE_MODEL || 'claude-3-7-sonnet-20250219';
    const maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
    
    const payload = {
      model,
      max_tokens: maxTokens,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    };
    
    // Send request to Anthropic API
    const response = await fetch(`${ANTHROPIC_API_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    
    // Check for errors
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || response.statusText}`);
    }
    
    // Parse response
    const data = await response.json();
    
    return {
      response: data.content[0].text,
      usage: data.usage
    };
  } catch (error) {
    console.error('Error communicating with Claude API:', error);
    throw error;
  }
}

/**
 * Streams a response from Claude AI
 */
export async function streamResponse(messages, options = {}) {
  // Implementation for streaming would go here
  // This is a placeholder
}

/**
 * Generate a mock response for development
 */
function mockResponse(messages) {
  const lastMessage = messages[messages.length - 1];
  
  // Simple echo response for development
  return {
    response: `[DEV MODE] You said: "${lastMessage.content}". This is a simulated response from Claude.`,
    usage: {
      input_tokens: 10,
      output_tokens: 20
    }
  };
}
