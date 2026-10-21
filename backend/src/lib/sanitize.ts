import sanitizeHtml from 'sanitize-html';

// Rich text (question wording, explanations) is stored as HTML, so it is cleaned on the way IN:
// only simple formatting survives. Scripts, event handlers, styles, iframes and images are removed.
const richTextOptions: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'sub', 'sup', 'h3', 'h4', 'a'],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

export const sanitizeRichText = (html: string): string => sanitizeHtml(html, richTextOptions).trim();

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Plain text of an HTML snippet, for previews and "is this empty?" checks.
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Plain-text fields (option text, accepted answers) are stored as typed and shown as text, never as HTML.
// Anything that looks like a tag is refused instead of being silently changed.
export const looksLikeMarkup = (value: string): boolean => /<\/?[a-zA-Z!?]/.test(value);