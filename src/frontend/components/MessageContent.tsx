import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

/**
 * MessageContent Component
 *
 * Renders message content with full markdown support and syntax highlighting.
 * Addresses Requirements:
 * - 2.3: Code examples with proper syntax highlighting and language identification
 * - 4.3: Render response with proper formatting including code blocks, lists, paragraphs
 *
 * 1. react-markdown is a popular choice for rendering markdown in React because it:
 *    - Converts markdown to React components (not dangerouslySetInnerHTML)
 *    - Allows custom component overrides for fine-grained control
 *    - Supports plugins like remark-gfm for GitHub Flavored Markdown
 *
 * 2. Code block handling demonstrates the "render props" pattern - we override
 *    the default code renderer with our custom SyntaxHighlighter component
 *
 * 3. Language detection: The markdown code fence (```language) provides the
 *    language identifier, which we pass to the syntax highlighter
 */

export interface MessageContentProps {
  /** The markdown content to render */
  content: string;
  /** Optional className for styling */
  className?: string;
}

export const MessageContent: React.FC<MessageContentProps> = ({
  content,
  className = '',
}) => {
  // Memoize the markdown components to prevent unnecessary re-renders
  const components = useMemo(
    () => ({
      // Custom code block renderer with syntax highlighting
      code: CodeBlock,
      // Custom pre tag to work with our code block
      pre: PreBlock,
    }),
    []
  );

  return (
    <div className={`message-content ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

/**
 * PreBlock Component
 *
 * Wrapper for pre elements - passes through children without extra styling
 * since the code block handles its own styling.
 */
interface PreBlockProps {
  children?: React.ReactNode;
}

const PreBlock: React.FC<PreBlockProps> = ({ children }) => {
  return <>{children}</>;
};

/**
 * CodeBlock Component
 *
 * Renders code with syntax highlighting for code blocks,
 * or inline code styling for inline code.
 *
 * The component receives props from react-markdown including:
 * - inline: whether this is inline code or a code block
 * - className: contains the language identifier (e.g., "language-javascript")
 * - children: the code content
 */
interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  inline,
  className,
  children,
  ...props
}) => {
  // Extract language from className (e.g., "language-javascript" -> "javascript")
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  // Get the code content as a string
  const codeString = String(children).replace(/\n$/, '');

  // Inline code - render with simple styling
  if (inline) {
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  }

  // Code block - render with syntax highlighting
  return (
    <div className="code-block">
      {language && (
        <div className="code-block__header">
          <span className="code-block__language">{language}</span>
          <CopyButton code={codeString} />
        </div>
      )}
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: language ? '0 0 0.5rem 0.5rem' : '0.5rem',
          fontSize: '0.875rem',
        }}
        {...props}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * CopyButton Component
 *
 * Allows users to copy code to clipboard.
 * Good UX for technical documentation.
 */
interface CopyButtonProps {
  code: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ code }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <button
      className="code-block__copy"
      onClick={handleCopy}
      aria-label={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
};

/**
 * Copy icon
 */
const CopyIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/**
 * Check icon for copied state
 */
const CheckIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default MessageContent;
