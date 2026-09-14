/* WalkieChat.jsx — Walkie-Talkie ki likhi hui baat-cheet.
 *
 * KYUN ALAG FILE
 * --------------
 * `WalkieTalkie.jsx` pehle hi ~700 line ka hai aur usme apna `<style>` block
 * hai.  Chat ka poora UI wahan daalne se wo file padhne laayak na rehti,
 * isliye yahan — aur styles inline, taaki us page ke CSS se koi takraav na ho.
 *
 * SERVER PAR BOJH KYUN NAHI
 * -------------------------
 * Bhejna USI socket par hota hai jo poori app ke liye pehle se khula hai
 * (`walkieLink`) — koi polling nahi, koi naya connection nahi.  Ek message
 * ~200 byte ka hai; wahi socket bolte waqt 256 kbps dhoti hai.  HTTP sirf
 * teen jagah lagta hai: list kholna, purani baat padhna, aur "padh liya"
 * likhna — teeno TAB DABANE PAR, apne aap kabhi nahi.
 *
 * Socket toota ho to bhejna REST par gir jaata hai (`POST /api/walkie/chat`)
 * — wahi raasta jo phone ke notification se jawab dete waqt Java ki service
 * istemal karti hai.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { walkieLink } from "../constants/walkieLink";

const fmtT = (s) => {
  if (!s) return "";
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d)) return String(s).slice(0, 16);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const S = {
  card:  { background:"#fff", border:"1px solid #e2e8f0", borderRadius:12 },
  row:   { display:"flex", alignItems:"center", gap:10, padding:"11px 13px",
           borderBottom:"1px solid #f1f5f9", cursor:"pointer", textAlign:"left",
           background:"none", border:"none", width:"100%", font:"inherit" },
  dot:   { width:8, height:8, borderRadius:99, flex:"0 0 auto" },
  badge: { marginLeft:"auto", minWidth:20, height:20, borderRadius:99, background:"#dc2626",
           color:"#fff", fontSize:11, fontWeight:800, display:"flex", alignItems:"center",
           justifyContent:"center", padding:"0 6px", flex:"0 0 auto" },
  input: { flex:1, minWidth:0, padding:"10px 12px", borderRadius:9, border:"1px solid #cbd5e1",
           fontSize:13.5, fontFamily:"inherit", background:"#fff" },
  send:  { padding:"10px 16px", borderRadius:9, border:"none", background:"#1e40af",
           color:"#fff", fontWeight:800, fontSize:13, cursor:"pointer", flex:"0 0 auto" },
  back:  { display:"flex", alignItems:"center", gap:6, background:"none", border:"none",
           color:"#475569", fontWeight:700, fontSize:13, cursor:"pointer", padding:"4px 0" },
  sel:   { padding:"8px 10px", borderRadius:8, border:"1px solid #cbd5e1", fontSize:13,
           fontWeight:600, background:"#fff", fontFamily:"inherit", minWidth:150 },
  lbl:   { fontSize:10.5, fontWeight:800, color:"#64748b", marginBottom:4,
           textTransform:"uppercase", letterSpacing:".04em" },
};

/** Ek message ka gubbara.  Apna message daayein, doosre ka baayein.
 *  `palto` diya ho to baayein ek tick ka dabba bhi (sirf admin ke parde me). */
