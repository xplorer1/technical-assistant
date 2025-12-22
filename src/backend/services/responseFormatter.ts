/**
 * Response Formatter Service
 *
 * Formats LLM responses for display in the chat interface.
 * This service handles:
 * - Code block parsing with language identification
 * - List and paragraph formatting
 * - Source reference inclusion
 *
 * WHY THIS MATTERS:
 * Raw LLM output needs processing before display. Proper formatting:
 * - Enables syntax highlighting for code blocks
 * - Ensures consistent visual presentation
 * - Makes responses more readable and professional
 *
 * - Separation of concerns: LLM generates content, formatter handles presentation
 * - Regex patterns for markdown parsing (trade-offs vs full parser)
 * - Immutability: formatting functions don't modify input
 */

import { SourceReference, ChatMessage } from '../../shared/types';

/**
 * Represents a parsed code block from the response.
 */
export interface CodeBlock {
  /** The programming language (e.g., 'typescript', 'python') */
  language: string;
  /** The code content without the fence markers */
  code: string;
  /** Original position in the text (for reconstruction) */
  startIndex: number;
  /** End position in the text */
  endIndex: number;
}

/**
 * Represents a formatted response ready for display.
 */
export interface FormattedResponse {
  /** The formatted content with proper markdown structure */
  content: string;
  /** Extracted code blocks with language info */
  codeBlocks: CodeBlock[];
  /** Source references for attribution */
  sources: SourceReference[];
  /** Whether the response contains code */
  hasCode: boolean;
  /** Whether the response contains lists */
  hasLists: boolean;
}

/**
 * Configuration for the response formatter.
 */
export interface FormatterConfig {
  /** Default language for code blocks without explicit language */
  defaultCodeLanguage: string;
  /** Maximum excerpt length for source references */
  maxExcerptLength: number;
  /** Whether to add line numbers to code blocks */
  addLineNumbers: boolean;
}

/**
 * Default formatter configuration.
 */
export const DEFAULT_FORMATTER_CONFIG: FormatterConfig = {
  defaultCodeLanguage: 'text',
  maxExcerptLength: 150,
  addLineNumbers: false,
};

/**
 * Regular expression for matching fenced code blocks.
 *
 * WHY THIS PATTERN:
 * - Matches triple backticks with optional language identifier
 * - Captures the language (group 1) and code content (group 2)
 * - Uses non-greedy matching to handle multiple code blocks
 * - The 's' flag allows . to match newlines
 *
 * Pattern breakdown:
 * ```(\w*)     - Opening fence with optional language
 * \n?         - Optional newline after opening fence
 * ([\s\S]*?)  - Code content (non-greedy, matches newlines)
 * \n?```      - Closing fence with optional preceding newline
 */
const CODE_BLOCK_REGEX = /```(\w*)\n?([\s\S]*?)\n?```/g;

/**
 * Regular expression for detecting unordered lists.
 * Matches lines starting with -, *, or + followed by space.
 */
const UNORDERED_LIST_REGEX = /^[\s]*[-*+]\s+/m;

/**
 * Regular expression for detecting ordered lists.
 * Matches lines starting with number followed by . or ) and space.
 */
const ORDERED_LIST_REGEX = /^[\s]*\d+[.)]\s+/m;

/**
 * Extracts code blocks from markdown content.
 *
 * WHY EXTRACT CODE BLOCKS:
 * - Enables syntax highlighting in the UI
 * - Allows separate rendering of code vs prose
 * - Provides metadata (language) for proper highlighting
 *
 * @param content - The markdown content to parse
 * @param config - Formatter configuration
 * @returns Array of extracted code blocks
 */
export function extractCodeBlocks(
  content: string,
  config: FormatterConfig = DEFAULT_FORMATTER_CONFIG
): CodeBlock[] {
  const codeBlocks: CodeBlock[] = [];

  // Reset regex state (important for global regex)
  CODE_BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    const language = match[1] ?? config.defaultCodeLanguage;
    const code = match[2] ?? '';

    codeBlocks.push({
      language: normalizeLanguage(language),
      code: code.trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return codeBlocks;
}

/**
 * Normalizes language identifiers for consistency.
 *
 * WHY NORMALIZE:
 * - Users might write 'js', 'javascript', or 'JavaScript'
 * - Syntax highlighters expect consistent identifiers
 * - Improves user experience with consistent highlighting
 *
 * @param language - The raw language identifier
 * @returns Normalized language identifier
 */
export function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase().trim();

  // Common aliases mapping
  const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    md: 'markdown',
    '': 'text',
  };

  return aliases[normalized] || normalized;
}

/**
 * Checks if content contains lists (ordered or unordered).
 *
 * @param content - The content to check
 * @returns True if content contains lists
 */
export function containsLists(content: string): boolean {
  return UNORDERED_LIST_REGEX.test(content) || ORDERED_LIST_REGEX.test(content);
}

