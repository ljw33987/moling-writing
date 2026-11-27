'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'

interface TableBlock {
  type: 'table'
  headers: string[]
  rows: string[][]
}

interface MarkdownBlock {
  type: 'markdown'
  content: string
}

type Block = TableBlock | MarkdownBlock

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c))
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function splitMarkdownAndTables(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let mdBuffer: string[] = []
  let i = 0

  const flushMd = () => {
    if (mdBuffer.length > 0) {
      const content = mdBuffer.join('\n').trim()
      if (content) blocks.push({ type: 'markdown', content })
      mdBuffer = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]
    const nextLine = lines[i + 1]

    if (line.includes('|') && nextLine !== undefined && isTableSeparator(nextLine)) {
      flushMd()
      const headers = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    mdBuffer.push(line)
    i++
  }

  flushMd()
  return blocks
}

function renderInlineCell(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>
  })
}

export function markdownToPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^\|?[\s:|-]+\|?$/gm, '')
    .replace(/\|/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function MarkdownRenderer({ content }: { content: string }) {
  const blocks = React.useMemo(() => splitMarkdownAndTables(content), [content])

  return (
    <div className="space-y-2 text-[13.5px] leading-[1.75] text-foreground/95 font-sans">
      {blocks.map((block, idx) => {
        if (block.type === 'table') {
          return (
            <div
              key={idx}
              className="my-2.5 overflow-x-auto rounded-lg border border-border bg-background/70 shadow-xs"
            >
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/70 border-b border-border">
                    {block.headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        className="px-2.5 py-2 text-left font-semibold text-foreground whitespace-nowrap"
                      >
                        {renderInlineCell(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      {block.headers.map((_, cIdx) => (
                        <td key={cIdx} className="px-2.5 py-1.5 text-foreground/90 align-top">
                          {renderInlineCell(row[cIdx] || '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        return (
          <ReactMarkdown
            key={idx}
            components={{
              h1: ({ children }) => (
                <h1 className="text-[15px] font-bold text-foreground mt-3 mb-1.5 pb-1 border-b border-border/60 first:mt-0">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-[14px] font-bold text-foreground mt-3 mb-1 flex items-center gap-1.5 first:mt-0">
                  <span className="w-1 h-3.5 rounded-full bg-indigo-500 inline-block shrink-0" />
                  <span>{children}</span>
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[13.5px] font-semibold text-foreground mt-2.5 mb-1 first:mt-0">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-xs font-semibold text-muted-foreground mt-2 mb-0.5">
                  {children}
                </h4>
              ),
              p: ({ children }) => (
                <p className="my-1.5 leading-[1.75] text-foreground/95 first:mt-0 last:mb-0">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-5 my-1.5 space-y-1 leading-[1.7]">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-5 my-1.5 space-y-1 leading-[1.7]">
                  {children}
                </ol>
              ),
              li: ({ children }) => <li className="text-foreground/95">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-indigo-500/60 bg-muted/40 pl-3 pr-2 py-1.5 my-2 rounded-r text-muted-foreground">
                  {children}
                </blockquote>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">{children}</strong>
              ),
              em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
              hr: () => <hr className="my-3 border-border/70" />,
              code: ({ children, className }) => {
                const isBlock = Boolean(className)
                if (isBlock) {
                  return (
                    <code className="block p-2.5 rounded-md bg-muted/80 font-mono text-xs overflow-x-auto my-2 border border-border/60">
                      {children}
                    </code>
                  )
                }
                return (
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-[12px]">
                    {children}
                  </code>
                )
              },
            }}
          >
            {block.content}
          </ReactMarkdown>
        )
      })}
    </div>
  )
}
