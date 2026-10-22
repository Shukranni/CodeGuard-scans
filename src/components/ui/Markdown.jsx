import React, { useMemo } from 'react';

/**
 * Minimal, dependency-free Markdown renderer for AI generated text.
 *
 * Security rules (the model output is untrusted input):
 *   * everything is rendered as React children — there is no
 *     `dangerouslySetInnerHTML` anywhere, so HTML in the answer is shown as
 *     literal text and can never execute;
 *   * only `http:` / `https:` links become anchors, every other scheme
 *     (`javascript:`, `data:`, `vbscript:`, …) is rendered as plain text;
 *   * fenced code blocks are shown verbatim inside <pre><code>; they are
 *     never evaluated.
 *
 * Supported: headings, paragraphs, bullet/numbered lists, block quotes,
 * horizontal rules, fenced code, inline code, bold, italic, strikethrough
 * and links.
 */

// 1: inline code, 2/3: bold, 4/5: italic, 6: strikethrough,
// 7: whole link, 8: link text, 9: link url
const INLINE_SOURCE = [
  '(`[^`]+`)',
  '(\\*\\*[^*\\n]+\\*\\*)',
  '(__[^_\\n]+__)',
  '(\\*[^*\\n]+\\*)',
  '(_[^_\\n]+_)',
  '(~~[^~\\n]+~~)',
  '(\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\))',
].join('|');

// A fresh pattern per call: the renderer recurses (bold inside a list item,
// link text, …) and a shared `g` pattern would carry its `lastIndex` from the
// inner call into the outer loop and never terminate.
const makeInlinePattern = () => new RegExp(INLINE_SOURCE, 'g');

const SAFE_URL = /^https?:\/\//i;

const isWordChar = (char) => !!char && /[\w]/.test(char);

/**
 * Render the inline (span level) part of a markdown string.
 */
const renderInline = (text, keyPrefix) => {
  if (text === null || text === undefined || text === '') return null;

  const source = String(text);
  const nodes = [];
  let lastIndex = 0;
  let match;

  const pattern = makeInlinePattern();
  while ((match = pattern.exec(source)) !== null) {
    const [full, code, boldStar, boldUnderscore, italicStar, italicUnderscore, strike, link, linkText, linkUrl] =
      match;
    const index = match.index;

    // `_text_` is only an italic marker when it is not part of a word
    // (otherwise `snake_case_names` would be mangled).
    if (italicUnderscore) {
      const before = index > 0 ? source[index - 1] : '';
      const after = source[index + full.length] || '';
      if (isWordChar(before) || isWordChar(after)) continue;
    }

    if (index > lastIndex) {
      nodes.push(source.slice(lastIndex, index));
    }

    const key = `${keyPrefix}-${nodes.length}`;

    if (code) {
      nodes.push(
        <code
          key={key}
          className="bg-muted/60 border border-border rounded px-1 py-0.5 text-[0.8em] font-data text-foreground"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (boldStar || boldUnderscore) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInline((boldStar || boldUnderscore).slice(2, -2), key)}
        </strong>,
      );
    } else if (italicStar || italicUnderscore) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline((italicStar || italicUnderscore).slice(1, -1), key)}
        </em>,
      );
    } else if (strike) {
      nodes.push(
        <del key={key} className="text-muted-foreground">
          {renderInline(strike.slice(2, -2), key)}
        </del>,
      );
    } else if (link) {
      const label = linkText || linkUrl;
      if (SAFE_URL.test(linkUrl || '')) {
        nodes.push(
          <a
            key={key}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2 hover:text-primary/80 break-words"
          >
            {renderInline(label, key)}
          </a>,
        );
      } else {
        // Unsupported scheme — show the text, never a clickable link.
        nodes.push(
          <span key={key} className="underline underline-offset-2 break-words">
            {renderInline(label, key)}
          </span>,
        );
      }
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }

  return nodes;
};

/**
 * Split a markdown document into block descriptors.
 */
const parseBlocks = (markdown) => {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // ── Fenced code block ────────────────────────────────────────────────
    const fence = line.match(/^\s*```+\s*([\w+#.-]*)\s*$/);
    if (fence) {
      const language = fence[1] || '';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```+\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1; // consume the closing fence (or the end of the document)
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // ── Heading ──────────────────────────────────────────────────────────
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    // ── Horizontal rule ──────────────────────────────────────────────────
    if (/^\s*(?:-\s*){3,}$/.test(line) || /^\s*(?:\*\s*){3,}$/.test(line) || /^\s*(?:_\s*){3,}$/.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    // ── Block quote ──────────────────────────────────────────────────────
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    // ── List ─────────────────────────────────────────────────────────────
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
        if (itemMatch) {
          items.push(itemMatch[1]);
          index += 1;
          continue;
        }
        // A wrapped continuation line belongs to the previous item.
        if (items.length && lines[index].trim() && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index])) {
          items[items.length - 1] = `${items[items.length - 1]} ${lines[index].trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // ── Paragraph ────────────────────────────────────────────────────────
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^#{1,6}\s/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index]) &&
      !/^\s*(?:-\s*){3,}$/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    } else {
      index += 1;
    }
  }

  return blocks;
};

const headingClasses = {
  1: 'text-lg',
  2: 'text-base',
  3: 'text-sm',
};

const Markdown = ({ content, className = '' }) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  if (!blocks.length) return null;

  return (
    <div className={`space-y-3 text-sm text-foreground/90 leading-relaxed ${className}`}>
      {blocks.map((block, blockIndex) => {
        const key = `md-${blockIndex}`;

        if (block.type === 'heading') {
          const Tag = `h${Math.min(4, Math.max(3, block.level))}`;
          return (
            <Tag
              key={key}
              className={`font-heading font-semibold text-foreground mt-1 ${
                headingClasses[block.level] || 'text-sm'
              }`}
            >
              {renderInline(block.text, key)}
            </Tag>
          );
        }

        if (block.type === 'paragraph') {
          return <p key={key} className="whitespace-pre-wrap">{renderInline(block.text, key)}</p>;
        }

        if (block.type === 'code') {
          return (
            <div key={key} className="rounded-md border border-border bg-muted/40 overflow-hidden">
              {block.language ? (
                <div className="px-3 py-1.5 border-b border-border bg-muted/60 text-[11px] font-data uppercase tracking-wide text-muted-foreground">
                  {block.language}
                </div>
              ) : null}
              <pre className="p-3 overflow-x-auto text-xs font-data text-foreground whitespace-pre">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={key}
              className={`space-y-1.5 pl-5 text-sm text-foreground/90 ${
                block.ordered ? 'list-decimal' : 'list-disc'
              } marker:text-muted-foreground`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground whitespace-pre-wrap"
            >
              {renderInline(block.text, key)}
            </blockquote>
          );
        }

        if (block.type === 'hr') {
          return <hr key={key} className="border-border" />;
        }

        return null;
      })}
    </div>
  );
};

export default Markdown;
