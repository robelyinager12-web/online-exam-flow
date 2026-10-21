import { describe, expect, it } from 'vitest';
import { htmlToPlainText, looksLikeMarkup, sanitizeRichText } from '../../src/lib/sanitize';

describe('sanitizeRichText', () => {
  it('removes scripts, event handlers, iframes, styles and images', () => {
    expect(sanitizeRichText('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
    expect(sanitizeRichText('<p onclick="steal()">Hi</p>')).toBe('<p>Hi</p>');
    expect(sanitizeRichText('<img src=x onerror="alert(1)">Text')).toBe('Text');
    expect(sanitizeRichText('<iframe src="https://evil.example"></iframe>Text')).toBe('Text');
    expect(sanitizeRichText('<p style="position:fixed">Hi</p>')).toBe('<p>Hi</p>');
  });

  it('keeps simple formatting', () => {
    const html = '<p>Use <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p><ul><li>one</li><li>two</li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('strips dangerous link targets but keeps safe ones, with a safe rel attribute', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer" target="_blank">x</a>');
    expect(sanitizeRichText('<a href="//evil.example/x">x</a>')).not.toContain('evil.example');
    const safe = sanitizeRichText('<a href="https://example.com/page">x</a>');
    expect(safe).toContain('href="https://example.com/page"');
    expect(safe).toContain('rel="noopener noreferrer"');
    expect(sanitizeRichText('<a href="mailto:a@b.c">mail</a>')).toContain('href="mailto:a@b.c"');
  });

  it('does not let a data: or vbscript: link through', () => {
    expect(sanitizeRichText('<a href="data:text/html,<script>1</script>">x</a>')).not.toContain('data:');
    expect(sanitizeRichText('<a href="vbscript:run">x</a>')).not.toContain('vbscript');
  });
});

describe('htmlToPlainText', () => {
  it('removes tags and decodes entities', () => {
    expect(htmlToPlainText('<p>Tom &amp; Jerry &lt;3 &#65;&#x42;</p>')).toBe('Tom & Jerry <3 AB');
  });

  it('collapses whitespace and returns an empty string for empty markup', () => {
    expect(htmlToPlainText('<p>  a   <br> b </p>')).toBe('a b');
    expect(htmlToPlainText('<p></p><br>')).toBe('');
  });

  it('leaves unknown entities untouched instead of failing', () => {
    expect(htmlToPlainText('&unknown; &#99999999;')).toBe('&unknown; &#99999999;');
  });
});

describe('looksLikeMarkup', () => {
  it('flags tags, closing tags and comments', () => {
    for (const value of ['<b>x</b>', '</div>', '<!-- hi -->', '<script>', 'a <img src=x>']) {
      expect(looksLikeMarkup(value)).toBe(true);
    }
  });

  it('allows ordinary maths and comparisons', () => {
    for (const value of ['x < y', 'a<3', '5 > 2', '2 < 3 and 4 > 1']) {
      expect(looksLikeMarkup(value)).toBe(false);
    }
  });
});