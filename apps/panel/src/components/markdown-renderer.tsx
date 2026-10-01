import Markdown from 'react-markdown';

export function MarkdownRenderer({ content }: { content: string }) {
  return <div className="guide-markdown"><Markdown skipHtml>{content}</Markdown></div>;
}
