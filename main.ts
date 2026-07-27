import { Plugin, TFile, Vault, MarkdownRenderer, Component } from "obsidian";
import { EditorView } from "@codemirror/view";

interface SearchEntry { title: string; path: string; content: string; ctime: number; }
interface SearchResult { entry: SearchEntry; snippet: string; matchSentence: string | null; }

class SearchIndex {
  private entries: SearchEntry[] = [];
  async build(vault: Vault) { for (const f of vault.getMarkdownFiles()) { try { const c = await vault.cachedRead(f); this.entries.push({ title: f.basename, path: f.path, content: c, ctime: f.stat.ctime }); } catch {} } }
  add(f: TFile, vault: Vault) { this.remove(f.path); vault.cachedRead(f).then(c => { this.entries.push({ title: f.basename, path: f.path, content: c, ctime: f.stat.ctime }); }); }
  remove(path: string) { this.entries = this.entries.filter(e => e.path !== path); }
  search(query: string, limit = 20): SearchResult[] {
    if (!query) return [];
    const q = query.toLowerCase(), scored: Array<{ r: SearchResult; s: number }> = [];
    for (const e of this.entries) { const m = this.match(e, q); if (m.s > 0) scored.push({ r: m, s: m.s }); }
    return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.r);
  }
  stripFM(c: string): string { if (c.startsWith("---")) { const end = c.indexOf("---", 3); if (end !== -1) return c.slice(end + 3); } return c; }
  private match(e: SearchEntry, q: string): SearchResult & { s: number } {
    const lt = e.title.toLowerCase(), body = this.stripFM(e.content), lb = body.toLowerCase(), ti = lt.indexOf(q), bi = lb.indexOf(q);
    let s = 0;
    if (lt === q) s = 1000; else if (ti === 0) s = 500 + (100 - Math.min(q.length, 100)); else if (ti > 0) s = 300 - Math.min(ti, 100);
    if (bi !== -1) s += 100 - Math.min(bi / 10, 50);
    const snippet = bi >= 0 ? this.win(body, bi, q.length, 15) : e.title;
    const matchSentence = bi >= 0 ? this.sentence(body, bi, q.length) : null;
    return { s: Math.max(0, Math.floor(s)), entry: e, snippet, matchSentence };
  }
  private cleanMD(r: string): string { return r.replace(/!\[\[[^\]]*\]\]/g, "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_~`]+/g, "").replace(/->/g, " ").replace(/>\s?/g, "").replace(/^\s*[-*+]\s+/g, "").replace(/^\s*\d+\.\s+/g, "").replace(/\|/g, "/").trim(); }
  win(content: string, start: number, len: number, w: number): string { const s = Math.max(0, start - w), e = Math.min(content.length, start + len + w); let r = content.slice(s, e); if (s > 0) r = "…" + r; if (e < content.length) r = r + "…"; return this.cleanMD(r).replace(/\n+/g, " · ").replace(/\s{2,}/g, " ").replace(/^[。！？.!?；;，,、\s\-–—]+/, "").replace(/[。！？.!?；;，,、\s\-–—]+$/, "").replace(/\s-\s/g, " ").replace(/\s-$/, "").trim() || "(empty)"; }
  private sentence(content: string, start: number, len: number): string | null {
    // Sentence terminators only (。！？.!? and newline), not comma/semicolon
    // Search left/right for nearest terminator, but cap at ~40 chars each way
    let left = Math.max(0, start - 40);
    let right = Math.min(content.length, start + len + 40);
    {
      const slice = content.slice(left, start);
      const m = slice.match(/[。！？.!?\n]/g);
      if (m) left = left + slice.lastIndexOf(m[m.length - 1]) + 1;
    }
    {
      const slice = content.slice(start + len, right);
      const m = slice.match(/[。！？.!?\n]/);
      if (m) right = start + len + (m.index ?? 0);
    }
    let r = content.slice(left, right).trim();
    // Prepend heading context if match is under a heading
    const h = this.findHeading(content, start);
    if (h) r = h + " › " + r;
    // Trim punctuation from ends
    r = r.replace(/^[。！？.!?；;，,、\s\-–—]+/, "").replace(/[。！？.!?；;，,、\s\-–—]+$/, "");
    if (r.length < 4) r = content.slice(start, start + len + 30).trim(); // fallback
    r = this.cleanMD(r);
    // Final trim: remove trailing/leading punctuation, dashes, whitespace
    r = r.replace(/^[。！？.!?；;，,、\s\-–—]+/, "").replace(/[。！？.!?；;，,、\s\-–—]+$/, "");
    return r.length > 80 ? r.slice(0, 77) + "…" : (r || null);
  }

  /** Find the nearest heading above a position. Returns null if none within ~30 lines. */
  private findHeading(content: string, pos: number): string | null {
    const before = content.slice(0, pos);
    const lines = before.split("\n");
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
      const m = lines[i].match(/^#{1,6}\s+(.+)/);
      if (m) return this.cleanMD(m[1]);
    }
    return null;
  }
}

