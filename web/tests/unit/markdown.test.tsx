import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../src/components/Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders inline code, bold and italic without the markers', () => {
    expect(html('The `version` field is **new** and *optional*.')).toBe(
      '<p>The <code>version</code> field is <strong>new</strong> and <em>optional</em>.</p>',
    );
  });
  it('renders bullet and numbered lists, with formatting inside items', () => {
    expect(html('Changes:\n\n- **Backend:** `main.py`\n- **Frontend:** `api.ts`\n\n1. one\n2. two')).toBe(
      '<p>Changes:</p><ul><li><strong>Backend:</strong> <code>main.py</code></li><li><strong>Frontend:</strong> <code>api.ts</code></li></ul><ol><li>one</li><li>two</li></ol>',
    );
  });
  it('renders fenced code as a block and leaves its contents alone', () => {
    expect(html('Run:\n```bash\nnpm test **x**\n```\nDone.')).toBe(
      '<p>Run:</p><pre><code>npm test **x**</code></pre><p>Done.</p>',
    );
  });
  it('joins wrapped lines into one paragraph and splits on blank lines', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one two</p><p>three</p>');
  });
  it('shows headings as bold lines and escapes HTML', () => {
    expect(html('## Summary\n<b>raw</b> & more')).toBe(
      '<p><strong>Summary</strong></p><p>&lt;b&gt;raw&lt;/b&gt; &amp; more</p>',
    );
  });
  it('leaves underscores inside identifiers alone', () => {
    expect(html('Use snake_case_name here.')).toBe('<p>Use snake_case_name here.</p>');
  });
});
