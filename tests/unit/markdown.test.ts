import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown } from "../../src/markdown/render";

describe("rendering Lucy's words", () => {
  it("renders markdown structure", () => {
    expect(renderMarkdown("# Hi\n\n- one\n- two")).toContain("<h1>");
    expect(renderMarkdown("`code`")).toContain("<code>");
  });

  it("escapes raw HTML instead of letting it run", () => {
    const html = renderMarkdown("before <img src=x onerror=alert(1)> <script>alert(1)</script> after");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses javascript: and data: links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain('href="javascript:');
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("<a ");
    expect(renderMarkdown("[x](data:text/html;base64,xx)")).not.toContain('href="data:');
  });

  it("opens links in a new tab that carries no opener, including autolinked ones", () => {
    const html = renderMarkdown("See [docs](https://example.org) and https://example.com");
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    }
  });

  it("renders inline without block structure", () => {
    const inline = renderInline("**bold** idea");
    expect(inline).toContain("<strong>");
    expect(inline).not.toContain("<p>");
  });
});