const AT_RE = /@([^\[\]()]*)$/u;

// ===== Popup =====

class Popup {
  el: HTMLElement;
  private detailEl: HTMLElement;
  private detailCmp: Component;
  private items: HTMLElement[] = [];
  private results: SearchResult[] = [];
  private sel = 0;
  private from = 0;
  private view: EditorView | null = null;
  private _lastQuery = "";
  private _lastKeyTime = 0;
  private _positionAbove = false; // sticky position to avoid flipping

  constructor(private index: SearchIndex, private app: any) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, { position: "fixed", zIndex: "9999", display: "none", maxHeight: "360px", minWidth: "380px", maxWidth: "640px", overflowX: "hidden", overflowY: "auto", background: "var(--background-primary, #1e1e1e)", border: "1px solid var(--background-modifier-border, #333)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", padding: "4px 0", fontFamily: "var(--font-text, sans-serif)", fontSize: "13px" });
    document.body.appendChild(this.el);

    this.detailEl = document.createElement("div");
    Object.assign(this.detailEl.style, { position: "fixed", zIndex: "9999", display: "none", width: "550px", height: "360px", overflow: "hidden", overflowY: "auto", background: "var(--background-primary, #1e1e1e)", border: "1px solid var(--background-modifier-border, #333)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", padding: "10px 14px", contain: "strict" });
    document.body.appendChild(this.detailEl);
    this.detailCmp = new Component();
  }

  show(view: EditorView, from: number, query: string) {
    this.view = view; this.from = from; this._lastQuery = query;
    this.results = this.index.search(query, 20); this.sel = 0;
    if (!this.results.length) {
      // Don't hide — show empty state so popup stays, user can backspace
      this.results = []; this.sel = 0;
    }
    const coords = view.coordsAtPos(from);
    if (!coords) { this.hide(); return; }
    this.el.style.left = Math.min(Math.max(0, coords.left), window.innerWidth - 650) + "px";
    // Sticky position: only decide above/below on first open, keep until hidden
    const wasHidden = this.el.style.display === "none";
    if (wasHidden) {
      this._positionAbove = coords.bottom + 360 + 8 > window.innerHeight;
    }
    this.el.style.top = this._positionAbove
      ? Math.max(0, coords.top - 360 - 8) + "px"
      : (coords.bottom + 4) + "px";
    // Hard clamp: never let popup bottom exceed viewport
    const clampTop = window.innerHeight - Math.min(this.el.offsetHeight || 100, 360) - 16;
    this.el.style.top = Math.min(parseFloat(this.el.style.top), Math.max(0, clampTop)) + "px";
    this.el.style.display = "block";
    this.render();
    this.showDetail(0);
  }

  hide() { this.el.style.display = "none"; this.detailEl.style.display = "none"; this.detailEl.innerHTML = ""; this.items = []; this.results = []; this.view = null; }
  get visible() { return this.el.style.display !== "none"; }

  move(delta: number) {
    if (!this.results.length) return;
    this.sel = Math.max(0, Math.min(this.sel + delta, this.results.length - 1));
    this._lastKeyTime = Date.now();
    this.updateSelection();
    // Scroll item into view
    const item = this.items[this.sel];
    if (item) {
      const it = item.offsetTop - this.el.scrollTop;
      if (it < 0 || it + item.offsetHeight > this.el.clientHeight)
        this.el.scrollTop = item.offsetTop - this.el.clientHeight / 2 + item.offsetHeight / 2;
    }
    this.showDetail(this.sel);
  }

  accept() {
    const r = this.results[this.sel];
    if (!r || !this.view) return;
    const alias = r.matchSentence; // full sentence, not window snippet
    const title = r.entry.title;
    // Check if alias starts with a heading (from findHeading)
    const headingSep = alias ? alias.indexOf(" › ") : -1;
    const hasHeading = headingSep > 0;
    const heading = hasHeading ? alias!.slice(0, headingSep) : null;
    const sentence = hasHeading ? alias!.slice(headingSep + 3) : alias;
    const target = heading ? `${title}#${heading}` : title;
    const insert = `[[${target}|${sentence || title}]]`;
    const pos = this.view.state.selection.main.head;
    const selText = sentence || title;
    const newEnd = this.from + insert.length;
    this.view.dispatch({ changes: { from: this.from, to: pos, insert }, selection: { anchor: newEnd - selText.length - 2, head: newEnd - 2 } });
    this.hide(); this.view.focus();
  }

  // -- render (full build, only on new search) --
  private render() {
    this.el.innerHTML = "";
    this.items = [];
    if (!this.results.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:12px 16px;color:var(--text-muted);font-size:13px;";
      empty.textContent = "No matching notes";
      this.el.appendChild(empty);
      return;
    }
    for (let i = 0; i < this.results.length; i++) {
      const r = this.results[i];
      const item = document.createElement("div");
      item.style.cssText = `padding:8px 16px;cursor:pointer;line-height:1.4;${i === this.sel ? "background:var(--background-modifier-hover, #333);" : ""}`;
      const title = document.createElement("div"); title.style.cssText = "font-weight:600;font-size:13px;"; title.textContent = r.entry.title; item.appendChild(title);
      const sn = document.createElement("div");
      sn.style.cssText = `font-size:12px;margin-top:2px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:${r.matchSentence ? "var(--text-accent, #7aa2f7)" : "var(--text-muted, #888)"};`;
      const q = this._lastQuery, ls = r.snippet.toLowerCase(), lq = q.toLowerCase();
      if (q && ls.includes(lq)) {
        const idx = ls.indexOf(lq);
        sn.appendChild(document.createTextNode(r.snippet.slice(0, idx)));
        const mk = document.createElement("b"); mk.style.cssText = "background:#FFE066;color:#333;padding:0 2px;border-radius:2px;"; mk.textContent = r.snippet.slice(idx, idx + q.length); sn.appendChild(mk);
        sn.appendChild(document.createTextNode(r.snippet.slice(idx + q.length)));
      } else { sn.textContent = r.snippet; }
      item.appendChild(sn);
      const idx = i;
      item.addEventListener("mousedown", e => { e.preventDefault(); this.sel = idx; this.accept(); });
      item.addEventListener("mouseenter", () => {
        if (Date.now() - this._lastKeyTime < 300) return;
        if (this.sel !== idx) { this.sel = idx; this.updateSelection(); this.showDetail(idx); }
      });
      this.el.appendChild(item);
      this.items.push(item);
    }
  }

  // -- only update bg, no rebuild --
  private updateSelection() {
    for (let i = 0; i < this.items.length; i++)
      this.items[i].style.background = i === this.sel ? "var(--background-modifier-hover, #333)" : "";
  }

  // -- detail panel --
  private showDetail(idx: number) {
    const r = this.results[idx]; if (!r) { this.detailEl.style.display = "none"; return; }
    const body = this.index.stripFM(r.entry.content);

    this.detailEl.innerHTML = "";
    this.detailCmp?.unload();
    this.detailCmp = new Component();
    this.detailCmp.load();
    MarkdownRenderer.render(this.app, body, this.detailEl, r.entry.path, this.detailCmp);
    // Style tables + highlight keyword after render
    setTimeout(() => {
      this.detailEl.querySelectorAll("table").forEach(t => { (t as HTMLElement).style.cssText = "border-collapse:collapse;width:100%;margin:8px 0;"; });
      this.detailEl.querySelectorAll("th, td").forEach(c => { (c as HTMLElement).style.cssText = "border:1px solid var(--background-modifier-border,#444);padding:4px 8px;text-align:left;"; });
      this.detailEl.querySelectorAll("th").forEach(c => { (c as HTMLElement).style.background = "var(--background-modifier-hover,#333)"; });
      const q = this._lastQuery;
      if (q) {
        const marks = this.highlightNodes(this.detailEl, q.toLowerCase());
        if (marks.length) {
          const dt = this.detailEl;
          dt.scrollTop = marks[0].offsetTop - dt.clientHeight / 2;
        }
      }
    }, 150);
    // Position
    const rect = this.el.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + 600 > window.innerWidth) left = Math.max(0, rect.left - 608);
    this.detailEl.style.left = left + "px";
    this.detailEl.style.top = rect.top + "px";
    // Match popup height so they align
    this.detailEl.style.height = rect.height + "px";
    this.detailEl.style.display = "block";
  }

  private highlightNodes(el: HTMLElement, q: string): HTMLElement[] {
    const marks: HTMLElement[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, text = node.textContent || "", lower = text.toLowerCase();
      if (!lower.includes(q)) continue;
      const frag = document.createDocumentFragment(); let last = 0, idx: number;
      while ((idx = lower.indexOf(q, last)) !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mk = document.createElement("mark"); mk.style.cssText = "background:#FFE066;color:#333;padding:0 2px;border-radius:2px;"; mk.textContent = text.slice(idx, idx + q.length); frag.appendChild(mk); marks.push(mk);
        last = idx + q.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    }
    return marks;
  }

  destroy() { this.el.remove(); this.detailEl.remove(); this.detailCmp?.unload(); }
}

