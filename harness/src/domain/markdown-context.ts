/** Source offsets are retained; uncertain Markdown must expand retrieval, never narrow it. */
export function markdownHeadings(body: string) {
  const headings: Array<{ level: number; title: string; offset: number }> = [];
  let fence: { character: string; length: number } | null = null;
  let offset = 0, ambiguous = false;
  for (const line of body.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1]![0]!, length: marker[1]!.length };
      else if (marker[1]![0] === fence.character && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = null;
    } else if (!fence) {
      const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?\n?$/.exec(line);
      if (heading) headings.push({ level: heading[1]!.length, title: heading[2]!, offset });
      // Setext, indented headings and HTML can change section boundaries.
      if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(line.trimEnd()) || /^\s*<(?!\!--)/.test(line)
        || /^ {4,}#{1,6}\s/.test(line)) ambiguous = true;
    }
    offset += line.length;
  }
  return { headings, ambiguous: ambiguous || fence !== null };
}
