import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown, settledLength } from "../../src/markdown/render";

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

describe("how much of a streaming answer is settled", () => {
  it("is nothing until a paragraph ends, then everything up to its blank line", () => {
    expect(settledLength("Hel")).toBe(0);
    expect(settledLength("One line\nstill the same paragraph")).toBe(0);
    expect(settledLength("First.\n\nSecond is still")).toBe("First.\n\n".length);
    expect(settledLength("a\n\nb\n\nc")).toBe("a\n\nb\n\n".length);
  });

  it("never cuts inside a code fence, open or closed, of either kind", () => {
    const open = "Look:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n";
    expect(settledLength(open)).toBe("Look:\n\n".length);
    const closed = "```\nx\n\ny\n```\n\nAfter";
    expect(settledLength(closed)).toBe("```\nx\n\ny\n```\n\n".length);
    const tilde = "~~~~\n\n```\n\n~~~~\n\nTail";
    expect(settledLength(tilde)).toBe("~~~~\n\n```\n\n~~~~\n\n".length);
    const shortClose = "````\na\n```\n\nstill code";
    expect(settledLength(shortClose)).toBe(0);
  });

  it("renders the same in two parts as whole, at every cut it chooses", () => {
    const text = "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n```\ncode\n```\n\nEnd";
    const cut = settledLength(text);
    const parts = renderMarkdown(text.slice(0, cut)) + renderMarkdown(text.slice(cut));
    expect(parts).toBe(renderMarkdown(text));
  });
});
