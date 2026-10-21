(() => {
  "use strict";

  const BIZ = window.BUSINESSES;
  const BUILTIN = window.PROMPTS;
  const ALL = "ทั้งหมด";
  const FAV = "★ ที่ชอบ";
  const MINE = "ของฉัน";
  const MAX_URL_PROMPT = 7000; // encoded chars; longer prompts are copied instead

  /* ---------- storage (may be unavailable) ---------- */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("pa." + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("pa." + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
    del(key) {
      try { localStorage.removeItem("pa." + key); } catch { /* ignore */ }
    }
  };

  const state = {
    biz: store.get("biz", BIZ[0].id),
    cat: ALL,
    q: "",
    favs: new Set(store.get("favs", [])),
    custom: store.get("custom", []),
    current: null,
    values: {}
  };
  if (!BIZ.some(b => b.id === state.biz)) state.biz = BIZ[0].id;

  const $ = id => document.getElementById(id);
  const bizOf = id => BIZ.find(b => b.id === id);
  const allPrompts = () => BUILTIN.concat(state.custom);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- profile ---------- */
  function profileValues(bizId) {
    const saved = store.get("profile." + bizId, {});
    const out = {};
    for (const f of bizOf(bizId).profile) {
      out[f.key] = saved[f.key] != null ? saved[f.key] : (f.value || "");
    }
    return out;
  }
  function profileBlock(bizId) {
    const vals = profileValues(bizId);
    const lines = Object.entries(vals).filter(([, v]) => v.trim()).map(([k, v]) => `- ${k}: ${v.trim()}`);
    return lines.length ? "ข้อมูลพื้นฐาน:\n" + lines.join("\n") : "";
  }

  /* ---------- template parsing ---------- */
  const VAR_RE = /\{\{\s*([^{}:]+?)\s*(?::([^{}]*))?\}\}/g;
  const LONG_RE = /ข้อมูล|รายละเอียด|ข้อความ|รายการ|ลิสต์|โค้ด|error|log|สูตร|โครงสร้าง|โน้ต|ออเดอร์|คอมเมนต์|สเปก|เมนู|วัตถุดิบ|ขั้นตอน|สรุป|ตัวอย่าง|ผลลัพธ์|requirement/i;

  function parseVars(text) {
    const vars = [];
    const seen = new Set();
    for (const m of text.matchAll(VAR_RE)) {
      const name = m[1].trim();
      if (name === "@profile" || seen.has(name)) continue;
      seen.add(name);
      const raw = m[2] == null ? "" : m[2];
      const options = raw.includes("|") ? raw.split("|").map(s => s.trim()).filter(Boolean) : null;
      // "{{name:}}" (explicit empty default) marks an optional field
      vars.push({ name, def: options ? options[0] : raw.trim(), options, optional: m[2] === "" });
    }
    return vars;
  }

  function resolve(p, vals) {
    const prof = profileValues(p.biz);
    return name => {
      if (vals[name] != null && vals[name] !== "") return vals[name];
      if (prof[name]) return prof[name];
      return null;
    };
  }

  function build(p, vals, asHtml) {
    const get = resolve(p, vals);
    const vars = Object.fromEntries(parseVars(p.prompt).map(v => [v.name, v]));
    const missing = [];
    const parts = [];
    let last = 0;
    for (const m of p.prompt.matchAll(VAR_RE)) {
      parts.push(asHtml ? esc(p.prompt.slice(last, m.index)) : p.prompt.slice(last, m.index));
      last = m.index + m[0].length;
      const name = m[1].trim();
      if (name === "@profile") {
        const block = profileBlock(p.biz);
        parts.push(asHtml ? (block ? `<mark>${esc(block)}</mark>` : "") : block);
        continue;
      }
      let v = get(name);
      if (v == null) v = vars[name] ? vars[name].def : "";
      if (v === "" && vars[name] && vars[name].optional) {
        parts.push("-");
      } else if (v === "") {
        if (!missing.includes(name)) missing.push(name);
        parts.push(asHtml ? `<mark class="miss">[${esc(name)}]</mark>` : `[${name}]`);
      } else {
        parts.push(asHtml ? `<mark>${esc(v)}</mark>` : v);
      }
    }
    parts.push(asHtml ? esc(p.prompt.slice(last)) : p.prompt.slice(last));
    const text = parts.join("").replace(/\n{3,}/g, "\n\n").trim();
    return { text, missing };
  }

  /* ---------- rendering ---------- */
  function applyAccent() {
    const b = bizOf(state.biz);
    document.documentElement.style.setProperty("--accent", b.color);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", b.color);
  }

  function renderTabs() {
    $("bizTabs").innerHTML = BIZ.map(b => {
      const n = allPrompts().filter(p => p.biz === b.id).length;
      return `<button class="biz" role="tab" style="--c:${b.color}" data-biz="${b.id}" aria-selected="${b.id === state.biz}">
        <span class="em">${b.emoji}</span>
        <span><b>${esc(b.name)}</b><small>${esc(b.tagline)} · ${n}</small></span>
      </button>`;
    }).join("");
  }

  function bizPrompts() {
    return allPrompts().filter(p => p.biz === state.biz);
  }

  function renderChips() {
    const list = bizPrompts();
    const cats = [];
    for (const p of list) if (!cats.includes(p.cat)) cats.push(p.cat);
    const chips = [[ALL, list.length]];
    const favN = list.filter(p => state.favs.has(p.id)).length;
    if (favN) chips.push([FAV, favN]);
    for (const c of cats) chips.push([c, list.filter(p => p.cat === c).length]);
    const mineN = list.filter(p => p.custom).length;
    if (mineN) chips.push([MINE, mineN]);
    if (!chips.some(([c]) => c === state.cat)) state.cat = ALL;
    $("chips").innerHTML = chips.map(([c, n]) =>
      `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === state.cat}">${esc(c)}<span class="n">${n}</span></button>`
    ).join("");
    $("catList").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  }

  function renderGrid() {
    const q = state.q.trim().toLowerCase();
    let list = bizPrompts();
    if (state.cat === FAV) list = list.filter(p => state.favs.has(p.id));
    else if (state.cat === MINE) list = list.filter(p => p.custom);
    else if (state.cat !== ALL) list = list.filter(p => p.cat === state.cat);
    if (q) list = list.filter(p => (p.title + " " + p.desc + " " + p.cat + " " + p.prompt).toLowerCase().includes(q));
    $("grid").innerHTML = list.map(p => `
      <button class="card" data-id="${esc(p.id)}">
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.desc || "")}</p>
        <div class="meta"><span class="tag">${esc(p.cat)}</span>${state.favs.has(p.id) ? '<span class="star">★</span>' : ""}</div>
      </button>`).join("");
    $("empty").hidden = list.length > 0;
  }

  function renderAll() {
    applyAccent();
    renderTabs();
    renderChips();
    renderGrid();
  }

  /* ---------- detail ---------- */
  function fieldHtml(v, value, fromProfile) {
    const id = "f_" + encodeURIComponent(v.name);
    const note = fromProfile ? " <em>(จากข้อมูลงาน)</em>" : v.optional ? " <em>(ไม่บังคับ)</em>" : "";
    let control;
    if (v.options) {
      const opts = v.options.map(o => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("");
      control = `<select id="${id}" data-var="${esc(v.name)}">${opts}</select>`;
    } else if (LONG_RE.test(v.name)) {
      control = `<textarea id="${id}" data-var="${esc(v.name)}" rows="3" placeholder="${esc(v.def)}">${esc(value)}</textarea>`;
    } else {
      control = `<input id="${id}" data-var="${esc(v.name)}" value="${esc(value)}" placeholder="${esc(v.def)}">`;
    }
    return `<label class="field" for="${id}"><span>${esc(v.name)}${note}</span>${control}</label>`;
  }

  function openDetail(id, push = true) {
    const p = allPrompts().find(x => x.id === id);
    if (!p) return;
    if (p.biz !== state.biz) { state.biz = p.biz; store.set("biz", p.biz); renderAll(); }
    state.current = p;
    const saved = store.get("vals." + p.id, {});
    const prof = profileValues(p.biz);
    const vars = parseVars(p.prompt);
    state.values = {};
    for (const v of vars) {
      if (saved[v.name] != null) state.values[v.name] = saved[v.name];
      else if (v.options) state.values[v.name] = v.def;
      else if (prof[v.name]) state.values[v.name] = prof[v.name];
      else state.values[v.name] = v.def;
    }
    $("dCat").textContent = p.cat;
    $("dTitle").textContent = p.title;
    $("dDesc").textContent = p.desc || "";
    $("dFields").innerHTML = vars.length
      ? vars.map(v => fieldHtml(v, state.values[v.name], !!prof[v.name] && saved[v.name] == null)).join("")
      : `<p class="no-fields">prompt นี้ไม่ต้องกรอกอะไร กดคัดลอกได้เลย</p>`;
    $("delBtn").hidden = !p.custom;
    updateFav();
    updatePreview();
    if (!$("detail").open) $("detail").showModal();
    if (push) history.replaceState(null, "", `#/${p.biz}/${p.id}`);
  }

  function updatePreview() {
    const p = state.current;
    if (!p) return;
    const { text, missing } = build(p, state.values, true);
    $("dPreview").innerHTML = text;
    $("dMissing").textContent = missing.length ? `ยังไม่กรอก ${missing.length} ช่อง (AI จะถามกลับ)` : "พร้อมใช้ ✓";
  }

  function updateFav() {
    const on = state.current && state.favs.has(state.current.id);
    $("favBtn").textContent = on ? "★" : "☆";
    $("favBtn").title = on ? "เอาออกจากที่ชอบ" : "เพิ่มในที่ชอบ";
  }

  function finalText() {
    return build(state.current, state.values, false).text;
  }

  /* ---------- actions ---------- */
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      (document.querySelector("dialog[open]") || document.body).appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    // keep the toast above an open modal (top layer)
    const host = document.querySelector("dialog[open]") || document.body;
    if (t.parentElement !== host) host.appendChild(t);
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function sendTo(ai) {
    const text = finalText();
    const copied = await copy(text);
    const enc = encodeURIComponent(text);
    const fits = enc.length <= MAX_URL_PROMPT;
    let url;
    if (ai === "chatgpt") url = "https://chatgpt.com/" + (fits ? "?q=" + enc : "");
    else if (ai === "claude") url = "https://claude.ai/new" + (fits ? "?q=" + enc : "");
    else url = "https://gemini.google.com/app";
    window.open(url, "_blank", "noopener");
    if (ai === "gemini" || !fits) toast(copied ? "คัดลอกแล้ว — กด Ctrl+V / วาง ในช่องแชท" : "เปิดแล้ว — คัดลอกไม่สำเร็จ ให้กดปุ่มคัดลอกอีกครั้ง");
    else toast("ส่ง prompt แล้ว (สำรองไว้ในคลิปบอร์ดด้วย)");
  }

  function saveValues() {
    if (state.current) store.set("vals." + state.current.id, state.values);
  }

  /* ---------- profile dialog ---------- */
  function openProfile() {
    const b = bizOf(state.biz);
    const vals = profileValues(b.id);
    $("pBiz").textContent = b.emoji + " " + b.name;
    $("pFields").innerHTML = b.profile.map(f => {
      const id = "p_" + encodeURIComponent(f.key);
      return `<label class="field" for="${id}"><span>${esc(f.key)}</span>
        <input id="${id}" data-key="${esc(f.key)}" value="${esc(vals[f.key])}" placeholder="${esc(f.hint || "")}"></label>`;
    }).join("");
    $("profile").showModal();
  }
  function saveProfile() {
    const out = {};
    $("pFields").querySelectorAll("[data-key]").forEach(el => { out[el.dataset.key] = el.value; });
    store.set("profile." + state.biz, out);
    $("profile").close();
    toast("บันทึกข้อมูลงานแล้ว");
  }

  /* ---------- custom prompts ---------- */
  function openAdder() {
    ["aTitle", "aCat", "aDesc", "aPrompt"].forEach(id => { $(id).value = ""; });
    $("adder").showModal();
    $("aTitle").focus();
  }
  function saveAdder() {
    const title = $("aTitle").value.trim();
    const prompt = $("aPrompt").value.trim();
    if (!title || !prompt) { toast("ใส่ชื่อและ prompt ก่อน"); return; }
    const p = {
      id: "c-" + Date.now().toString(36),
      biz: state.biz,
      cat: $("aCat").value.trim() || "อื่น ๆ",
      title,
      desc: $("aDesc").value.trim(),
      prompt,
      custom: true
    };
    state.custom.push(p);
    store.set("custom", state.custom);
    $("adder").close();
    state.cat = MINE;
    renderAll();
    toast("เพิ่ม prompt แล้ว");
  }
  function deleteCurrent() {
    const p = state.current;
    if (!p || !p.custom) return;
    if (!confirm(`ลบ "${p.title}" ?`)) return;
    state.custom = state.custom.filter(x => x.id !== p.id);
    store.set("custom", state.custom);
    store.del("vals." + p.id);
    $("detail").close();
    renderAll();
  }
  function exportCustom() {
    if (!state.custom.length) { toast("ยังไม่มี prompt ของฉัน"); return; }
    const blob = new Blob([JSON.stringify(state.custom, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prompt-aj-my-prompts.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importCustom(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("not an array");
        let added = 0;
        for (const p of data) {
          if (!p || typeof p.prompt !== "string" || typeof p.title !== "string" || !bizOf(p.biz)) continue;
          const item = { id: String(p.id || "c-" + Math.random().toString(36).slice(2)), biz: p.biz, cat: String(p.cat || "อื่น ๆ"), title: p.title, desc: String(p.desc || ""), prompt: p.prompt, custom: true };
          if (BUILTIN.some(b => b.id === item.id)) item.id = "c-" + Math.random().toString(36).slice(2);
          const i = state.custom.findIndex(x => x.id === item.id);
          if (i >= 0) state.custom[i] = item; else state.custom.push(item);
          added++;
        }
        store.set("custom", state.custom);
        renderAll();
        toast(`นำเข้า ${added} prompt`);
      } catch {
        toast("ไฟล์ไม่ถูกต้อง");
      }
    };
    reader.readAsText(file);
  }

  /* ---------- routing ---------- */
  function fromHash() {
    const [, biz, id] = location.hash.split("/");
    if (biz && bizOf(biz) && biz !== state.biz) {
      state.biz = biz;
      store.set("biz", biz);
      state.cat = ALL;
    }
    renderAll();
    if (id) openDetail(decodeURIComponent(id), false);
  }

  /* ---------- events ---------- */
  $("bizTabs").addEventListener("click", e => {
    const b = e.target.closest("[data-biz]");
    if (!b) return;
    state.biz = b.dataset.biz;
    state.cat = ALL;
    store.set("biz", state.biz);
    history.replaceState(null, "", `#/${state.biz}`);
    renderAll();
  });
  $("chips").addEventListener("click", e => {
    const c = e.target.closest("[data-cat]");
    if (!c) return;
    state.cat = c.dataset.cat;
    renderChips();
    renderGrid();
  });
  $("grid").addEventListener("click", e => {
    const c = e.target.closest("[data-id]");
    if (c) openDetail(c.dataset.id);
  });
  $("q").addEventListener("input", e => { state.q = e.target.value; renderGrid(); });
  $("homeLink").addEventListener("click", e => { e.preventDefault(); state.q = ""; $("q").value = ""; state.cat = ALL; renderAll(); });

  $("dFields").addEventListener("input", e => {
    const el = e.target.closest("[data-var]");
    if (!el) return;
    state.values[el.dataset.var] = el.value;
    saveValues();
    updatePreview();
  });
  $("copyBtn").addEventListener("click", async () => {
    toast((await copy(finalText())) ? "คัดลอกแล้ว ✓" : "คัดลอกไม่สำเร็จ — เลือกข้อความในตัวอย่างแล้วคัดลอกเอง");
  });
  document.querySelectorAll("[data-ai]").forEach(btn => btn.addEventListener("click", () => sendTo(btn.dataset.ai)));
  $("favBtn").addEventListener("click", () => {
    const id = state.current.id;
    if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
    store.set("favs", [...state.favs]);
    updateFav();
    renderChips();
    renderGrid();
  });
  $("shareBtn").addEventListener("click", async () => {
    const url = location.href.split("#")[0] + `#/${state.current.biz}/${state.current.id}`;
    toast((await copy(url)) ? "คัดลอกลิงก์แล้ว ส่งให้ทีมได้เลย" : url);
  });
  $("resetBtn").addEventListener("click", () => {
    store.del("vals." + state.current.id);
    openDetail(state.current.id, false);
  });
  $("delBtn").addEventListener("click", deleteCurrent);
  $("detail").addEventListener("close", () => {
    state.current = null;
    history.replaceState(null, "", `#/${state.biz}`);
  });

  $("profileBtn").addEventListener("click", openProfile);
  $("pSave").addEventListener("click", saveProfile);
  $("addBtn").addEventListener("click", openAdder);
  $("aSave").addEventListener("click", saveAdder);
  $("exportBtn").addEventListener("click", exportCustom);
  $("importFile").addEventListener("change", e => {
    if (e.target.files[0]) importCustom(e.target.files[0]);
    e.target.value = "";
  });
  window.addEventListener("hashchange", fromHash);

  fromHash();
})();
