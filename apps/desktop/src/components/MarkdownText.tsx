/**
 * Leaf D — MarkdownText
 *
 * Safe, dependency-free markdown renderer for assistant messages.
 * Supported inline: **bold**, __bold__, *italic*, _italic_, `code`, and
 * [links](url) (rendered with target="_blank" rel="noreferrer").
 * Supported blocks: ## / ### headings, ordered and unordered lists, and
 * fenced ``` code blocks.
 *
 * Safety: the source text is parsed into React elements — never
 * dangerouslySetInnerHTML. Link URLs are restricted to http(s)/mailto;
 * any other scheme renders as plain text.
 */

import type { ReactElement, ReactNode } from "react";

import "./chat-content.css";

/** Inline constructs, longest-first so ** wins over * and __ over _. */
const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]*\))/g;

const LINK_PATTERN = /^\[([^\]]+)\]\(([^)]*)\)$/;

const FENCE_START = /^```\w*\s*$/;
const FENCE_END = /^```\s*$/;
const HEADING = /^(#{2,3})\s+(.+)$/;
const LIST_ITEM = /^(?:\d+\.\s+|[-*+]\s+)(.*)$/;
const ORDERED_ITEM = /^\d+\.\s+/;
const UNORDERED_ITEM = /^[-*+]\s+/;

/** Only safe URL schemes become anchors; everything else stays text. */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** Parse inline markup into React elements (one nesting level deep). */
function parseInline(text: string, baseKey: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  // NOTE: lastIndex is set from `cursor` before EVERY exec. The regex is
  // module-level and parseInline recurses (nested **bold** etc.); a nested
  // call clobbers lastIndex, so an outer loop that relied on the implicit
  // advance would re-match from position 0 forever (unbounded growth).
  while (true) {
    INLINE_PATTERN.lastIndex = cursor;
    const match = INLINE_PATTERN.exec(text);
    if (match === null) break;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[1];
    const key = `${baseKey}-${index++}`;
    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="md-strong">
          {parseInline(token.slice(2, -2), key)}
        </strong>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(
        <em key={key} className="md-em">
          {parseInline(token.slice(1, -1), key)}
        </em>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="md-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      // [label](url)
      const link = token.match(LINK_PATTERN);
      const href = link ? safeHref(link[2]) : null;
      nodes.push(
        href !== null && link ? (
          <a key={key} className="md-link" href={href} target="_blank" rel="noreferrer">
            {parseInline(link[1], key)}
          </a>
        ) : (
          token
        ),
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Parse block-level structure (fences, headings, lists, paragraphs). */
function parseBlocks(text: string): ReactNode[] {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const blockKey = `b${blocks.length}`;

    // Fenced code block.
    if (FENCE_START.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_END.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence (or run past EOF)
      blocks.push(
        <pre key={blockKey} className="md-codeblock">
          <code className="md-code">{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading (## / ###).
    const heading = line.match(HEADING);
    if (heading) {
      const content = parseInline(heading[2], blockKey);
      blocks.push(
        heading[1].length === 2 ? (
          <h2 key={blockKey} className="md-heading">
            {content}
          </h2>
        ) : (
          <h3 key={blockKey} className="md-heading">
            {content}
          </h3>
        ),
      );
      i += 1;
      continue;
    }

    // List — consecutive items of the same kind become one list.
    if (LIST_ITEM.test(line)) {
      const ordered = ORDERED_ITEM.test(line);
      const items: ReactNode[] = [];
      let itemIndex = 0;
      while (i < lines.length) {
        const current = lines[i];
        const isOrderedNow = ORDERED_ITEM.test(current);
        const isUnorderedNow = UNORDERED_ITEM.test(current);
        if (ordered ? !isOrderedNow : !isUnorderedNow) break;
        const content = current.replace(ordered ? ORDERED_ITEM : UNORDERED_ITEM, "");
        const itemKey = `${blockKey}-i${itemIndex++}`;
        items.push(
          <li key={itemKey} className="md-list-item">
            {parseInline(content, itemKey)}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        ordered ? (
          <ol key={blockKey} className="md-list">
            {items}
          </ol>
        ) : (
          <ul key={blockKey} className="md-list">
            {items}
          </ul>
        ),
      );
      continue;
    }

    // Blank line — skip.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraph — consecutive non-block lines, folded onto one line.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !FENCE_START.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !LIST_ITEM.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={blockKey}>{parseInline(para.join(" "), blockKey)}</p>);
  }
  return blocks;
}

export interface MarkdownTextProps {
  text: string;
  /** Extra class names for the root element (e.g. "message-text"). */
  className?: string;
}

/** Render assistant message text as markdown. The root always carries
 *  `md-content` (plus any caller className) so surfaces can style the
 *  whole block while keeping the .message-text whitespace contract. */
export function MarkdownText({ text, className }: MarkdownTextProps): ReactElement {
  const classes = className ? `${className} md-content` : "md-content";
  return <div className={classes}>{parseBlocks(text)}</div>;
}