/**
 * Ensures code blocks have language identifiers.
 *
 * This function processes markdown content and adds default language
 * identifiers to code blocks that don't have one.
 *
 * WHY THIS MATTERS (Requirement 2.3):
 * - Code blocks without language identifiers can't be syntax highlighted
 * - Consistent formatting improves readability
 * - Helps the UI render code properly
 *
 * @param content - The markdown content
 * @param defaultLanguage - Language to use when none specified
 * @returns Content with all code blocks having language identifiers
 */
export function ensureCodeBlockLanguages(
  content: string,
  defaultLanguage: string = 'text'
): string {
  // Replace code blocks without language with ones that have the default
  return content.replace(/```\n/g, `\`\`\`${defaultLanguage}\n`);
}

/**
 * Formats source references for display.
 *
 * Creates a formatted section showing where information came from.
 * This builds trust and enables verification (Requirement 2.1).
 *
 * @param sources - Array of source references
 * @param config - Formatter configuration
 * @returns Formatted source references section
 */
export function formatSourceReferences(
  sources: SourceReference[],
  config: FormatterConfig = DEFAULT_FORMATTER_CONFIG
): string {
  if (sources.length === 0) {
    return '';
  }

  const lines: string[] = ['\n---\n**Sources:**\n'];

  for (const source of sources) {
    const excerpt = truncateExcerpt(source.excerpt, config.maxExcerptLength);
    lines.push(`- **${source.documentName}**`);
    if (excerpt) {
      lines.push(`  > ${excerpt}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Truncates an excerpt to a maximum length.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text with ellipsis if needed
 */
function truncateExcerpt(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3).trim() + '...';
}

/**
 * Formats a complete response for display.
 *
 * This is the main entry point for response formatting.
 * It processes the raw LLM output and prepares it for the UI.
 *
 * @param rawContent - The raw response content from the LLM
 * @param sources - Source references to include
 * @param config - Formatter configuration
 * @returns Formatted response ready for display
 */
export function formatResponse(
  rawContent: string,
  sources: SourceReference[] = [],
  config: FormatterConfig = DEFAULT_FORMATTER_CONFIG
): FormattedResponse {
  // Step 1: Ensure all code blocks have language identifiers
  let content = ensureCodeBlockLanguages(rawContent, config.defaultCodeLanguage);

  // Step 2: Extract code blocks for metadata
  const codeBlocks = extractCodeBlocks(content, config);

  // Step 3: Check for lists
  const hasLists = containsLists(content);

  // Step 4: Add source references if present
  if (sources.length > 0) {
    content += formatSourceReferences(sources, config);
  }

  return {
    content,
    codeBlocks,
    sources,
    hasCode: codeBlocks.length > 0,
    hasLists,
  };
}

/**
 * Creates a ChatMessage from a formatted response.
 *
 * This is a convenience function for creating assistant messages
 * with proper formatting and source attribution.
 *
 * @param formattedResponse - The formatted response
 * @returns A ChatMessage ready for storage/display
 */
export function createAssistantMessage(
  formattedResponse: FormattedResponse
): ChatMessage {
  return {
    id: generateMessageId(),
    role: 'assistant',
    content: formattedResponse.content,
    timestamp: new Date(),
    sources: formattedResponse.sources.length > 0 ? formattedResponse.sources : undefined,
  };
}

/**
 * Generates a unique message ID.
 *
 * Uses timestamp + random suffix for uniqueness.
 * In production, consider using UUID library.
 */
function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `msg_${timestamp}_${random}`;
}

/**
 * Interface for the response formatter service.
 */
export interface IResponseFormatter {
  format(rawContent: string, sources?: SourceReference[]): FormattedResponse;
  extractCodeBlocks(content: string): CodeBlock[];
  formatSourceReferences(sources: SourceReference[]): string;
}

/**
 * Response Formatter class implementation.
 *
 * Provides an object-oriented interface to the formatting functions.
 * Useful when you need to maintain configuration state.
 */
export class ResponseFormatter implements IResponseFormatter {
  private readonly config: FormatterConfig;

  constructor(config: Partial<FormatterConfig> = {}) {
    this.config = { ...DEFAULT_FORMATTER_CONFIG, ...config };
  }

  /**
   * Formats a response for display.
   */
  format(rawContent: string, sources: SourceReference[] = []): FormattedResponse {
    return formatResponse(rawContent, sources, this.config);
  }

  /**
   * Extracts code blocks from content.
   */
  extractCodeBlocks(content: string): CodeBlock[] {
    return extractCodeBlocks(content, this.config);
  }

  /**
   * Formats source references.
   */
  formatSourceReferences(sources: SourceReference[]): string {
    return formatSourceReferences(sources, this.config);
  }
}

/**
 * Factory function to create a response formatter.
 */
export function createResponseFormatter(
  config?: Partial<FormatterConfig>
): ResponseFormatter {
  return new ResponseFormatter(config);
}
