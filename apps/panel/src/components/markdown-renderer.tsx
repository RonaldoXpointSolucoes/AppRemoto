import Markdown from 'react-markdown';

export function MarkdownRenderer({ content, inline = false }: { content: string; inline?: boolean }) {
  if (inline) return <span className="guide-markdown"><Markdown skipHtml components={{ p: 'span' }}>{content}</Markdown></span>;
  return <div className="guide-markdown"><Markdown skipHtml>{content}</Markdown></div>;
}
