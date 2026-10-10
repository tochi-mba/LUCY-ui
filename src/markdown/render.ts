/**
 * Model text, rendered. Lucy's words are markdown; they are also untrusted (AGENTS.md,
 * invariant 5), so raw HTML stays escaped (`html: false`), markdown-it's own validateLink refuses
 * javascript: and data: addresses, and every link opens in a new tab carrying no opener.
 */
import MarkdownIt from "markdown-it";

const renderer = new MarkdownIt({ html: false, linkify: true, breaks: true });

const defaultLink =
  renderer.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

renderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, idx, options, env, self);
};

export function renderMarkdown(text: string): string {
  return renderer.render(text);
}

/** One line of it, for titles and card descriptions: emphasis without block structure. */
export function renderInline(text: string): string {
  return renderer.renderInline(text);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * How much of a growing answer is settled: everything up to its last blank line outside a code
 * fence. Markdown cannot reach back across a paragraph break, so the text before it renders the
 * same whatever arrives next; a stream renders that part once and re-renders only the tail. A
 * fence still open keeps every line after its opening in the tail.
 */
export function settledLength(text: string): number {
  let fence: string | null = null;
  let settled = 0;
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    if (end === -1) return settled;
    const line = text.slice(start, end);
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (fence === null && line.trim() === "") {
      settled = end + 1;
    }
    start = end + 1;
  }
}
