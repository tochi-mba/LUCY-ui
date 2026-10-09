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
