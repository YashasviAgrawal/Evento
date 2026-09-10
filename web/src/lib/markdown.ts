/**
 * Markdown → HTML for blog articles.
 *
 * Runs only in server components, so the parser never reaches the browser
 * bundle and the article arrives as HTML in the initial response — which is
 * what a crawler reads, and the whole point of rendering posts on the server.
 *
 * Two deliberate deviations from stock Markdown:
 *
 *   * Raw HTML blocks are dropped. Posts are admin-authored and therefore
 *     trusted, but there is no reason for the article body to be an injection
 *     surface at all when nothing in the editorial workflow needs raw HTML.
 *     Relaxing this later is a one-line change; recovering from a stored XSS
 *     is not.
 *   * Headings get stable ids so the in-page table of contents can link to
 *     them, and so a search result can deep-link to a section.
 */
import { Marked, type Tokens } from 'marked';

export interface TocEntry {
  id: string;
  text: string;
}

/** Stable, URL-safe anchor derived from the heading's own words. */
function headingId(text: string): string {
  return (
    text
      .toLowerCase()
      // Strip inline markdown punctuation (**bold**, `code`, [links](…)) so the
      // anchor reflects the words a reader sees.
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'section'
  );
}

/** Plain text of a heading token, for the table of contents. */
function headingText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

const renderer = new Marked({ gfm: true, breaks: false });

renderer.use({
  renderer: {
    heading(token: Tokens.Heading) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (this as any).parser.parseInline(token.tokens);
      return `<h${token.depth} id="${headingId(token.text)}">${content}</h${token.depth}>\n`;
    },

    link(token: Tokens.Link) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (this as any).parser.parseInline(token.tokens);
      const href = token.href ?? '';
      const title = token.title ? ` title="${token.title.replace(/"/g, '&quot;')}"` : '';
      // Internal links stay in the tab — they are the reason the article exists.
      // External ones open in a new tab but are still followed, because linking
      // out to authoritative sources is good for the article, not a leak.
      const external = /^https?:\/\//i.test(href);
      const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${title}${rel}>${content}</a>`;
    },

    // Drop raw HTML rather than passing it through. See the note above.
    html: () => '',
  },
});

export interface RenderedArticle {
  html: string;
  toc: TocEntry[];
}

export function renderArticle(markdown: string): RenderedArticle {
  const source = markdown ?? '';

  // Only H2s. A contents list that mirrors every sub-heading is longer than the
  // section it points at and nobody uses it.
  const toc: TocEntry[] = renderer
    .lexer(source)
    .filter((token): token is Tokens.Heading => token.type === 'heading' && token.depth === 2)
    .map((token) => ({ id: headingId(token.text), text: headingText(token.text) }));

  // Tables carry the comparison content in these posts (price bands, planning
  // timelines) and are the one element wide enough to break a phone layout.
  // Wrapping them lets the table scroll inside itself instead of the page
  // scrolling sideways.
  const html = renderer
    .parse(source, { async: false })
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');

  return { html, toc };
}

/**
 * A plain-text lead for meta descriptions and feed summaries, when a post has
 * no explicit excerpt. Truncates on a word boundary rather than mid-word.
 */
export function plainSummary(markdown: string, maxLength = 155): string {
  const text = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[|>-].*$/gm, ' ')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}