function Bubble({ m, mera, group, chuna, palto }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:8,
                  justifyContent: mera ? "flex-end" : "flex-start", marginBottom:8 }}>
      {palto && (
        <input type="checkbox" checked={!!chuna} onChange={() => palto(m.id)}
               style={{ marginTop:10, flex:"0 0 auto" }} />
      )}
      <div style={{ maxWidth:"78%", padding:"8px 11px", borderRadius:12,
                    background: mera ? "#1e40af" : "#f1f5f9",
                    color: mera ? "#fff" : "#0f172a",
                    borderTopRightRadius: mera ? 3 : 12,
                    borderTopLeftRadius:  mera ? 12 : 3 }}>
        {/* Group me "kisne likha" batana zaroori hai; do bande ki baat me nahi. */}
        {!mera && group && (
          <div style={{ fontSize:10.5, fontWeight:800, color:"#64748b", marginBottom:2 }}>
            {m.from?.name || "—"}
          </div>
        )}
        <div style={{ fontSize:13.5, lineHeight:1.45, whiteSpace:"pre-wrap",
                      overflowWrap:"anywhere" }}>{m.body}</div>
        <div style={{ fontSize:10, marginTop:3, textAlign:"right",
                      color: mera ? "rgba(255,255,255,.75)" : "#94a3b8" }}>
          {palto ? `#${m.id} \u00b7 ` : ""}{fmtT(m.at)}
        </div>
      </div>
    </div>
  );
}