// ===== Plugin =====

function debounce(fn: () => void, ms: number): () => void { let t: any; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

export default class AtMentionPlugin extends Plugin {
  private index = new SearchIndex();
  private popup: Popup | null = null;
  private kbView: EditorView | null = null;
  private pending = new Set<string>();

  async onload() {
    setTimeout(async () => {
      await this.index.build(this.app.vault);
      const count = this.app.vault.getMarkdownFiles().length;
      // Ready

      this.registerEvent(this.app.vault.on("create", f => { if (f instanceof TFile && f.extension === "md") this.index.add(f, this.app.vault); }));
      const flush = debounce(() => { for (const p of this.pending) { const f = this.app.vault.getAbstractFileByPath(p); if (f instanceof TFile) this.index.add(f, this.app.vault); } this.pending.clear(); }, 1000);
      this.registerEvent(this.app.vault.on("modify", f => { if (f instanceof TFile && f.extension === "md") { this.pending.add(f.path); flush(); } }));
      this.registerEvent(this.app.vault.on("delete", f => { if (f instanceof TFile) this.index.remove(f.path); }));
      this.registerEvent(this.app.vault.on("rename", (f, old) => { if (f instanceof TFile) { this.index.remove(old); this.index.add(f, this.app.vault); } }));

      this.registerEvent(this.app.workspace.on("editor-change", (editor) => {
        const view = (editor as any).cm as EditorView | undefined;
        if (!view) return;
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const before = line.text.slice(0, pos - line.from);
        const match = before.match(AT_RE);
        if (!match) { this.popup?.hide(); this.dismissed = false; return; }
        // Don't re-show if user explicitly dismissed this @ session
        if (this.dismissed) return;
        const query = match[1], from = pos - query.length - 1;
        if (!this.popup) { this.popup = new Popup(this.index, this.app); }
      // Register keyboard only once per view
      if (this.kbView !== view) {
        this.kbView = view;
        this.registerKb(view);
      }
        this.popup.show(view, from, query);
      }));

      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.popup?.hide()));

      // Click outside popup/detail → hide
      this.registerDomEvent(document, "mousedown", (e: MouseEvent) => {
        if (!this.popup?.visible) return;
        const t = e.target as HTMLElement;
        if (!this.popup.el.contains(t) && !this.popup.detailEl.contains(t)) { this.popup.hide(); this.dismissed = true; }
      });
    }, 100);
  }

  private registerKb(view: EditorView) {
    let composing = false;
    view.dom.addEventListener("compositionstart", () => { composing = true; });
    view.dom.addEventListener("compositionend", () => { composing = false; });
    view.dom.addEventListener("keydown", (e: KeyboardEvent) => {
      if (!this.popup?.visible) return;
      // Don't intercept Enter during IME composition (confirming Chinese chars)
      if (e.key === "Enter" && composing) return;
      switch (true) {
        case e.key === "ArrowDown" || (e.ctrlKey && e.key === "n"): e.preventDefault(); e.stopPropagation(); this.popup.move(1); break;
        case e.key === "ArrowUp" || (e.ctrlKey && e.key === "p"): e.preventDefault(); e.stopPropagation(); this.popup.move(-1); break;
        case e.key === "Enter": e.preventDefault(); e.stopPropagation(); this.popup.accept(); break;
        case e.key === "Escape": e.preventDefault(); this.popup.hide(); this.dismissed = true; break;
      }
    }, true);
  }

  onunload() { this.popup?.destroy(); }
}
