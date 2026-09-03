/* ───────────────────────────────────────────────────────────────────
 * StudyMaterial.jsx — "Study Material" (sidebar, Maintenance section)
 * ───────────────────────────────────────────────────────────────────
 * Maintenance ki padhai ka saamaan — MTTR / MTBF / LTTR / KPI / Breakdown /
 * PM / DMC / ANDON / CAPA sab ek jagah, taaki naya banda padh kar samajh sake.
 *
 * Left me category ke hisaab se topic ki list, right me us topic ka matter.
 *
 * ADMIN ke liye: naya topic jodo, kisi bhi topic ki HEADING ya MATTER badlo,
 * category badlo, kram badlo, ya topic hata do.  Baaki sab sirf padh sakte
 * hain (backend par bhi wahi rok hai — non-admin ko 403 milta hai).
 *
 * Saara content DB me hai (maintenance_study_material), code me nahi — isliye
 * kal naya point jodna ho to sirf is page se jud jayega, deploy nahi chahiye.
 *
 * Routing: /maintenance-study-material
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async send(path, token, method, body) {
    const r = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  },
};

const BLANK = { category: "Basics", title: "", body: "", body_hi: "", sort_order: 0, active: true };

export default function StudyMaterial() {
  const { token, theme, user, isAdmin } = useAuth();
  const nav = useNavigate();

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickId, setPickId]   = useState(null);
  const [msg, setMsg]         = useState("");
  const [q, setQ]             = useState("");
  // Zubaan ka chunav yaad rehta hai (per-browser), taaki har baar dobara
  // na chunna pade.  localStorage na chale to chup-chaap English par.
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("sm_lang") === "hi" ? "hi" : "en"; }
    catch { return "en"; }
  });
  const pickLang = (v) => {
    setLang(v);
    try { localStorage.setItem("sm_lang", v); } catch { /* private mode */ }
  };
  // Hindi chuni ho par us topic ka Hindi matter na ho to English dikhate
  // hain — khali page dikhane se behtar hai, aur neeche note bhi de dete hain.
  const bodyOf = (r) => (lang === "hi" ? (r?.body_hi || r?.body) : r?.body) || "";
  const hiMissing = (r) => lang === "hi" && !(r?.body_hi || "").trim();

  // edit ka roop: null = band, {…} = form khula (id ho to edit, na ho to naya)
  const [form, setForm]   = useState(null);
  const [saving, setSaving] = useState(false);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2600); };

  // ── translate ──────────────────────────────────────────────────────────
  // Admin ek zubaan me likh kar doosri bana sakta hai.  Backend jaanch karta
  // hai (script sahi hai? PLC/24V jaise naam bache? lambai theek?) aur shak
  // hone par 422 lauta deta hai — isliye yahan galat matter chup-chaap box me
  // nahi bhar sakta.  Bharne ke baad bhi admin ko padhne ko kehte hain, kyunki
  // ye matter mahinon padha jaayega.
  const [translating, setTranslating] = useState("");   // "hi" | "en" | ""
  const doTranslate = async (to) => {
    const src = (to === "hi" ? form.body : form.body_hi) || "";
    if (!src.trim()) {
      flash(to === "hi" ? "Write the English text first" : "Write the Hindi text first");
      return;
    }
    setTranslating(to);
    try {
      const r = await api.send("/api/study-material/translate", token, "POST",
                               { text: src, to });
      setForm((f) => (to === "hi" ? { ...f, body_hi: r.text } : { ...f, body: r.text }));
      flash("Translated — please read it once before saving");
    } catch (e) {
      let m = String(e?.message || "");
      try { m = JSON.parse(m).detail || m; } catch { /* plain text aaya */ }
      flash("Translation failed — " + m);
    } finally {
      setTranslating("");
    }
  };

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      // admin ko band (inactive) topic bhi dikhein, taaki wapas chalu kar sake
      const d = await api.get(`/api/study-material/?include_inactive=${isAdmin ? "true" : "false"}`, token);
      const list = Array.isArray(d) ? d : [];
      setRows(list);
      setPickId((cur) => (cur && list.some((r) => r.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token, isAdmin]);   // eslint-disable-line react-hooks/exhaustive-deps

  // dhoondhne par heading AUR matter dono me dekhte hain — aksar yaad heading
  // nahi rehti, ek shabd yaad rehta hai
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      String(r.title || "").toLowerCase().includes(s) ||
      String(r.body || "").toLowerCase().includes(s) ||
      String(r.body_hi || "").toLowerCase().includes(s) ||
      String(r.category || "").toLowerCase().includes(s));
  }, [rows, q]);

  // category ke hisaab se guch, kram wahi jo sort_order se aaya
  const groups = useMemo(() => {
    const g = [];
    shown.forEach((r) => {
      const c = r.category || "General";
      let bucket = g.find((x) => x.cat === c);
      if (!bucket) { bucket = { cat: c, items: [] }; g.push(bucket); }
      bucket.items.push(r);
    });
    return g;
  }, [shown]);

  // Kaunsi category khuli hai.  Default: SIRF wahi jisme abhi chuna hua topic
  // hai — 61 topic ki poori flat list bahut lambi ho jaati thi.  Baaki band.
  const [openCats, setOpenCats] = useState(() => new Set());
  const toggleCat = (c) => setOpenCats((prev) => {
    const n = new Set(prev);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });
  // Chuna hua topic jis category me hai, wo apne aap khul jaye (search se ya
  // pehli baar aane par bhi) — warna user ko dikhta hai ki kuch chuna hua hai
  // par list me wo mil hi nahi raha.
  useEffect(() => {
    const cur = rows.find((r) => r.id === pickId);
    if (cur?.category) setOpenCats((prev) => (prev.has(cur.category) ? prev : new Set(prev).add(cur.category)));
  }, [pickId, rows]);

  const cats = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category || "General"))).sort(),
    [rows]);

  const pick = rows.find((r) => r.id === pickId) || null;

  const save = async () => {
    if (!form?.title?.trim()) { flash("Heading is required"); return; }
    setSaving(true);
    try {
      const body = {
        category:   (form.category || "General").trim(),
        title:      form.title.trim(),
        body:       form.body || "",
        body_hi:    form.body_hi || "",
        sort_order: Number(form.sort_order) || 0,
        active:     form.active !== false,
      };
      const saved = form.id
        ? await api.send(`/api/study-material/${form.id}`, token, "PUT", body)
        : await api.send(`/api/study-material/`, token, "POST", body);
      setForm(null);
      await load();
      if (saved?.id) setPickId(saved.id);
      flash(form.id ? "Topic updated" : "New topic added");
    } catch (e) {
      flash(String(e.message || e).slice(0, 120));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`"${r.title}" will be deleted. This cannot be undone.`)) return;
    try {
      await api.send(`/api/study-material/${r.id}`, token, "DELETE");
      await load();
      flash("Topic deleted");
    } catch (e) {
      flash(String(e.message || e).slice(0, 120));
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .sm-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .sm-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .sm-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .sm-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .sm-title span { color:${theme.accent}; }
        .sm-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .sm-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .sm-wrap { max-width:1400px; margin:18px auto 0; padding:0 22px; display:flex; gap:18px; align-items:flex-start; }
        .sm-side { flex:0 0 320px; background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); overflow:hidden; }
        .sm-search { width:100%; border:none; border-bottom:1px solid #e2e8f0; outline:none; padding:12px 16px;
                     font-size:13px; font-family:'Barlow',sans-serif; color:#0f172a; box-sizing:border-box; }
        .sm-cat { font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:#94a3b8;
                  padding:12px 16px 5px; }
        .sm-cat-btn { display:flex; align-items:center; gap:8px; width:100%; text-align:left;
                      border:none; background:none; cursor:pointer; font-family:'Barlow',sans-serif;
                      padding:11px 16px 8px; }
        .sm-cat-btn:hover { color:#475569; background:#f8fafc; }
        .sm-cat-btn.open { color:#64748b; }
        .sm-cat-arrow { font-size:9px; width:9px; flex:0 0 auto; }
        .sm-cat-name { flex:1 1 auto; }
        .sm-cat-n { flex:0 0 auto; background:#e2e8f0; color:#475569; border-radius:99px;
                    padding:1px 7px; font-size:10px; font-weight:800; letter-spacing:0; }
        .sm-item { display:block; width:100%; text-align:left; border:none; background:none; cursor:pointer;
                   padding:9px 16px; font-size:13px; font-weight:600; color:#334155; font-family:'Barlow',sans-serif;
                   border-left:3px solid transparent; }
        .sm-item:hover { background:#f8fafc; }
        .sm-item.on { background:#f1f5f9; border-left-color:${theme.accent}; color:#0f172a; font-weight:800; }
        .sm-off { opacity:.45; font-style:italic; }
        .sm-main { flex:1 1 0; min-width:0; background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); padding:26px 30px; }
        .sm-h { font-family:'Barlow Condensed',sans-serif; font-size:27px; font-weight:800; color:#0f172a; margin:0; }
        .sm-chip { display:inline-block; font-size:9.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
                   color:#3730a3; background:#e0e7ff; border-radius:99px; padding:3px 11px; margin-bottom:8px; }
        .sm-body { white-space:pre-wrap; font-size:14.5px; line-height:1.75; color:#334155; margin-top:14px; }
        .sm-meta { margin-top:22px; padding-top:12px; border-top:1px dashed #e2e8f0; font-size:11px; color:#94a3b8; }
        .sm-btn { border:none; border-radius:9px; padding:9px 18px; font-size:13px; font-weight:800; cursor:pointer;
                  font-family:'Barlow',sans-serif; background:${theme.accent}; color:#fff; }
        .sm-btn.gh { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
        .sm-btn.dz { background:#fee2e2; color:#dc2626; border:1px solid #fecaca; }
        .sm-fld { display:flex; flex-direction:column; gap:5px; }
        .sm-lbl { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .sm-in { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                 color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; box-sizing:border-box; }
        .sm-ta { min-height:340px; resize:vertical; line-height:1.7; font-weight:500; }
        .sm-flash { position:fixed; left:50%; transform:translateX(-50%); bottom:26px; z-index:9000;
                    background:#0f172a; color:#fff; padding:10px 20px; border-radius:10px; font-size:13px;
                    font-weight:700; box-shadow:0 10px 30px rgba(0,0,0,.25); }
        .sm-empty { padding:40px 10px; text-align:center; color:#94a3b8; font-size:13.5px; }
        /* Zubaan ka switch — har page par upar, taaki jo jis zubaan me
           padhna chahe wo ek click me badal le. */
        .sm-lbl-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .sm-tr { border:1.5px solid #cbd5e1; background:#fff; color:#475569; cursor:pointer;
                 border-radius:99px; padding:3px 12px; font-size:11.5px; font-weight:800;
                 font-family:inherit; white-space:nowrap; }
        .sm-tr:hover:not(:disabled) { border-color:#94a3b8; color:#0f172a; }
        .sm-tr:disabled { opacity:.55; cursor:default; }
        .sm-lang { display:inline-flex; border:1.5px solid #cbd5e1; border-radius:99px; overflow:hidden; }
        .sm-lang button { border:none; background:#fff; color:#64748b; cursor:pointer; padding:6px 16px;
                          font-size:12.5px; font-weight:800; font-family:'Barlow',sans-serif; }
        .sm-lang button.on { background:${theme.accent}; color:#fff; }
        .sm-note { margin-top:10px; font-size:11.5px; font-weight:700; color:#92400e;
                   background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:7px 12px; }
      `}</style>

      <div className="sm-root">
        <div className="sm-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="sm-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="sm-title">Study <span>Material</span></div>
              <div className="sm-sub">
                Maintenance concepts — MTTR, MTBF, LTTR, KPI, Breakdown, PM, DMC, ANDON, CAPA
              </div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div className="sm-lang">
              <button className={lang === "en" ? "on" : ""} onClick={() => pickLang("en")}>English</button>
              <button className={lang === "hi" ? "on" : ""} onClick={() => pickLang("hi")}>हिंदी</button>
            </div>
            {isAdmin && !form && (
              <button className="sm-btn" onClick={() => setForm({ ...BLANK })}>＋ Add Topic</button>
            )}
            {user?.username && (
              <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>
            )}
          </div>
        </div>

        <div className="sm-wrap">
          {/* ── left: topic list ── */}
          <div className="sm-side">
            <input className="sm-search" placeholder="Search topic or text…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
            {loading && <div className="sm-empty">Loading…</div>}
            {!loading && shown.length === 0 && (
              <div className="sm-empty">{rows.length ? "No matches found." : "No topics yet."}</div>
            )}
            {!loading && groups.map((g) => {
              // Search chalu ho to sab khula rakho — warna nateeje band
              // category ke andar chhup jaate aur "kuch mila hi nahi" lagta.
              const open = !!q.trim() || openCats.has(g.cat);
              return (
                <div key={g.cat}>
                  <button className={"sm-cat sm-cat-btn" + (open ? " open" : "")}
                          onClick={() => toggleCat(g.cat)}
                          title={open ? "Collapse" : "Expand"}>
                    <span className="sm-cat-arrow">{open ? "▾" : "▸"}</span>
                    <span className="sm-cat-name">{g.cat}</span>
                    <span className="sm-cat-n">{g.items.length}</span>
                  </button>
                  {open && g.items.map((r) => (
                    <button key={r.id}
                            className={"sm-item" + (r.id === pickId ? " on" : "") + (r.active === false ? " sm-off" : "")}
                            onClick={() => { setPickId(r.id); setForm(null); }}>
                      {r.title}{r.active === false ? "  (hidden)" : ""}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {/* ── right: matter, ya admin ka form ── */}
          <div className="sm-main">
            {form ? (
              <>
                <h2 className="sm-h">{form.id ? "Edit Topic" : "New Topic"}</h2>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:16 }}>
                  <div className="sm-fld" style={{ flex:"1 1 200px" }}>
                    <label className="sm-lbl">Category</label>
                    <input className="sm-in" list="sm-cats" value={form.category}
                           onChange={(e) => setForm({ ...form, category: e.target.value })} />
                    <datalist id="sm-cats">
                      {cats.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <div className="sm-fld" style={{ flex:"3 1 340px" }}>
                    <label className="sm-lbl">Heading</label>
                    <input className="sm-in" value={form.title}
                           onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div className="sm-fld" style={{ flex:"0 0 110px" }}>
                    <label className="sm-lbl">Order</label>
                    <input className="sm-in" type="number" value={form.sort_order ?? 0}
                           onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
                  </div>
                </div>

                {/* Dono zubaan alag-alag — Hindi khali chhod di to us topic par
                    English hi dikhega (aur padhne wale ko note mil jayega). */}
                <div className="sm-fld" style={{ marginTop:14 }}>
                  <div className="sm-lbl-row">
                    <label className="sm-lbl">Matter — English</label>
                    <button type="button" className="sm-tr" disabled={!!translating}
                            onClick={() => doTranslate("hi")}
                            title="Translate English to Hindi">
                      {translating === "hi" ? "बन रहा है…" : "→ हिंदी बनाओ"}
                    </button>
                  </div>
                  <textarea className="sm-in sm-ta" value={form.body || ""}
                            placeholder="Write the full explanation here.  A blank line starts a new paragraph."
                            onChange={(e) => setForm({ ...form, body: e.target.value })} />
                </div>

                <div className="sm-fld" style={{ marginTop:14 }}>
                  <div className="sm-lbl-row">
                    <label className="sm-lbl">Matter — हिंदी</label>
                    <button type="button" className="sm-tr" disabled={!!translating}
                            onClick={() => doTranslate("en")}
                            title="Translate Hindi to English">
                      {translating === "en" ? "Making…" : "→ Make English"}
                    </button>
                  </div>
                  <textarea className="sm-in sm-ta" value={form.body_hi || ""}
                            placeholder="Write the Hindi version here. Leave it blank and this topic will show in English."
                            onChange={(e) => setForm({ ...form, body_hi: e.target.value })} />
                </div>

                <label style={{ display:"flex", alignItems:"center", gap:8, marginTop:14,
                                fontSize:13, fontWeight:700, color:"#475569" }}>
                  <input type="checkbox" checked={form.active !== false}
                         onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Visible to everyone (uncheck to show to admins only)
                </label>

                <div style={{ display:"flex", gap:10, marginTop:20 }}>
                  <button className="sm-btn" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button className="sm-btn gh" onClick={() => setForm(null)}>Cancel</button>
                </div>
              </>
            ) : !pick ? (
              <div className="sm-empty">
                {loading ? "Loading…" : "Select a topic from the left."}
              </div>
            ) : (
              <>
                <div className="sm-chip">{pick.category || "General"}</div>
                <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
                  <h2 className="sm-h" style={{ flex:1 }}>{pick.title}</h2>
                  {isAdmin && (
                    <div style={{ display:"flex", gap:8, flex:"0 0 auto" }}>
                      <button className="sm-btn gh" onClick={() => setForm({ ...pick })}>✎ Edit</button>
                      <button className="sm-btn dz" onClick={() => remove(pick)}>🗑</button>
                    </div>
                  )}
                </div>
                <div className="sm-body">{bodyOf(pick) || "—"}</div>
                {hiMissing(pick) && (
                  <div className="sm-note">
                    इस टॉपिक का हिंदी अनुवाद अभी नहीं है — फ़िलहाल English दिखाया जा रहा है।
                  </div>
                )}
                <div className="sm-meta">
                  Last updated by {pick.updated_by || "—"}
                  {pick.updated_at ? ` · ${String(pick.updated_at).slice(0, 10)}` : ""}
                  {pick.active === false ? "  · HIDDEN (visible to admins only)" : ""}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {msg && <div className="sm-flash">{msg}</div>}
    </>
  );
}