/** Sirf padhne wali baat-cheet (admin ke parde me `send` nahi hota). */
function Thread({ msgs, meId, group, khali, chune, palto }) {
  const neeche = useRef(null);
  useEffect(() => { neeche.current?.scrollIntoView({ block:"nearest" }); }, [msgs]);
  if (!msgs.length) {
    return <div style={{ padding:"30px 14px", textAlign:"center", color:"#94a3b8", fontSize:13 }}>{khali}</div>;
  }
  return (
    <div style={{ maxHeight:"52vh", overflowY:"auto", padding:"12px 13px" }}>
      {msgs.map((m) => (
        <Bubble key={m.id} m={m} mera={Number(m.from?.id) === Number(meId)} group={group}
                chuna={chune ? chune.has(m.id) : false} palto={palto} />
      ))}
      <div ref={neeche} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CHAT — apni baat-cheet
   ══════════════════════════════════════════════════════════════════ */
export function WalkieChatTab({ token, meId }) {
  const [threads, setThreads] = useState([]);
  const [khula, setKhula]     = useState(null);   // {convo, with:{type,id,name}}
  const [msgs, setMsgs]       = useState([]);
  const [likha, setLikha]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState("");

  const loadThreads = useCallback(() => {
    if (!token) return;
    api.get("/api/walkie/chat/threads", token)
      .then((d) => setThreads(Array.isArray(d?.threads) ? d.threads : []))
      .catch((e) => setErr(String(e?.message || e)));
  }, [token]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  /* "Yahan tak padh liya" — sirf tab likhte hain jab sach me kuch naya
     aaya ho.  Warna har baar thread kholne par ek bekaar POST jaata. */
  const padhLiya = useCallback((convo, lastId) => {
    if (!convo || !lastId) return;
    api.post("/api/walkie/chat/read", { convo, last_id: lastId }, token)
       .then(() => setThreads((t) => t.map((x) => x.convo === convo ? { ...x, unread:0 } : x)))
       .catch(() => {});
  }, [token]);

  const kholo = useCallback((t) => {
    setKhula(t); setMsgs([]); setErr(""); setBusy(true);
    const q = t.with.type === "channel" ? `channel=${t.with.id}` : `with=${t.with.id}`;
    api.get(`/api/walkie/chat?${q}`, token)
      .then((d) => {
        const list = Array.isArray(d?.messages) ? d.messages : [];
        setMsgs(list);
        if (list.length) padhLiya(t.convo, list[list.length - 1].id);
      })
      .catch((e) => setErr(String(e?.message || e)))
      .finally(() => setBusy(false));
  }, [token, padhLiya]);

  /* ── Naya message: usi socket se jo pehle se khula hai ──────────
     Server har aane wale message ko BHEJNE WALE ko bhi lautata hai, isliye
     apna bheja hua bhi yahin se aata hai — page ko alag se "optimistic"
     qatar banane ki zaroorat hi nahi, aur do baar dikhne ka sawaal nahi. */
  useEffect(() => {
    return walkieLink.on((d) => {
      // Admin ne kuch hataya -- khuli hui baat-cheet se abhi nikal do, warna
      // page refresh hone tak hatayi hui baat saamne padi rehti hai.
      if (d?.t === "chat_del") {
        const gaye = new Set(d.ids || []);
        if (khula && d.convo === khula.convo) setMsgs((old) => old.filter((m) => !gaye.has(m.id)));
        return;
      }
      if (d?.t !== "chat") return;
      if (khula && d.convo === khula.convo) {
        setMsgs((old) => (old.some((m) => m.id === d.id) ? old : [...old, d]));
        if (Number(d.from?.id) !== Number(meId)) padhLiya(d.convo, d.id);
      } else {
        // khuli hui baat-cheet nahi — list me ginti badha do
        setThreads((old) => old.map((t) => t.convo === d.convo
          ? { ...t, last: d, unread: (t.unread || 0) + (Number(d.from?.id) === Number(meId) ? 0 : 1) }
          : t));
      }
    });
  }, [khula, meId, padhLiya]);

  const bhejo = async () => {
    const b = likha.trim();
    if (!b || !khula) return;
    setLikha(""); setErr("");
    const target = { type: khula.with.type, id: khula.with.id };
    // Socket khula ho to wahi — HTTP ka koi kaam nahi.
    if (walkieLink.state.conn === "on" && walkieLink.send({ t:"chat", target, body:b })) return;
    // Socket na ho to REST — message kho na jaye.
    try {
      await api.post("/api/walkie/chat",
        { target_type: target.type, target_id: target.id, body: b }, token);
    } catch (e) {
      setErr(String(e?.message || e)); setLikha(b);
    }
  };

  // ── ek baat-cheet khuli hai ──
  if (khula) {
    const grp = khula.with.type === "channel";
    return (
      <div style={{ ...S.card, overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 13px",
                      borderBottom:"1px solid #e2e8f0", background:"#f8fafc" }}>
          <button style={S.back} onClick={() => { setKhula(null); loadThreads(); }}>← All chats</button>
          <b style={{ fontSize:14 }}>{grp ? "👥 " : ""}{khula.with.name}</b>
        </div>
        {busy
          ? <div style={{ padding:"30px 14px", textAlign:"center", color:"#94a3b8", fontSize:13 }}>Loading…</div>
          : <Thread msgs={msgs} meId={meId} group={grp} khali="No messages yet — say something." />}
        {err && <div style={{ padding:"0 13px 8px", fontSize:12, color:"#b91c1c", fontWeight:700 }}>{err}</div>}
        <div style={{ display:"flex", gap:8, padding:"10px 13px", borderTop:"1px solid #e2e8f0" }}>
          <input style={S.input} value={likha} placeholder="Type a message…"
                 maxLength={1000}
                 onChange={(e) => setLikha(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); bhejo(); } }} />
          <button style={{ ...S.send, background: likha.trim() ? "#1e40af" : "#cbd5e1",
                           cursor: likha.trim() ? "pointer" : "default" }}
                  disabled={!likha.trim()} onClick={bhejo}>Send</button>
        </div>
      </div>
    );
  }

  // ── list ──
  return (
    <div style={{ ...S.card, overflow:"hidden" }}>
      <div style={{ padding:"10px 13px", borderBottom:"1px solid #e2e8f0", background:"#f8fafc",
                    display:"flex", alignItems:"center", gap:10 }}>
        <b style={{ fontSize:14 }}>Chats</b>
        <button style={{ ...S.back, marginLeft:"auto" }} onClick={loadThreads}>↻ Refresh</button>
      </div>
      {err && <div style={{ padding:"8px 13px", fontSize:12, color:"#b91c1c", fontWeight:700 }}>{err}</div>}
      {!threads.length && (
        <div style={{ padding:"30px 14px", textAlign:"center", color:"#94a3b8", fontSize:13 }}>
          Nobody to chat with yet — an administrator adds people to Walkie-Talkie.
        </div>
      )}
      {threads.map((t) => (
        <button key={t.convo} style={S.row} onClick={() => kholo(t)}>
          <span style={{ ...S.dot, background: t.unread ? "#dc2626" : "#cbd5e1" }} />
          <span style={{ minWidth:0 }}>
            <span style={{ display:"block", fontSize:13.5, fontWeight:700, color:"#0f172a" }}>
              {t.with.type === "channel" ? "👥 " : ""}{t.with.name}
            </span>
            <span style={{ display:"block", fontSize:12, color:"#64748b", overflow:"hidden",
                           textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"60vw" }}>
              {t.last ? `${t.last.from?.name || ""}: ${t.last.body}` : "No messages yet"}
            </span>
          </span>
          {!!t.unread && <span style={S.badge}>{t.unread}</span>}
          {!t.unread && t.last && (
            <span style={{ marginLeft:"auto", fontSize:10.5, color:"#94a3b8", flex:"0 0 auto" }}>
              {fmtT(t.last.at)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ALL CHATS — sirf admin.  "Kiski kiske saath" chunkar padho.
   ══════════════════════════════════════════════════════════════════ */
export function WalkieAdminChatTab({ token, people, channels }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ch, setCh] = useState("");
  const [msgs, setMsgs] = useState(null);     // null = abhi kuch poochha hi nahi
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [convo, setConvo] = useState("");
  const [chune, setChune] = useState(() => new Set());
  const [dBusy, setDBusy] = useState(false);
  const [kehna, setKehna] = useState("");

  const sab = useMemo(() => [...people].sort((x, y) => x.name.localeCompare(y.name)), [people]);

  const dekho = async () => {
    setErr(""); setBusy(true); setMsgs(null);
    try {
      const q = ch ? `channel=${ch}` : `a=${a}&b=${b}`;
      const d = await api.get(`/api/walkie/chat/admin?${q}`, token);
      setMsgs(Array.isArray(d?.messages) ? d.messages : []);
      setConvo(d?.convo || "");
      setChune(new Set());
      setKehna("");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally { setBusy(false); }
  };

  const palto = (id) => setChune((purana) => {
    const naya = new Set(purana);
    if (naya.has(id)) naya.delete(id); else naya.add(id);
    return naya;
  });

  /* Mitana wapas nahi aata, isliye dono jagah ek baar poochh lete hain --
     aur ginti saath me, taaki "kitna ja raha hai" saaf rahe. */
  const mitao = async (poori) => {
    const ids = [...chune];
    if (!poori && !ids.length) return;
    const kitne = poori ? (msgs || []).length : ids.length;
    if (!kitne) return;
    const ok = window.confirm(poori
      ? `Delete this entire conversation \u2014 all ${kitne} ${kitne === 1 ? "message" : "messages"}?\n\n` +
        "This cannot be undone. One line will stay in Delete History saying who deleted what."
      : `Delete ${kitne} selected ${kitne === 1 ? "message" : "messages"}?\n\n` +
        "This cannot be undone. One line will stay in Delete History saying who deleted what.");
    if (!ok) return;
    setDBusy(true); setKehna("");
    try {
      const r = await api.post("/api/walkie/chat/delete",
        poori ? { convo } : { ids }, token);
      setKehna(`${r?.deleted ?? 0} deleted.`);
      setChune(new Set());
      // dobara padh lo -- list wahi dikhe jo ab sach me bachi hai
      const q = ch ? `channel=${ch}` : `a=${a}&b=${b}`;
      const d = await api.get(`/api/walkie/chat/admin?${q}`, token);
      setMsgs(Array.isArray(d?.messages) ? d.messages : []);
    } catch (e) {
      setKehna(String(e?.message || e).slice(0, 140));
    } finally { setDBusy(false); }
  };

  const taiyaar = ch ? true : (a && b && a !== b);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ ...S.card, padding:13, display:"flex", gap:12, flexWrap:"wrap",
                    alignItems:"flex-end" }}>
        <div>
          <div style={S.lbl}>Person</div>
          <select style={S.sel} value={a} onChange={(e) => { setA(e.target.value); setCh(""); }}>
            <option value="">— pick —</option>
            {sab.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <div style={S.lbl}>With</div>
          <select style={S.sel} value={b} onChange={(e) => { setB(e.target.value); setCh(""); }}>
            <option value="">— pick —</option>
            {sab.filter((p) => String(p.id) !== String(a))
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {/* Group ki baat-cheet — do bande chunne ki jagah seedha group. */}
        {!!channels.length && (
          <div>
            <div style={S.lbl}>…or a group</div>
            <select style={S.sel} value={ch}
                    onChange={(e) => { setCh(e.target.value); setA(""); setB(""); }}>
              <option value="">— pick —</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <button onClick={dekho} disabled={!taiyaar || busy}
                style={{ ...S.send, background: taiyaar && !busy ? "#1e40af" : "#cbd5e1",
                         cursor: taiyaar && !busy ? "pointer" : "default" }}>
          {busy ? "Loading…" : "Show chat"}
        </button>
      </div>

      {err && <div style={{ ...S.card, padding:"10px 13px", fontSize:12.5, color:"#b91c1c",
                            fontWeight:700, borderColor:"#fecaca" }}>{err}</div>}

      {/* ── hatane ki patti ─────────────────────────────
          Do alag kaam, isliye do alag button -- "chune hue" wala tabhi
          jagta hai jab kuch tick ho, aur "poori chat" hamesha alag rehta
          hai taaki ek galat tap me poori baat-cheet na chali jaye. */}
      {msgs !== null && !!msgs.length && (
        <div style={{ ...S.card, padding:"9px 12px", display:"flex", gap:10,
                      alignItems:"center", flexWrap:"wrap",
                      borderColor:"#fecaca", background:"#fffbfb" }}>
          <b style={{ fontSize:12.5, color: chune.size ? "#b91c1c" : "#94a3b8" }}>
            {chune.size} selected
          </b>
          <button onClick={() => mitao(false)} disabled={!chune.size || dBusy}
                  style={{ padding:"7px 13px", borderRadius:8, border:"none",
                           background: chune.size && !dBusy ? "#dc2626" : "#e2e8f0",
                           color: chune.size && !dBusy ? "#fff" : "#94a3b8",
                           fontWeight:800, fontSize:12.5,
                           cursor: chune.size && !dBusy ? "pointer" : "default" }}>
            🗑 Delete selected
          </button>
          {!!chune.size && (
            <button onClick={() => setChune(new Set())}
                    style={{ padding:"7px 11px", borderRadius:8, border:"1px solid #cbd5e1",
                             background:"#fff", color:"#475569", fontWeight:700,
                             fontSize:12.5, cursor:"pointer" }}>Clear</button>
          )}
          <button onClick={() => mitao(true)} disabled={dBusy}
                  style={{ marginLeft:"auto", padding:"7px 13px", borderRadius:8,
                           border:"1px solid #dc2626", background:"#fff", color:"#b91c1c",
                           fontWeight:800, fontSize:12.5,
                           cursor: dBusy ? "default" : "pointer" }}>
            Delete whole chat
          </button>
        </div>
      )}
      {kehna && (
        <div style={{ fontSize:12.5, fontWeight:700, color:"#b91c1c" }}>{kehna}</div>
      )}

      {msgs !== null && (
        <div style={{ ...S.card, overflow:"hidden" }}>
          {/* Admin doosron ki baat padh raha hai -- yahan "mera/uska" ka koi
              matlab nahi, isliye har message par naam dikhate hain (meId = 0). */}
          <Thread msgs={msgs} meId={0} group chune={chune} palto={palto}
                  khali="Nothing has been said between them yet." />
        </div>
      )}

      <div style={{ fontSize:11.5, color:"#94a3b8", lineHeight:1.6 }}>
        Only an administrator can open this. Messages are kept until an administrator
        deletes them. Every deletion leaves one line in Delete History saying who did it,
        which messages went and who had written them — the text itself is not kept there.
      </div>
    </div>
  );
}
