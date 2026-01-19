/**
 * JSON parsing utilities for handling LLM responses
 * Strips markdown code fences before parsing
 */

/**
 * Strips markdown code fences from a string
 * Handles formats like:
 * - ```json\n{...}\n```
 * - ```\n{...}\n```
 * - {... } (already clean)
 */
export function stripMarkdownCodeFences(text: string): string {
  // Remove leading/trailing whitespace
  let cleaned = text.trim();
  
  // Check if wrapped in code fences
  const codeBlockRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const match = cleaned.match(codeBlockRegex);
  
  if (match) {
    cleaned = match[1].trim();
  }
  
  return cleaned;
}

/**
 * Parse JSON with automatic markdown code fence stripping and error recovery
 * @param text - JSON string, potentially wrapped in markdown code fences
 * @returns Parsed JSON object
 * @throws SyntaxError if JSON is invalid after all recovery attempts
 */
export function parseJsonResponse<T = any>(text: string): T {
  const cleaned = stripMarkdownCodeFences(text);
  
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Attempt 1: Try to extract JSON object from mixed content
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        // Continue to next attempt
      }
    }
    
    // Attempt 2: Try to fix common issues (trailing commas, missing quotes)
    try {
      // Remove trailing commas before closing braces/brackets
      const fixed = cleaned
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":'); // Fix unquoted keys
      return JSON.parse(fixed);
    } catch (e) {
      // All attempts failed
    }
    
    // Log the error with context
    console.error('❌ [JSON-PARSER] Failed to parse JSON after all attempts');
    console.error('   Original text (first 200 chars):', text.substring(0, 200));
    console.error('   Cleaned text (first 200 chars):', cleaned.substring(0, 200));
    console.error('   Parse error:', error);
    
    // Re-throw original error
    throw error;
  }
}
