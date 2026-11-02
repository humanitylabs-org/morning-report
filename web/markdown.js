/* Minimal, safe Markdown renderer: builds DOM nodes only (never innerHTML from report text).
 * Supports headings, paragraphs, bullet/numbered lists, bold, italics, inline code, links (http/https),
 * horizontal rules, blockquotes and ``` fenced blocks (drawn as cards by cards.js when the language is a
 * known card kind, else preformatted text). Anything else renders as plain text.
 * One-line HTML comments are never shown. `<!-- mr:section {json} -->` right under a `## ` heading marks a section
 * that came from an app (docs/report-section.md): its JSON lands on that heading as data-section; `mr:edition` and
 * `mr:off` become hidden .mr-meta nodes. routes.js reads both to draw the pickers. */
(() => {
  'use strict';
  const safeUrl = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };

  function inline(parent, text) {
    const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      let node;
      if (m[2] || m[3]) { node = document.createElement('strong'); inline(node, m[2] || m[3]); }
      else if (m[4] || m[5]) { node = document.createElement('em'); inline(node, m[4] || m[5]); }
      else if (m[6]) { node = document.createElement('code'); node.textContent = m[6]; }
      else {
        const href = safeUrl(m[8]);
        if (href) { node = document.createElement('a'); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; inline(node, m[7]); }
        else node = document.createTextNode(m[0]);
      }
      parent.append(node);
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  function render(md) {
    const root = document.createDocumentFragment();
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    let para = [], list = null, quote = null, fence = null;
    const flushPara = () => { if (para.length) { const p = document.createElement('p'); inline(p, para.join(' ')); root.append(p); para = []; } };
    const flushList = () => { list = null; };
    const flushQuote = () => { quote = null; };
    let lastH2 = null;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!fence && (m = /^\s*<!--\s*(.*?)\s*-->\s*$/.exec(line))) {
        const meta = /^mr:(section|edition|off)\s+(\{.*\})$/.exec(m[1]);
        let data = null;
        if (meta) { try { data = JSON.parse(meta[2]); } catch (e) { data = null; } }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          if (meta[1] === 'section' && lastH2 && lastH2 === root.lastChild) lastH2.dataset.section = JSON.stringify(data);
          else if (meta[1] !== 'section') { const n = document.createElement('div'); n.hidden = true; n.className = 'mr-meta'; n.dataset.kind = meta[1]; n.dataset.json = JSON.stringify(data); root.append(n); }
        }
        continue;
      }
      if (fence) {
        if (/^\s*```\s*$/.test(line)) {
          const text = fence.body.join('\n');
          root.append(window.MorningCards ? window.MorningCards.render(fence.lang, text) : Object.assign(document.createElement('pre'), { textContent: text }));
          fence = null;
        } else fence.body.push(raw);
        continue;
      }
      if ((m = /^\s*```\s*([\w-]*)\s*$/.exec(line))) { flushPara(); flushList(); flushQuote(); fence = { lang: m[1].toLowerCase(), body: [] }; continue; }
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flushPara(); flushList(); flushQuote();
        const h = document.createElement('h' + Math.min(m[1].length, 4)); inline(h, m[2]); root.append(h);
        lastH2 = h.tagName === 'H2' ? h : null; continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushPara(); flushList(); flushQuote(); root.append(document.createElement('hr')); continue; }
      if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
        flushPara(); flushQuote();
        const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== tag) { list = document.createElement(tag); root.append(list); }
        const li = document.createElement('li'); inline(li, m[2]); list.append(li); continue;
      }
      if ((m = /^>\s?(.*)$/.exec(line))) {
        flushPara(); flushList();
        if (!quote) { quote = document.createElement('blockquote'); root.append(quote); }
        const p = document.createElement('p'); inline(p, m[1]); quote.append(p); continue;
      }
      if (list && /^\s{2,}\S/.test(raw)) { inline(list.lastElementChild, ' ' + line.trim()); continue; }
      flushList(); flushQuote();
      para.push(line.trim());
    }
    if (fence) root.append(Object.assign(document.createElement('pre'), { textContent: '```' + fence.lang + '\n' + fence.body.join('\n') }));
    flushPara();
    return root;
  }
  window.MorningMarkdown = { render };
})();
