"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AtMentionPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var SearchIndex = class {
  constructor() {
    this.entries = [];
  }
  async build(vault) {
    for (const f of vault.getMarkdownFiles()) {
      try {
        const c = await vault.cachedRead(f);
        this.entries.push({ title: f.basename, path: f.path, content: c, ctime: f.stat.ctime });
      } catch {
      }
    }
  }
  add(f, vault) {
    this.remove(f.path);
    vault.cachedRead(f).then((c) => {
      this.entries.push({ title: f.basename, path: f.path, content: c, ctime: f.stat.ctime });
    });
  }
  remove(path) {
    this.entries = this.entries.filter((e) => e.path !== path);
  }
  search(query, limit = 20) {
    if (!query) return [];
    const q = query.toLowerCase(), scored = [];
    for (const e of this.entries) {
      const m = this.match(e, q);
      if (m.s > 0) scored.push({ r: m, s: m.s });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.r);
  }
  stripFM(c) {
    if (c.startsWith("---")) {
      const end = c.indexOf("---", 3);
      if (end !== -1) return c.slice(end + 3);
    }
    return c;
  }
  match(e, q) {
    const lt = e.title.toLowerCase(), body = this.stripFM(e.content), lb = body.toLowerCase(), ti = lt.indexOf(q), bi = lb.indexOf(q);
    let s = 0;
    if (lt === q) s = 2e3;
    else if (ti === 0) s = 800 + (100 - Math.min(q.length, 100));
    else if (ti > 0) s = 500 - Math.min(ti, 100);
    if (bi !== -1) s += Math.max(0, 20 - Math.min(bi / 50, 20));
    const snippet = bi >= 0 ? this.win(body, bi, q.length, 15) : e.title;
    const matchSentence = bi >= 0 ? this.sentence(body, bi, q.length) : null;
    return { s: Math.max(0, Math.floor(s)), entry: e, snippet, matchSentence };
  }
  cleanMD(r) {
    return r.replace(/!\[\[[^\]]*\]\]/g, "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_~`]+/g, "").replace(/->/g, " ").replace(/>\s?/g, "").replace(/^\s*[-*+]\s+/g, "").replace(/^\s*\d+\.\s+/g, "").replace(/\|/g, "/").trim();
  }
  win(content, start, len, w) {
    const s = Math.max(0, start - w), e = Math.min(content.length, start + len + w);
    let r = content.slice(s, e);
    if (s > 0) r = "\u2026" + r;
    if (e < content.length) r = r + "\u2026";
    return this.cleanMD(r).replace(/\n+/g, " \xB7 ").replace(/\s{2,}/g, " ").replace(/^[。！？.!?；;，,、\s\-–—]+/, "").replace(/[。！？.!?；;，,、\s\-–—]+$/, "").replace(/\s-\s/g, " ").replace(/\s-$/, "").trim() || "(empty)";
  }
  sentence(content, start, len) {
    const TERM = /[。！？]|[.!?](?=\s|$)|\n/g;
    let left = Math.max(0, start - 120);
    let right = Math.min(content.length, start + len + 120);
    {
      let m;
      let lastIdx = -1;
      const slice = content.slice(left, start);
      TERM.lastIndex = 0;
      while ((m = TERM.exec(slice)) !== null) lastIdx = m.index + m[0].length;
      if (lastIdx >= 0) left = left + lastIdx;
    }
    {
      const slice = content.slice(start + len, right);
      const idx = slice.search(TERM);
      if (idx >= 0) right = start + len + idx;
    }
    let r = content.slice(left, right).trim();
    const h = this.findHeading(content, start);
    if (h) r = h + " \u203A " + r;
    r = r.replace(/^[。！？.!?；;，,、\s\-–—]+/, "").replace(/[。！？.!?；;，,、\s\-–—]+$/, "");
    if (r.length < 4) r = content.slice(start, start + len + 30).trim();
    r = this.cleanMD(r);
    r = r.replace(/^[。！？.!?；;，,、\s\-–—]+/, "").replace(/[。！？.!?；;，,、\s\-–—]+$/, "");
    return r.length > 100 ? r.slice(0, 97) + "\u2026" : r || null;
  }
  /** Find the nearest heading above a position. Returns null if none within ~30 lines. */
  findHeading(content, pos) {
    const before = content.slice(0, pos);
    const lines = before.split("\n");
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
      const m = lines[i].match(/^#{1,6}\s+(.+)/);
      if (m) return this.cleanMD(m[1]);
    }
    return null;
  }
};
var AT_RE = /@([^\[\]()]*)$/u;
var Popup = class {
  // sticky position to avoid flipping
  constructor(index, app) {
    this.index = index;
    this.app = app;
    this.items = [];
    this.results = [];
    this.sel = 0;
    this.from = 0;
    this.view = null;
    this._lastQuery = "";
    this._lastKeyTime = 0;
    this._positionAbove = false;
    this.el = document.createElement("div");
    Object.assign(this.el.style, { position: "fixed", zIndex: "9999", display: "none", maxHeight: "360px", minWidth: "380px", maxWidth: "640px", overflowX: "hidden", overflowY: "auto", background: "var(--background-primary, #1e1e1e)", border: "1px solid var(--background-modifier-border, #333)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", padding: "4px 0", fontFamily: "var(--font-text, sans-serif)", fontSize: "13px" });
    document.body.appendChild(this.el);
    this.detailEl = document.createElement("div");
    Object.assign(this.detailEl.style, { position: "fixed", zIndex: "9999", display: "none", width: "550px", height: "360px", overflow: "hidden", overflowY: "auto", background: "var(--background-primary, #1e1e1e)", border: "1px solid var(--background-modifier-border, #333)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", padding: "10px 14px", contain: "strict" });
    document.body.appendChild(this.detailEl);
    this.detailCmp = new import_obsidian.Component();
  }
  show(view, from, query) {
    this.view = view;
    this.from = from;
    this._lastQuery = query;
    this.results = this.index.search(query, 20);
    this.sel = 0;
    if (!this.results.length) {
      this.results = [];
      this.sel = 0;
    }
    const coords = view.coordsAtPos(from);
    if (!coords) {
      this.hide();
      return;
    }
    this.el.style.left = Math.min(Math.max(0, coords.left), window.innerWidth - 650) + "px";
    const wasHidden = this.el.style.display === "none";
    if (wasHidden) {
      this._positionAbove = coords.bottom + 360 + 8 > window.innerHeight;
    }
    this.el.style.top = this._positionAbove ? Math.max(0, coords.top - 360 - 8) + "px" : coords.bottom + 4 + "px";
    const clampTop = window.innerHeight - Math.min(this.el.offsetHeight || 100, 360) - 16;
    this.el.style.top = Math.min(parseFloat(this.el.style.top), Math.max(0, clampTop)) + "px";
    this.el.style.display = "block";
    this.render();
    this.showDetail(0);
  }
  hide() {
    this.el.style.display = "none";
    this.detailEl.style.display = "none";
    this.detailEl.innerHTML = "";
    this.items = [];
    this.results = [];
    this.view = null;
  }
  get visible() {
    return this.el.style.display !== "none";
  }
  move(delta) {
    if (!this.results.length) return;
    this.sel = Math.max(0, Math.min(this.sel + delta, this.results.length - 1));
    this._lastKeyTime = Date.now();
    this.updateSelection();
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
    const alias = r.matchSentence;
    const title = r.entry.title;
    const headingSep = alias ? alias.indexOf(" \u203A ") : -1;
    const hasHeading = headingSep > 0;
    const heading = hasHeading ? alias.slice(0, headingSep) : null;
    const sentence = hasHeading ? alias.slice(headingSep + 3) : alias;
    const target = heading ? `${title}#${heading}` : title;
    const insert = `[[${target}|${sentence || title}]]`;
    const pos = this.view.state.selection.main.head;
    const selText = sentence || title;
    const newEnd = this.from + insert.length;
    this.view.dispatch({ changes: { from: this.from, to: pos, insert }, selection: { anchor: newEnd - selText.length - 2, head: newEnd - 2 } });
    this.hide();
    this.view.focus();
  }
  // -- render (full build, only on new search) --
  render() {
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
      const title = document.createElement("div");
      title.style.cssText = "font-weight:600;font-size:13px;";
      title.textContent = r.entry.title;
      item.appendChild(title);
      const sn = document.createElement("div");
      sn.style.cssText = `font-size:12px;margin-top:2px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:${r.matchSentence ? "var(--text-accent, #7aa2f7)" : "var(--text-muted, #888)"};`;
      const q = this._lastQuery, ls = r.snippet.toLowerCase(), lq = q.toLowerCase();
      if (q && ls.includes(lq)) {
        const idx2 = ls.indexOf(lq);
        sn.appendChild(document.createTextNode(r.snippet.slice(0, idx2)));
        const mk = document.createElement("b");
        mk.style.cssText = "background:#FFE066;color:#333;padding:0 2px;border-radius:2px;";
        mk.textContent = r.snippet.slice(idx2, idx2 + q.length);
        sn.appendChild(mk);
        sn.appendChild(document.createTextNode(r.snippet.slice(idx2 + q.length)));
      } else {
        sn.textContent = r.snippet;
      }
      item.appendChild(sn);
      const idx = i;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.sel = idx;
        this.accept();
      });
      item.addEventListener("mouseenter", () => {
        if (Date.now() - this._lastKeyTime < 300) return;
        if (this.sel !== idx) {
          this.sel = idx;
          this.updateSelection();
          this.showDetail(idx);
        }
      });
      this.el.appendChild(item);
      this.items.push(item);
    }
  }
  // -- only update bg, no rebuild --
  updateSelection() {
    for (let i = 0; i < this.items.length; i++)
      this.items[i].style.background = i === this.sel ? "var(--background-modifier-hover, #333)" : "";
  }
  // -- detail panel --
  showDetail(idx) {
    const r = this.results[idx];
    if (!r) {
      this.detailEl.style.display = "none";
      return;
    }
    const body = this.index.stripFM(r.entry.content);
    this.detailEl.innerHTML = "";
    this.detailCmp?.unload();
    this.detailCmp = new import_obsidian.Component();
    this.detailCmp.load();
    import_obsidian.MarkdownRenderer.render(this.app, body, this.detailEl, r.entry.path, this.detailCmp);
    setTimeout(() => {
      this.detailEl.querySelectorAll("table").forEach((t) => {
        t.style.cssText = "border-collapse:collapse;width:100%;margin:8px 0;";
      });
      this.detailEl.querySelectorAll("th, td").forEach((c) => {
        c.style.cssText = "border:1px solid var(--background-modifier-border,#444);padding:4px 8px;text-align:left;";
      });
      this.detailEl.querySelectorAll("th").forEach((c) => {
        c.style.background = "var(--background-modifier-hover,#333)";
      });
      const q = this._lastQuery;
      if (q) {
        const marks = this.highlightNodes(this.detailEl, q.toLowerCase());
        if (marks.length) {
          const dt = this.detailEl;
          dt.scrollTop = marks[0].offsetTop - dt.clientHeight / 2;
        }
      }
    }, 150);
    const rect = this.el.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + 600 > window.innerWidth) left = Math.max(0, rect.left - 608);
    this.detailEl.style.left = left + "px";
    this.detailEl.style.top = rect.top + "px";
    this.detailEl.style.height = rect.height + "px";
    this.detailEl.style.display = "block";
  }
  highlightNodes(el, q) {
    const marks = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, text = node.textContent || "", lower = text.toLowerCase();
      if (!lower.includes(q)) continue;
      const frag = document.createDocumentFragment();
      let last = 0, idx;
      while ((idx = lower.indexOf(q, last)) !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mk = document.createElement("mark");
        mk.style.cssText = "background:#FFE066;color:#333;padding:0 2px;border-radius:2px;";
        mk.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mk);
        marks.push(mk);
        last = idx + q.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    }
    return marks;
  }
  destroy() {
    this.el.remove();
    this.detailEl.remove();
    this.detailCmp?.unload();
  }
};
function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
var AtMentionPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.index = new SearchIndex();
    this.popup = null;
    this.kbView = null;
    this.pending = /* @__PURE__ */ new Set();
  }
  async onload() {
    setTimeout(async () => {
      await this.index.build(this.app.vault);
      const count = this.app.vault.getMarkdownFiles().length;
      this.registerEvent(this.app.vault.on("create", (f) => {
        if (f instanceof import_obsidian.TFile && f.extension === "md") this.index.add(f, this.app.vault);
      }));
      const flush = debounce(() => {
        for (const p of this.pending) {
          const f = this.app.vault.getAbstractFileByPath(p);
          if (f instanceof import_obsidian.TFile) this.index.add(f, this.app.vault);
        }
        this.pending.clear();
      }, 1e3);
      this.registerEvent(this.app.vault.on("modify", (f) => {
        if (f instanceof import_obsidian.TFile && f.extension === "md") {
          this.pending.add(f.path);
          flush();
        }
      }));
      this.registerEvent(this.app.vault.on("delete", (f) => {
        if (f instanceof import_obsidian.TFile) this.index.remove(f.path);
      }));
      this.registerEvent(this.app.vault.on("rename", (f, old) => {
        if (f instanceof import_obsidian.TFile) {
          this.index.remove(old);
          this.index.add(f, this.app.vault);
        }
      }));
      this.registerEvent(this.app.workspace.on("editor-change", (editor) => {
        const view = editor.cm;
        if (!view) return;
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const before = line.text.slice(0, pos - line.from);
        const match = before.match(AT_RE);
        if (!match) {
          this.popup?.hide();
          this.dismissed = false;
          return;
        }
        if (this.dismissed) return;
        const query = match[1], from = pos - query.length - 1;
        if (!this.popup) {
          this.popup = new Popup(this.index, this.app);
        }
        if (this.kbView !== view) {
          this.kbView = view;
          this.registerKb(view);
        }
        this.popup.show(view, from, query);
      }));
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.popup?.hide()));
      this.registerDomEvent(document, "mousedown", (e) => {
        if (!this.popup?.visible) return;
        const t = e.target;
        if (!this.popup.el.contains(t) && !this.popup.detailEl.contains(t)) {
          this.popup.hide();
          this.dismissed = true;
        }
      });
    }, 100);
  }
  registerKb(view) {
    let composing = false;
    view.dom.addEventListener("compositionstart", () => {
      composing = true;
    });
    view.dom.addEventListener("compositionend", () => {
      composing = false;
    });
    view.dom.addEventListener("keydown", (e) => {
      if (!this.popup?.visible) return;
      if (e.key === "Enter" && composing) return;
      switch (true) {
        case (e.key === "ArrowDown" || e.ctrlKey && e.key === "n"):
          e.preventDefault();
          e.stopPropagation();
          this.popup.move(1);
          break;
        case (e.key === "ArrowUp" || e.ctrlKey && e.key === "p"):
          e.preventDefault();
          e.stopPropagation();
          this.popup.move(-1);
          break;
        case e.key === "Enter":
          e.preventDefault();
          e.stopPropagation();
          this.popup.accept();
          break;
        case e.key === "Escape":
          e.preventDefault();
          this.popup.hide();
          this.dismissed = true;
          break;
      }
    }, true);
  }
  onunload() {
    this.popup?.destroy();
  }
};
