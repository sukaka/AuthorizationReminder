type OutputBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string };

function stripMarkdownMarkers(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^_{3,}$|^-{3,}$|^\*{3,}$/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDivider(line: string): boolean {
  return /^[-*_]{3,}$/.test(line.trim());
}

function isHeading(line: string): boolean {
  return /^(?:[一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十]+[章节部分]|[0-9]+[.．、])\s*\S{1,24}$/.test(line)
    || /^[^。！？!?：:]{2,24}$/.test(line);
}

function parseBusinessBlocks(text: string): OutputBlock[] {
  return text
    .split(/\r?\n/)
    .map(stripMarkdownMarkers)
    .filter((line) => line && !isDivider(line))
    .map((line) => ({
      type: isHeading(line) ? 'heading' : 'paragraph',
      text: line,
    }));
}

export function plainBusinessText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map(stripMarkdownMarkers)
    .filter((line) => line && !isDivider(line));

  return lines.join('\n\n');
}

export function OutputReader({
  emptyText,
  text,
}: {
  emptyText: string;
  text?: string | null;
}) {
  const blocks = parseBusinessBlocks(text || '');

  if (!blocks.length) {
    return <p className="output-empty">{emptyText}</p>;
  }

  return (
    <div className="output-reader">
      {blocks.map((block, index) => (
        block.type === 'heading'
          ? <h3 key={`${block.text}-${index}`}>{block.text}</h3>
          : <p key={`${block.text}-${index}`}>{block.text}</p>
      ))}
    </div>
  );
}
