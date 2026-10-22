/**
 * CodeBlock — monospaced source rendering with optional line numbers.
 *
 * Used for file previews, finding snippets and AI explanation excerpts.
 * Long lines scroll horizontally rather than wrapping, so the code stays
 * readable and the copy operation returns the original source.
 */
import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const CodeBlock = ({
  code = '',
  language,
  fileName,
  showLineNumbers = false,
  startLine = 1,
  highlightLines = [],
  maxHeight,
  copyable = true,
  className,
}) => {
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => {
    if (typeof code !== 'string') return [];
    return code.replace(/\n$/, '').split('\n');
  }, [code]);

  const highlightSet = useMemo(
    () => new Set((highlightLines || []).map(Number)),
    [highlightLines],
  );

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const area = document.createElement('textarea');
        area.value = code;
        area.setAttribute('readonly', '');
        area.style.position = 'absolute';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const gutterWidth = `${String(startLine + lines.length).length + 1}ch`;

  return (
    <div className={cn('code-surface', className)}>
      {(fileName || language || copyable) && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/50 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Icon name="FileCode" size={14} aria-hidden="true" />
            {fileName ? (
              <span className="truncate font-data text-foreground">{fileName}</span>
            ) : null}
            {language ? <span className="uppercase tracking-wide">{language}</span> : null}
          </div>
          {copyable ? (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name={copied ? 'Check' : 'Copy'} size={13} aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}
        </div>
      )}

      <div
        className="overflow-auto"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <pre className="m-0 flex bg-transparent p-0 text-xs leading-relaxed">
          {showLineNumbers ? (
            <span
              aria-hidden="true"
              className="select-none border-r border-border bg-muted/40 px-2 py-4 text-right text-muted-foreground/70"
              style={{ minWidth: gutterWidth }}
            >
              {lines.map((_, index) => (
                <span key={index} className="block">
                  {startLine + index}
                </span>
              ))}
            </span>
          ) : null}
          <code className="block flex-1 px-4 py-4">
            {lines.map((line, index) => (
              <span
                key={index}
                className={cn(
                  'block',
                  highlightSet.has(startLine + index) &&
                    'bg-critical/10 ring-1 ring-inset ring-critical/30',
                )}
              >
                {line || ' '}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
};

export default CodeBlock;
