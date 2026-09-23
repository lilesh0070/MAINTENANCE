/* sheetTools.js — SHEET KA PRINT AUR EXCEL DOWNLOAD, EK HI JAGAH.
 *
 * KYUN EK SAJHA FILE
 * ------------------
 * Print ka button chaar jagah chahiye tha (Historical Data ka PM aur DMC,
 * aur Document Update ka wahi do format-view) aur Excel ka button chaar aur
 * jagah.  Har jagah alag code likhne ka matlab hota aath jagah wahi galtiyan
 * dohrana — isliye dono kaam yahan ek baar likhe hain.
 *
 * SABSE ZAROORI BAAT: APP AUR SITE DONO
 * -------------------------------------
 * Website par `window.print()` aur blob-download dono chalte hain.
 * APK ke andar DONO CHUP-CHAAP MARR JAATE HAIN:
 *
 *   • Android WebView `window.print()` ko laagu hi nahi karta.  Print ka
 *     parda (dialog) browser ka hissa hai, rendering engine ka nahi — to
 *     WebView me button dabta hai aur kuch nahi hota, koi error bhi nahi.
 *   • Blob wala download WebView tab tak nigal jaata hai jab tak Java me
 *     `DownloadListener` na lagaya ho.  Yahan bhi koi error nahi aata.
 *
 * "Koi error nahi aata" hi asli khatra hai — testing me sab theek lagta
 * hai aur plant me button bekaar nikalta hai.  Isliye Java me ek chhota
 * plugin (SheetTools.java) banaya hai jo dono kaam karta hai, aur yahan se
 * PEHLE wahi dhoondha jaata hai:
 *
 *     native pul mila   ->  Android ka apna print / file save
 *     nahi mila         ->  purana browser wala tareeqa
 *
 * Isse teen faayde hain: website jaisi thi waisi chalti rahegi, APK me kaam
 * hone lagega, aur kal ko kisi WebView me print chalne bhi lage to kuch
 * tootega nahi — native pul phir bhi pehle chun liya jayega.
 */

const nativePul = () =>
  (typeof window !== "undefined" ? window.Capacitor?.Plugins?.SheetTools : null) || null;

/* ══════════════════════════════════════════════════════════════════════
   PRINT
   ══════════════════════════════════════════════════════════════════════ */

/* Page ki saari CSS ka TEXT jama karo.
 *
 * Sheet ke component (FormatSheet / DmcSheet) apni border-vagairah inline
 * style me likhte hain, wo to `outerHTML` ke saath khud aa jaati hai.  Par
 * font aur kuch class-based cheezein page ki CSS me hain — unke bina print
 * ka roop badal jaata hai.
 *
 * ⚠ PEHLE YAHAN SIRF `document.querySelectorAll("style")` tha, AUR WO
 * PRODUCTION ME TOOT-TA.  Dev me Vite saari CSS `<style>` tag me thoosta
 * hai, isliye laptop par sab theek dikhta.  BUILD me wahi CSS ek alag
 * file ban jaati hai aur `<link rel=stylesheet>` se aati hai — jise
 * `querySelectorAll("style")` uthata hi nahi.  Natija: plant me print bina
 * CSS ke nikalti, aur laptop par ye galti kabhi dikhti hi nahi.
 *
 * Isliye ab `document.styleSheets` se guzarte hain — usme `<style>` aur
 * `<link>` DONO aate hain — aur unka TEXT nikaal lete hain.  Text isliye
 * (link ki jagah) ki APK ki print-WebView Capacitor ke local server se
 * judi nahi hoti; wahan `<link href="/assets/...">` khulta hi nahi. */
const pageKeStyles = () => {
  // ⚠ `@import` SABSE UPAR HI CHALTA HAI -- CSS ka niyam hai ki wo kisi bhi
  // asli rule ke BAAD aaye to browser use CHUP-CHAAP nazarandaaz kar deta hai.
  //
  // App ka Barlow font ek inline <style> ke andar
  // `@import url('https://fonts.googleapis.com/...Barlow...')` se aata hai.
  // Pehle yahan saari sheets ka text seedha jod diya jaata tha, to wo @import
  // beech me chala jaata aur chhupe iframe me font aata hi NAHI -- naap kar
  // dekha: iframe me font-face ki ginti 0 thi.
  //
  // Nateeja ye tha ki JAGAH to fallback (chaudi) font se tay hoti thi, par
  // html2canvas apna canvas MAIN PAGE me banata hai jahan Barlow (patli)
  // maujood hai -- to har shabd apni jagah se patla chhapta aur uske baad
  // khaali jagah bach jaati.  Kaagaz par yahi "shabd idhar-udhar" dikhta tha:
  // DB me "SS-08 RR. UPPER END CAP CYLINDER NOT WORK." aur PDF me
  // "SS -08 RR . UPPER  END  CAP ...".  Ek hi line ka naap: iframe ka DOM
  // 303.2px, main page ka canvas 264.4px -- 14.7% ka farq.
  //
  // Isliye @import alag chhaan kar SABSE UPAR rakhte hain.
  const aayat = [];
  const tukde = [];
  const jodo = (text) => {
    if (!text) return;
    tukde.push(String(text).replace(/@import\s+[^;]+;/g, (m) => { aayat.push(m); return ""; }));
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try {
      rules = sheet.cssRules;        // doosre origin ki sheet par phenkta hai
    } catch {
      rules = null;
    }
    if (rules) {
      let t = "";
      for (const r of rules) t += r.cssText + "\n";
      jodo(t);
    } else if (sheet.ownerNode?.tagName === "STYLE") {
      // Google Fonts jaisa koi @import andar ho to cssRules mana kar deta
      // hai — aise me tag ka apna text hi le lo.
      jodo(sheet.ownerNode.innerHTML);
    }
  }
  // Ek hi @import kai sheets me ho sakta hai -- dohra bhejne ka fayda nahi.
  return Array.from(new Set(aayat)).join("\n") + "\n" + tukde.join("\n");
};

/* Tasveeron ko HTML ke ANDAR bitha do (data: URI bana kar).
 *
 * KYUN ZAROORI HAI
 * ----------------
 * Sheet me `<img src="/logo.jpg">` hai — ek rishtedaar (relative) rasta.
 * APK me print ke liye ek NAYI WebView banti hai, aur wo Capacitor ke local
 * server se judi nahi hoti (asset loader sirf app wali WebView par lagta
 * hai).  To wahan `/logo.jpg` khulta hi nahi — print me logo ki jagah tooti
 * hui tasveer ka nishaan aata hai.
 *
 * Yahan tasveer ko canvas par utaar kar `data:` me badal dete hain, to
 * HTML khud-kaafi ho jaati hai — na server chahiye na network.  Website par
 * bhi isse faayda hai: iframe ko tasveer dobara utaarni nahi padti.
 *
 * Naap PADHI HUI (live) tasveer se lete hain, clone se nahi — clone kabhi
 * DOM me laga hi nahi, uski naturalWidth 0 hoti hai. */
export async function tasveeronKoAndarBithao(node) {
  const clone = node.cloneNode(true);
  const zinda = Array.from(node.querySelectorAll("img"));
  const nakli = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    nakli.map(async (im, i) => {
      const src = im.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) return;      // pehle se andar hai
      try {
        const el = zinda[i];
        const w = el?.naturalWidth || 0;
        const h = el?.naturalHeight || 0;
        if (!w || !h) return;                            // abhi utri nahi — rehne do
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(el, 0, 0);
        im.setAttribute("src", c.toDataURL("image/png"));
      } catch {
        // Doosre origin ki tasveer canvas ko "ganda" kar deti hai aur
        // toDataURL phenk deta hai.  Aisi soorat me purana src hi rehne
        // do — website par wo phir bhi chalega.
      }
    })
  );
  return clone;
}

/* Live control ki HAALAT ko ATTRIBUTE bana do, taaki `outerHTML` me bach jaye.
 *
 * KYUN ZAROORI HAI (naap kar nikla, 2026-09-13)
 * ---------------------------------------------
 * `cloneNode` control ki haalat MEMORY me utaar leta hai, par `outerHTML`
 * sirf ATTRIBUTE likhta hai -- aur React `checked`/`selected` ko attribute
 * me rakhta hi nahi, wo seedha property set karta hai.  Nateeja: CHHAPI HUI
 * Breakdown Slip me MACHINE NO. par "-- select --" aata tha aur A/B category,
 * MAINTENANCE, ELECTRICAL, SPARE USED ke saare tick KHAALI -- jabki parde
 * par sab theek bhara dikhta hai.
 *
 * `<input type=text>` ka `value` aur `<textarea>` ka text React khud sahi
 * rakhta hai (naapa: dono attribute/text me maujood the) -- wo pehle se
 * theek the, isliye yahan sirf tick aur select hain.
 *
 * Ye PRINT aur PDF DONO ko chahiye -- serialize dono jagah hota hai. */
export function haalatKoAttributeBanao(clone, live) {
  const jodi = (chunav, kaam) => {
    const zinda = Array.from(live.querySelectorAll(chunav));
    Array.from(clone.querySelectorAll(chunav)).forEach((el, i) => {
      if (zinda[i]) kaam(el, zinda[i]);
    });
  };
  jodi("input[type=checkbox], input[type=radio]", (el, z) => {
    if (z.checked) el.setAttribute("checked", "");
    else el.removeAttribute("checked");
  });
  jodi("select", (el, z) => {
    Array.from(el.options).forEach((o, i) => {
      if (z.options[i] && z.options[i].selected) o.setAttribute("selected", "");
      else o.removeAttribute("selected");
    });
  });
  return clone;
}

/* Clone me har <input>/<textarea>/<select> ki jagah uska TEXT bitha do.
 *
 * KYUN ZAROORI HAI (naap kar nikla, 2026-09-12 aur 13)
 * ----------------------------------------------------
 * html2canvas form-control KHUD banata hai -- browser ka apna layout
 * istemal nahi karta -- aur do jagah galat nikalta hai:
 *
 *   1. input ka text uske dabbe par KAAT deta hai.  Breakdown Slip me isi
 *      wajah se aakhri (signature) row ke naam AADHE kat rahe the: "NEERAJ"
 *      ka upper aadha hi aata tha.  DOM me kahin koi clipping thi hi nahi
 *      (naapa: fit/modal/body teeno 658px, panna 794px) -- galti sirf banni
 *      hui file me dikhti thi.
 *   2. tick/radio aur select ki HAALAT banata hi nahi.  Naapa: slip me 4
 *      tick lage the aur MACHINE NO. me YFG_SS_04 chuna tha -- PDF me ek
 *      bhi tick nahi aaya aur machine ki jagah "-- select --" likha tha.
 *
 * Pehle (1) ke liye teen cheezein aazma kar dekhi aur teeno bekaar gayin:
 * modal ka overflow kholna, line-height badhana, input ko lambai dena.
 * Asli hal yahi hai -- control rehne hi mat do.
 *
 * PRINT ko iski zaroorat nahi (browser control bilkul theek likhta hai) --
 * use `haalatKoAttributeBanao` chahiye, jo upar hai.  Isliye ye sirf PDF
 * wale raaste par lagta hai.
 *
 * Naap LIVE element se lete hain (clone kabhi DOM me laga hi nahi, uska
 * computed style khali hota hai), aur span par wahi font/padding/align
 * chipka dete hain taaki dekhne me koi farak na pade. */
/* Date / time ke khaane me `value` WO NAHI hota jo screen par dikhta hai.
 * `<input type="date">` ka value hamesha ISO rehta hai (2026-09-19) aur
 * `type="time"` ka 24-ghante ka (13:10), jabki browser unhe "09/19/2026" aur
 * "01:10 PM" dikhata hai.  Seedha value chhapne par kaagaz/PDF par tareekh
 * aur samay SCREEN SE ALAG aate the -- aur slip me AM/PM to gayab hi ho jaata
 * tha (01:10 PM kaagaz par "13:10").  Isliye yahan wahi shakl banate hain jo
 * aankh ne screen par dekhi thi.
 *
 * Browser ka apna locale hi lagate hain -- wahi to screen par bhi laga tha.
 * Locale kisi wajah se na chale to value jyon ki tyon (kuch na dikhne se
 * behtar hai galat shakl me dikhna). */
function jaisaDikhta(kism, v) {
  if (!v) return "";
  try {
    if (kism === "date") {
      const [y, m, d] = String(v).split("-").map(Number);
      // `2-digit` isliye ki screen par bhi padded aata hai (09/19/2026).
      // Bina iske PDF me "9/19/2026" likha jaata -- bas itna sa farq bhi
      // "format alag hai" jaisa lagta hai.
      if (y && m && d) {
        return new Date(y, m - 1, d).toLocaleDateString([], {
          year: "numeric", month: "2-digit", day: "2-digit" });
      }
    }
    if (kism === "time") {
      const [h, mi] = String(v).split(":").map(Number);
      if (!Number.isNaN(h)) {
        return new Date(2000, 0, 1, h, mi || 0)
          .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    }
    if (kism === "datetime-local") {
      const dd = new Date(v);
      if (!Number.isNaN(dd.getTime())) {
        return dd.toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit",
                                       hour: "2-digit", minute: "2-digit" });
      }
    }
    if (kism === "month") {
      const [y, m] = String(v).split("-").map(Number);
      if (y && m) return new Date(y, m - 1, 1)
        .toLocaleDateString([], { year: "numeric", month: "short" });
    }
  } catch { /* locale na chale to jyon ka tyon */ }
  return v;
}

export function inputonKoTextBanao(clone, live) {
  const CHUNAV = "input, textarea, select";
  const zinda = Array.from(live.querySelectorAll(CHUNAV));
  const nakli = Array.from(clone.querySelectorAll(CHUNAV));
  nakli.forEach((el, i) => {
    const z = zinda[i];
    const tag = (el.tagName || "").toLowerCase();
    const kism = (el.getAttribute("type") || "").toLowerCase();
    let cs = null;
    try { cs = z ? window.getComputedStyle(z) : null; } catch { cs = null; }

    // ── tick / radio ── inka text nahi hota, dabba hota hai.  Isliye span
    // par wahi dabba khud banate hain aur lagne par nishaan bhi.  (Nishaan
    // ke glyph slip ke apne header me pehle se chhap rahe hain -- "TICK
    // DOWN (✓)" -- to font ki kami ka dar nahi.)
    if (tag === "input" && /^(checkbox|radio)$/.test(kism)) {
      const gol  = kism === "radio";
      const naap = (v, d) => { const n = parseFloat(v); return n > 0 ? n : d; };
      let w = naap(cs && cs.width, 13), h = naap(cs && cs.height, 13);
      // ⚠ RADIO HAMESHA GOL.  Slip me jagah kam padne par browser ek radio
      // ko 13x16 kar deta hai; wahi naap `border-radius:50%` ke saath ANDE
      // jaisa dabba bana deti thi (user 2026-09-23: "circle dekho").  Chhoti
      // taraf le lete hain -- gol bhi rahega aur apni jagah se bahar bhi
      // nahi nikalega.
      if (gol) { const ek = Math.min(w, h); w = ek; h = ek; }
      const sp = clone.ownerDocument.createElement("span");
      sp.className = el.className;
      if (z && z.checked) {
        if (gol) {
          // ⚠ Beech ka dot GLYPH ("●") se NAHI banate.  Us glyph ka apna
          // baseline hota hai, aur wo font ke hisaab se circle me upar-neeche
          // khisak jaata hai.  Asli chhota gol dabba hamesha theek beech me
          // baithta hai -- font ka koi lena-dena hi nahi rehta.
          const d = Math.max(3, Math.round(h * 0.5));
          const dot = clone.ownerDocument.createElement("span");
          dot.setAttribute("style", [
            "position:absolute", "left:50%", "top:50%",
            "width:" + d + "px", "height:" + d + "px",
            "margin-left:" + (-d / 2) + "px", "margin-top:" + (-d / 2) + "px",
            "border-radius:50%", "background:#000",
          ].join(";"));
          sp.appendChild(dot);
        } else {
          sp.textContent = "✓";
        }
      }
      sp.setAttribute("style", [
        "display:inline-block", "box-sizing:border-box", "position:relative",
        "width:" + w + "px", "height:" + h + "px",
        "border:1px solid #555", "border-radius:" + (gol ? "50%" : "2px"),
        "background:#fff", "color:#000", "text-align:center",
        "line-height:" + Math.max(1, h - 3) + "px",
        "font-size:" + Math.max(8, Math.round(h * 0.9)) + "px",
        "vertical-align:middle", "overflow:hidden",
        cs ? "margin:" + cs.margin : "",
      ].filter(Boolean).join(";"));
      el.replaceWith(sp);
      return;
    }

    // Select ka chuna hua text.  Kuch chuna hi na ho to KHAALI -- kaagaz par
    // "-- select --" chhapna bekaar hai, wo parde ka placeholder hai.
    const val = tag === "select"
      ? (z && z.value
          ? ((z.options[z.selectedIndex] || {}).text || z.value)
          : "")
      : jaisaDikhta(kism, (z && z.value) || el.getAttribute("value") || el.textContent || "");

    const sp = clone.ownerDocument.createElement("span");
    sp.className = el.className;
    sp.textContent = val;
    const box = [
      "display:inline-block", "box-sizing:border-box", "width:100%",
      "white-space:pre-wrap", "word-break:break-word", "background:transparent",
      "border:0",
    ];
    if (cs) {
      box.push("font:" + cs.font, "color:" + cs.color, "padding:" + cs.padding,
               "text-align:" + cs.textAlign, "line-height:" + cs.lineHeight,
               // textarea ki lambai bani rahe, warna row simat jaati hai
               tag === "textarea" ? "min-height:" + cs.height : "");
    }
    sp.setAttribute("style", box.filter(Boolean).join(";"));
    el.replaceWith(sp);
  });
  return clone;
}

/* Native pul se chhapo; pul na ho to `null` lauta do.
 *
 * ClosureFormModal (Breakdown Slip / Auto Slip) ki apni print-CSS bahut
 * baarik hai aur wo pehle se chal rahi hai -- use badalna nahi tha.  Use
 * bas APK me chalna tha, isliye ye chhota darwaza alag rakha hai: doc wo
 * khud banata hai, aur bhejna yahan se hota hai. */
export function nativeChhapo(doc, naam) {
  const P = nativePul();
  return P?.chhapo ? P.chhapo({ html: doc, naam }) : null;
}

/* Ek DOM node ko akele kaagaz par chhapo.
 *
 *   node   — jise chhapna hai (sheet ka sabse bahar wala div)
 *   naam   — file/job ka naam (Android ke print parde par dikhta hai)
 *   khada  — true = A4 portrait, false = A4 landscape
 *   css    — iss sheet ke liye kuch aur print-CSS (marzi ki)
 *
 * SEEDHA `window.print()` KYUN NAHI (website par bhi):
 * poori app ka DOM <body> me baitha hai — side nav, topbar, table sab.
 * Unhe `visibility:hidden` kar dene par bhi wo JAGAH ghere rehte hain, to
 * printer pehle panne par sheet aur doosre par khaali kaagaz nikaal deta
 * hai.  Chhupe hue iframe me sirf sheet hoti hai, isliye ye dikkat aati hi
 * nahi.  (Yahi tareeqa Breakdown Slip me pehle se chal raha hai.) */
/* Chhapne laayak poora HTML document banao.
 * `chhapoNode` aur `pdfNikalo` DONO yahi istemal karte hain -- do copy hoti
 * to ek me print-CSS badal jaati aur doosri me chhoot jaati, chup-chaap. */
function printDoc(chhapneWala, naam, khada, css) {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><title>' + naam + "</title>",
    '<base href="' + location.origin + '/">',
    "<style>" + pageKeStyles() + "</style>",
    "<style>",
    "  @page { size: A4 " + (khada ? "portrait" : "landscape") + "; margin: 6mm; }",
    "  html, body { margin:0 !important; padding:0 !important; background:#fff !important; }",
    /* Sheet ko kaagaz ki chaudai me bithao.  transform-origin upar-baayen
       isliye ki chhota karne par wo kone se hi simte, beech se nahi. */
    "  .tb-print-fit { transform-origin: top left; }",
    "  .tb-print-fit > * { box-shadow:none !important; margin:0 !important; }",
    /* Print par ye kabhi nahi dikhne chahiye */
    "  .tb-print-btn, .tb-noprint { display:none !important; }",
    /* Screen ka scroll-dabba kaagaz par KHOL do.  `overflow:auto` wala
       dabba print aur html2canvas dono me sirf apni chaudai jitna dikhata
       hai, baaki chup-chaap kaat deta hai.  Jis sheet me aisa dabba ho, wo
       use `tb-print-open` class de (abhi DmcSheet ki din wali grid). */
    "  .tb-print-open { overflow:visible !important; }",
    css,
    "</style>",
    '</head><body><div class="tb-print-fit">' + chhapneWala.outerHTML + "</div></body></html>",
  ].join("\n");
}

export async function chhapoNode(node, { naam = "Sheet", khada = false, css = "",
                                         kamSeKam = 0.4 } = {}) {
  if (!node) return;
  const chhapneWala = await tasveeronKoAndarBithao(node);
  const doc = printDoc(chhapneWala, naam, khada, css);

  const P = nativePul();
  if (P?.chhapo) {
    // ⚠ APP ME SHEET KO PEHLE SE SIMTA KAR BHEJNA PADTA HAI.
    // Website par simatne ka kaam `browserPrint` karta hai -- wo apne chhupe
    // iframe me sheet naapta hai aur zaroorat ho to `transform: scale()`
    // laga deta hai.  Par APP me hum `browserPrint` tak pahunchte hi nahi:
    // HTML seedha Java ke `chhapo()` ko jaata hai, jo apni ALAG WebView
    // banata hai -- aur wahan hamara naapne wala code chalta hi nahi.
    //
    // Natija (emulator par 2026-09-12 ko khud dekha): 31-column wali DMC
    // sheet print me DIN ~20 PAR KAT rahi thi, bina kisi shikayat ke.  DOM
    // me naap kar pushti ki -- `width` kabhi set hi nahi hui thi aur
    // `transform` "none" tha.
    //
    // Isliye ab naap yahan pehle hi kar lete hain aur scale HTML ke andar
    // hi chipka kar bhejte hain, taaki Java ki WebView ko kuch naapna hi na
    // pade.  (Website ka raasta jyon ka tyon hai.)
    const tayyar = await appKeLiyeSimtao(doc, khada, kamSeKam);
    P.chhapo({ html: tayyar, naam }).catch(() => browserPrint(doc, khada, kamSeKam));
    return;
  }
  browserPrint(doc, khada, kamSeKam);
}

/* Content ki ASLI chaudai naapo.
 *
 * ⚠ YAHAN EK JAAL HAI, AUR MAIN USME GIRA BHI THA.
 * Pehle `fit.scrollWidth` se naapta tha.  Wo GALAT hai: `overflow:visible`
 * wale block ka `scrollWidth` uske andar se BAHAR NIKALTE hisson ko ginta
 * hi nahi.  1600px ke table par bhi naap 20px aati thi — yaani scale kabhi
 * lagta hi nahi aur DMC ki 31-column wali chaudi sheet kaagaz se kat kar
 * chhapti, bina kisi shikayat ke.
 *
 * Isliye har andar wale tukde ka daayan kinara naap kar sabse door wala
 * lete hain.  Sust lagta hai, par ye ek hi baar chalta hai — sirf jab
 * print ka button dabta hai. */
function asliChaudai(fit) {
  const base = fit.getBoundingClientRect().left;
  let sabseDoor = fit.getBoundingClientRect().width;
  for (const el of fit.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;                    // chhupe hue tukde chhod do
    // Do naap, dono zaroori:
    //   r.right        -- khud tukda kitna daayen tak jaata hai (chauda table)
    //   left+scrollWidth -- uske ANDAR ka behta hua maal (bina wrap wala lamba
    //                     text).  Block ka rect apne andar bahe hue text ko
    //                     nahi ginta, par scrollWidth ginta hai.
    const door = Math.max(r.right - base, r.left - base + el.scrollWidth);
    if (door > sabseDoor) sabseDoor = door;
  }
  return sabseDoor;
}

/* Chhupe hue iframe me sheet ko KAAGAZ KI NAAP par bitha do, aur tayyar
 * hone par `kaam(win, ctx, hatao)` bula do.
 *
 * PRINT AUR PDF DONO YAHI ISTEMAL KARTE HAIN.  Pehle ye saari naap-tol
 * sirf print ke paas thi.  PDF ke liye alag likhte to wo print se ALAG
 * dikhti -- aur wahi sabse buri soorat hoti: screen par ek cheez, kaagaz
 * par doosri, aur file me teesri.
 *
 * `ctx` me milta hai: { px, pxH, fit, chaudai } -- kaagaz ki naap, sheet ka
 * root, aur uski ASLI chaudai (overflow sameth).
 *
 * `simtao`:
 *   true  (print) -- content chauda ho to `transform: scale()` se simata
 *                    diya jaata hai, taaki kaagaz par kate nahi.
 *   false (PDF)   -- transform LAGAYA HI NAHI jaata.  Do wajah: html2canvas
 *                    CSS transform ko theek se nahi utaarta, aur PDF me
 *                    simatne ka kaam jsPDF khud behtar karta hai (poori
 *                    tasveer ko panne ki chaudai par bithakar).  Isliye
 *                    yahan sheet ko uski poori chaudai de dete hain.
 */
function kaagazParBithao(doc, khada, kaam,
                         { simtao = true, kamSeKam = 0.4, margin = 6 } = {}) {
  // Kaagaz ki naap (96dpi par A4, dono taraf ka margin ghata kar).
  // `margin` parameter isliye: Breakdown Slip apna doc `@page margin:0`
  // par banata hai aur uska `.bds-print-page` poore 297x210mm ka hai --
  // uske liye 6mm ghatana galat naap de deta.
  const chaudaiMm = (khada ? 210 : 297) - 2 * margin;
  const lambaiMm  = (khada ? 297 : 210) - 2 * margin;
  const px  = Math.round((chaudaiMm / 25.4) * 96);
  const pxH = Math.round((lambaiMm / 25.4) * 96);

  const f = document.createElement("iframe");
  // ⚠ IFRAME KO KAAGAZ JITNA CHAUDA RAKHNA ZAROORI HAI.
  // Pehle ye 1px ka tha.  Uska matlab tha ki layout 1px ki chaudai par
  // banta — table simat jaate, lafz tootkar neeche chale jaate — aur usi
  // bigdi hui layout par naap li jaati.  Isliye screen par uski jagah
  // kaagaz jitni rakhte hain aur use bahar (left:-10000px) khiska dete
  // hain, taaki dikhe na par layout sahi bane.
  Object.assign(f.style, {
    position: "fixed", left: "-10000px", top: "0",
    width: px + "px", height: pxH + "px",
    border: 0, opacity: 0, pointerEvents: "none",
  });
  document.body.appendChild(f);
  const d = f.contentDocument || f.contentWindow?.document;
  if (!d) { f.remove(); return Promise.reject(new Error("Could not open the print frame")); }
  d.open(); d.write(doc); d.close();

  const hatao = () => { if (f.parentNode) f.remove(); };

  return new Promise((res, rej) => {
    const chalao = async () => {
      try {
        const w = f.contentWindow;
        // ⚠⚠ IFRAME KO MAIN PAGE KE FONT DO -- warna PDF me shabd bikhar
        // jaate hain.
        //
        // App ka Barlow ek `@import url(fonts.googleapis.com...)` se aata hai.
        // Chhupa iframe apna alag document hai: wahan wo font pahunchta hi
        // nahi (naap kar dekha -- iframe me font-face ki ginti 0), to JAGAH
        // fallback (chaudi) font se tay hoti hai.  Par html2canvas apna canvas
        // MAIN PAGE me banata hai, jahan Barlow (patli) maujood hai -- to har
        // shabd apni jagah se patla chhapta hai aur uske baad khaali jagah
        // bach jaati hai.  DB me "SS-08 RR. UPPER END CAP CYLINDER NOT WORK."
        // tha aur PDF me "SS -08 RR . UPPER  END  CAP ..." aa raha tha.
        //
        // Ek hi line ka naap:  iframe ka DOM 303.2px  |  main ka canvas 264.4px
        // Font copy karne ke baad:  dono 264.4px -- farq ZERO.
        //
        // `@import` dobara bhejne se kaam nahi chalta (aazma kar dekha, iframe
        // me phir bhi 0 font aaye), aur plant ka LAN internet se kata bhi hai.
        // Ye tareeqa network par tika hi nahi -- font main page me pehle se
        // utra hua hai, bas wahi dobara istemal ho jaata hai.
        try {
          const apne = w?.document?.fonts;
          if (apne && document.fonts) {
            document.fonts.forEach((ek) => {
              if (ek.status === "loaded") { try { apne.add(ek); } catch { /* ye font chhod do */ } }
            });
          }
        } catch { /* font set na mile to pehle jaisa chalega */ }

        // ⚠ FONT UTARNE KA INTEZAAR -- warna naap GALAT aati hai.
        // Neeche saara hisaab (scale, lambai) text ki naap par tika hai, aur
        // font badalte hi wo naap badal jaati hai.  Breakdown Slip par yahi
        // pakda gaya: font aane se pehle naapne par slip chhoti lagti thi,
        // scale bada reh jaata, aur PDF me neeche ka signature wala hissa
        // KAT jaata tha -- jabki print (jo 300ms ruk kar naapta hai) poora
        // aata tha.  `fonts.ready` us andaze ko hata deta hai.
        try { await w?.document?.fonts?.ready; } catch { /* purana browser */ }
        const fit = w?.document?.querySelector(".tb-print-fit");
        const ctx = { px, pxH, fit, chaudai: px };
        if (fit) {
          // Content ko kaagaz ki chaudai do — jo `width:100%` par bane hain
          // wo isse theek baith jaate hain.  Jo phir bhi bahar nikalte hain
          // (DMC ke 31 din wale column) unka hisaab neeche hota hai.
          fit.style.width = px + "px";
          const chaudai = asliChaudai(fit);
          ctx.chaudai = chaudai;
          if (chaudai > px + 1) {
            if (simtao) {
              // Sirf CHHOTA karo, bada kabhi nahi — bada karne par sheet
              // dhundhli aur phaili hui nikalti hai.
              //
              // ⚠ SIMATNE KI HADD.
              // Ek bhi cell me bina space wala lamba lafz (koi lamba remark,
              // ya galti se chipka hua text) sheet ko hazaron px chauda kar
              // deta hai.  Naap kar dekha: aise ek line par scale 0.075 tak
              // aa gaya -- yaani poori sheet 13 guna chhoti, jisme kuch
              // padha hi nahi ja sakta.  Utna simatne se BEHTAR hai ki wo
              // ek line kat jaye aur baaki sheet padhne layak rahe.  0.4
              // par 11px ka akshar ~3pt ka bachta hai -- usse neeche waise
              // bhi bekaar hai.
              const sc = Math.max(kamSeKam, px / chaudai);
              fit.style.transform = "scale(" + sc + ")";
              // Simatne ke baad neeche ki khali jagah hata do, warna ek
              // khali panna aur nikal aata hai.
              fit.style.height = fit.getBoundingClientRect().height * sc + "px";
            } else {
              // PDF: poori chaudai do, simatna jsPDF par chhod do.
              fit.style.width = Math.ceil(chaudai) + "px";
            }
          }
        }
        res(await kaam(w, ctx, hatao));
      } catch (e) {
        rej(e);
      }
    };

    // Tasveerein utarne ka intezaar, par 1.2s se zyada nahi — logo na bhi
    // aaye to sheet chhap jaani chahiye.
    const iw = f.contentWindow;
    if (iw?.document?.readyState === "complete") {
      setTimeout(chalao, 120);
    } else {
      let gaya = false;
      const ek = () => { if (!gaya) { gaya = true; chalao(); } };
      iw?.addEventListener?.("load", ek);
      setTimeout(ek, 1200);
    }
  });
}

/* Website wala raasta — chhupa hua iframe, phir uska apna print. */
function browserPrint(doc, khada, kamSeKam = 0.4) {
  kaagazParBithao(doc, khada, (w, _ctx, hatao) => {
    w?.focus();
    w?.print();
    // Print ka parda async hai — frame turant hata dene par kuch browser
    // khali panna chhapte hain.  Isliye thoda ruk kar hatate hain.
    setTimeout(hatao, 1500);
  }, { kamSeKam }).catch(() => {
    /* print na ho paye to bhi chup — pehle bhi yahi bartaav tha */
  });
}

/* APP ke liye: sheet ko naap kar SCALE HTML ke andar hi chipka do.
 *
 * Website par ye kaam `browserPrint` chalte waqt karta hai.  App me wo
 * raasta aata hi nahi -- HTML Java ki apni WebView me jaata hai -- isliye
 * yahan wahi naap pehle se kar ke bhej dete hain.  Naap ka code wahi ek
 * hai (`kaagazParBithao` + `asliChaudai`), to dono jagah nateeja ek jaisa
 * rehta hai.
 *
 * Naap na ho paye to doc jyon ka tyon lauta dete hain -- bina scale ke
 * print hona, bilkul print na hone se behtar hai. */
async function appKeLiyeSimtao(doc, khada, kamSeKam = 0.4) {
  try {
    const naap = await kaagazParBithao(doc, khada, (w, ctx, hatao) => {
      const r = { px: ctx.px, chaudai: ctx.chaudai,
                  h: ctx.fit ? ctx.fit.getBoundingClientRect().height : 0 };
      hatao();
      return r;
    }, { simtao: false });                 // sirf naapna hai, simatna nahi

    if (!naap || !naap.chaudai || naap.chaudai <= naap.px + 1) return doc;

    // Wahi hadd jo website par hai -- 0.4 se neeche simatne par kuch padha
    // hi nahi jaata (wajah `kaagazParBithao` me likhi hai).
    const s = Math.max(kamSeKam, naap.px / naap.chaudai);
    const W = Math.ceil(naap.chaudai);
    // Height bhi deni padti hai: `transform` sirf DIKHNE ka aakar badalta
    // hai, jagah utni hi ghiri rehti hai -- bina iske ek khali panna aur
    // nikal aata hai.
    const H = Math.ceil(naap.h * s);
    const extra =
      "<style>.tb-print-fit{width:" + W + "px !important;" +
      (H ? "height:" + H + "px !important;" : "") +
      "transform:scale(" + s.toFixed(4) + ") !important;" +
      "transform-origin:top left !important;}</style>";
    return doc.replace("</head>", extra + "</head>");
  } catch {
    return doc;
  }
}

/* ── PDF ────────────────────────────────────────────────────────────────
 *
 * ITIHAAS, TAAKI YE PAHIYA TEESRI BAAR NA BANE
 * --------------------------------------------
 * Pehle Android me `PdfDocument` par WebView ko `draw()` karke PDF banayi
 * thi.  Emulator par naap kar dekha to wo BHAROSEMAND NAHI nikli — ek hi
 * content par kabhi poora panna, kabhi BILKUL KHALI.  Paanch cheezein
 * pakdi gayi thin: bina-attach View par `postDelayed` chalta hi nahi ·
 * pehli `draw()` par Chromium ne paint hi nahi kiya hota · hardware
 * accelerated WebView software bitmap par kuch nahi likhti · PdfDocument
 * ke canvas par WebView `translate` nazarandaaz kar deta hai (saare panne
 * ek jaise) · badi naap par software layer khali de deta hai.  Isliye wo
 * code 2026-09-08 ko HATA DIYA GAYA (v1.4.34).
 *
 * ⚠ IS NAYE RAASTE ME WO PAANCHON DIKKATEN HAIN HI NAHI, aur wajah saaf
 * hai: yahan native WebView kuch draw karta hi nahi.  Poori tasveer
 * html2canvas se JAVASCRIPT ke andar banti hai (usi chhupe iframe me jise
 * print bhi istemal karta hai), aur Java ko sirf tayyar PDF ke bytes
 * diye jaate hain.  Yaani Android ki rendering ka koi jaal beech me aata
 * hi nahi.
 *
 * KEEMAT KYA HAI (saaf-saaf, taaki baad me hairani na ho)
 * ------------------------------------------------------
 * Sheet PDF me TASVEER ban kar jaati hai, vector text nahi.  Matlab: PDF
 * me se text copy/search nahi hoga, aur bahut zoom karne par akshar thode
 * naram lagenge.  Iske badle jo milta hai wo user ne maanga tha — EK TAP
 * me asli file, bina kisi parde ke, site aur app dono par ek jaisi.
 * (Print ka button apni jagah hai hi — jise vector text wali PDF chahiye
 * wo print se "Save as PDF" kar sakta hai.)
 *
 * 2× par utaarte hain (≈192dpi) — naap kar dekha ki 31-column wali DMC
 * sheet bhi is par padhne layak rehti hai, aur file kaabu me rehti hai.
 *
 * ⚠ APP PEECHHE CHALI JAYE TO BANANA RUK JAATA HAI (aur ye theek hai).
 * File banne ke baad Android khud PDF viewer khol deta hai, yaani app
 * background me chali jaati hai.  Wahan WebView ka rendering Android rok
 * deta hai, to html2canvas beech me hi thehar jaata hai aur button
 * "Making…" par khada rehta hai.  Emulator par naap kar dekha: user ke app
 * par WAPAS aate hi kaam wahin se poora ho jaata hai aur file Downloads me
 * gir jaati hai.  Isliye yahan koi timeout JAAN-BOOJHKAR nahi rakha —
 * timeout us soorat me "fail ho gaya" likh deta, aur thodi der baad file
 * bhi aa jaati.  Do ulti baatein ek saath kehna, chup rehne se bura hai. */

let pdfWaada = null;

/* jsPDF + html2canvas ek saath ~1 MB ke hain.  Inhe SIRF tab utaarte hain
 * jab PDF ka button dabta hai — `import()` se Vite inka alag tukda banata
 * hai, to aam page inka bojh uthata hi nahi.
 *
 * ⚠ CDN SE NAHI AATE.  Plant ka network bahar nahi jaata, isliye ye dono
 * app ke build me hi chale jaate hain (xlsx wali local copy jaisa hi
 * usool).  `import()` sirf "kab utaarein" tay karta hai, "kahan se" nahi. */
function pdfLagao() {
  if (!pdfWaada) {
    pdfWaada = Promise.all([import("jspdf"), import("html2canvas")])
      .then(([j, h]) => ({
        jsPDF: j.jsPDF || j.default?.jsPDF || j.default,
        html2canvas: h.default || h,
      }))
      .catch((e) => { pdfWaada = null; throw e; });
  }
  return pdfWaada;
}

/* Blob ko base64 me badlo — Java ke pul ko bytes isi roop me jaate hain. */
const blobBase64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  // `result` "data:application/pdf;base64,XXXX" hota hai; Java ko sirf
  // XXXX chahiye, isliye pehla comma tak kaat dete hain.
  fr.onload  = () => res(String(fr.result).split(",")[1] || "");
  fr.onerror = () => rej(new Error("Could not read the PDF"));
  fr.readAsDataURL(blob);
});

/* Ek lambi canvas ko A4 ke panno par bitha kar PDF banao.
 *
 * TAREEQA: tasveer EK BAAR PDF me daali jaati hai, aur har panne par use
 * utna UPAR khiska diya jaata hai jitna wo panna neeche hai.  Panne ke
 * bahar ka hissa PDF reader khud kaat deta hai (MediaBox se bahar ka
 * content wo render nahi karta).
 *
 * ⚠ PEHLE MAINE HAR PANNE KI ALAG PNG BANAYI THI -- aur wahi sabse bada
 * ghaata tha.  120-row wali DMC sheet par naapa:
 *
 *      har panne ki alag PNG   13.3 s   905 KB
 *      EK PNG, panne khiska kar 4.2 s  1035 KB   <- yahi chuna
 *
 * PNG banana (encode) pixel ke hisaab se mehnga hai, aur alag-alag panne
 * banane par wahi mehnat 4 baar hoti thi.  Ek hi baar banane se 3 guna tez
 * ho gaya; file thodi badi hai par 1 MB abhi bhi theek hai.  Poori sheet ka
 * waqt 31 s se ghat kar ~9 s aa gaya.
 *
 * ⚠ PNG + `compress: true` -- ye bhi naap kar chuna gaya (31-column DMC):
 *
 *      PNG bina compress   14,494 KB   <- jsPDF RAW pixel bhar deta hai
 *      JPEG q92               816 KB
 *      PNG + compress:true    314 KB   <- yahi chuna
 *
 * Ek jaal jisme main gira tha: `canvas.toDataURL('image/png')` ki naap
 * dekhkar PNG chun liya tha (462 KB).  Par wo PNG *file* ka aakar hai --
 * jsPDF us PNG ko KHOL kar apni stream me daalta hai, aur bina `compress`
 * ke wo stream UNCOMPRESSED jaati hai; PDF 16.7 MB ki bani.  Sabak: naap
 * PDF ki karo, tasveer ki nahi.
 *
 * PNG isliye jeetta hai ki sheet 84% SAFED aur 11% KAALA hoti hai (pixel
 * gin kar dekha) -- bade flat hisse aur teekhe kinare.  Deflate ise dabata
 * hai; JPEG ka DCT ulta har akshar ke kinare par bits kharch karta hai aur
 * dhundhla bhi kar deta hai.  Yahan file chhoti BHI hai aur text saaf BHI. */
function canvasSePdf(jsPDF, canvas, khada, margin = 6, tode = null) {
  // ⚠ `compress: true` LAZMI HAI -- upar ke aankde dekhein.  Iske bina
  // jsPDF PNG ko kholkar RAW pixel bhar deta hai aur sheet 14 MB ki ho
  // jaati hai.
  const pdf = new jsPDF({ orientation: khada ? "portrait" : "landscape",
                          unit: "mm", format: "a4", compress: true });
  const M  = margin;
  const pw = (khada ? 210 : 297) - 2 * M;      // panne par usable chaudai (mm)
  const ph = (khada ? 297 : 210) - 2 * M;      // ...aur lambai

  // Tasveer ki poori chaudai panne ki chaudai par baithti hai; usi anupaat
  // se uski poori lambai mm me nikal aati hai.
  const pooriMm = (canvas.height / canvas.width) * pw;
  const url   = canvas.toDataURL("image/png");
  // Naam dene se jsPDF tasveer ko EK BAAR store karta hai aur har panne par
  // usi ka hawala deta hai -- bina iske wo har baar dobara hisaab lagata.
  const alias = "tb-sheet";

  // ⚠ PEHLE YAHAN SEEDHA `i * ph` PAR KAATA JAATA THA -- yaani har panna
  // theek 198mm par khatam, chahe wahan row ke BEECH ho.  25-point wali PM
  // check sheet par naap kar dekha: tasveer 272mm ki, panna 198mm ka, aur
  // toota point 17 ki row ke beecho-beech padta tha -- aadhi line panne 1 ke
  // neeche, aadhi panne 2 ke upar.  Kaagaz par yahi "shabd idhar-udhar" dikhta
  // hai.  Ab `tode` (row ki seema, sheet ki lambai ka hissa) me se wo sabse
  // neechla toota chunte hain jo panne me aa jaye.
  const seema = (tode || [])
    .map((f) => f * pooriMm)
    .filter((v) => v > 1 && v < pooriMm - 1)
    .sort((a, b) => a - b);
  const kagazW = khada ? 210 : 297;
  const kagazH = khada ? 297 : 210;

  let shuru = 0, ginti = 0;
  while (shuru < pooriMm - 0.5) {
    const adhikatam = shuru + ph;
    let ant;
    if (adhikatam >= pooriMm - 0.5) {
      ant = pooriMm;                                   // aakhri panna
    } else {
      // Panne me aane wali sabse NEECHLI row-seema.  `shuru + 5` isliye ki
      // ek panne par kam se kam kuch to aaye -- warna ek chhoti row par
      // atak kar panne banne ka silsila chalta rehta.
      let b = -1;
      for (const v of seema) if (v > shuru + 5 && v <= adhikatam) b = v;
      // Koi seema na mile (ek hi row panne se lambi) to majboori me seedha
      // kaatte hain -- pehle jaisa.  Isse behtar kuch hai bhi nahi.
      ant = b > 0 ? b : adhikatam;
    }

    if (ginti) pdf.addPage();
    ginti += 1;
    pdf.addImage(url, "PNG", M, M - shuru, pw, pooriMm, alias, "FAST");

    // Is panne ke hisse ke BAHAR ka sab safed se dhak do.  Tasveer poori ki
    // poori har panne par jaati hai (ek hi baar store hoti hai, isi liye tez
    // hai), to bina dhake agle panne ka content is panne ke neeche bhi chhap
    // jaata -- aur phir agle panne par DOBARA.
    pdf.setFillColor(255, 255, 255);
    const bacha = kagazH - (M + (ant - shuru));
    if (bacha > 0.2) pdf.rect(0, M + (ant - shuru), kagazW, bacha, "F");
    if (M > 0.2 || shuru > 0) pdf.rect(0, 0, kagazW, M, "F");   // upar ka hissa
    shuru = ant;
  }
  return { blob: pdf.output("blob"), panne: ginti };
}

/* Panna kahan toda ja sakta hai -- row ki seemayein, sheet ki poori lambai ke
 * HISSE me (0..1).  Hisse isliye ki baad me canvas/scale ka koi hisaab na
 * lagana pade: tasveer chahe kitni bhi badi bane, hissa wahi rehta hai.
 *
 * `tr` hi dhoondte hain (DMC, PM check sheet, report -- sab table hain).
 * Andar wali (nested) table ki row CHHOD dete hain: uski seema par toda to
 * bahar wali row phir bhi beech se kat jaati.  Table hi na ho to seedhe
 * bachche le lete hain. */
function todneKiJagah(el, r) {
  try {
    const H = r.height;
    if (!H || !el.querySelectorAll) return [];
    let qatarein = Array.from(el.querySelectorAll("tr"));
    qatarein = qatarein.filter((n) => {
      const p = n.parentElement;
      return !(p && p.closest && p.closest("tr"));
    });
    if (!qatarein.length) qatarein = Array.from(el.children || []);
    const out = [];
    for (const n of qatarein) {
      const b = n.getBoundingClientRect();
      if (!b.height) continue;
      const f = (b.bottom - r.top) / H;
      if (f > 0.02 && f < 0.995) out.push(Math.round(f * 1e4) / 1e4);
    }
    return Array.from(new Set(out)).sort((a, b) => a - b);
  } catch {
    return [];                       // na mile to pehle jaisa seedha kaat
  }
}

/* Bani hui PDF user tak pahuncha do.
 *   APP     -- bytes `SheetTools.faylSejo` ko, wahan se asli Downloads me.
 *   WEBSITE -- blob ka seedha download.
 * Teen jagah se bulaya jaata hai, isliye alag rakha hai. */
async function pdfDeDo(out, naam) {
  const file = naam + ".pdf";
  try {
    const P = nativePul();
    if (P?.faylSejo) {
      const b64 = await blobBase64(out.blob);
      const r = await P.faylSejo({ base64: b64, naam: file, mime: "application/pdf" });
      return { theek: true, native: true, kahan: r?.kahan || "Downloads", panne: out.panne };
    }
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement("a");
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    // Turant revoke karne par kuch browser download shuru hone se pehle hi
    // link tod dete hain.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { theek: true, native: false, panne: out.panne };
  } catch (e) {
    return { theek: false, kyun: e?.message || "The PDF was created but could not be saved" };
  }
}

/* Ek POORA HTML document (jo caller ne KHUD banaya ho) se PDF.
 *
 * KYUN ALAG DARWAZA
 * -----------------
 * `pdfNikalo` DOM node leta hai aur print-doc khud banata hai.  Par
 * Breakdown Slip (manual aur auto, dono) apna doc KHUD banata hai -- uski
 * print-CSS bahut baarik hai (poora A4 landscape ka ek panna, `@page
 * margin:0`, apni shrink-CSS) aur wo mahino se chal rahi hai.  Use badalna
 * nahi tha.  Yahi soch `nativeChhapo` me bhi lagayi thi.
 *
 *   doc     -- poora <!doctype html> ... </html>
 *   margin  -- kaagaz ka margin mm me (slip 0 bhejta hai, uska panna poora
 *              297x210mm ka hai)
 *   taiyaar(win, ctx) -- capture se PEHLE caller ka apna fit/scale (slip
 *              apna `transform` khud lagata hai).  Hamara print wala
 *              simatna PDF me kabhi nahi lagta -- neeche `simtao: false`.
 *   kyaLein(win) -- kis element ko utaarna hai (slip `.bds-print-page`
 *              deta hai; na de to `.tb-print-fit`, aur wo bhi na mile to
 *              poora body) */
export async function pdfDocSe(doc, { naam = "sheet", khada = false, margin = 6,
                                      taiyaar = null, kyaLein = null } = {}) {
  let jsPDF, html2canvas;
  try {
    ({ jsPDF, html2canvas } = await pdfLagao());
  } catch {
    return { theek: false, kyun: "The PDF library could not be loaded — reload the page and try again" };
  }

  let out;
  try {
    out = await kaagazParBithao(doc, khada, async (w, ctx, hatao) => {
      try {
        if (taiyaar) await taiyaar(w, ctx);
        const el = (kyaLein ? kyaLein(w) : null) || ctx.fit || w.document.body;
        const r = el.getBoundingClientRect();
        const naapW = Math.ceil(r.width  || ctx.px);
        const naapH = Math.ceil(r.height || ctx.pxH);
        // Row ki seemayein ABHI naapte hain -- `taiyaar` ke baad, yaani jo
        // scale slip khud lagata hai wo pehle hi lag chuka hota hai.
        const tode = todneKiJagah(el, r);

        // ⚠ BAHUT LAMBI SHEET PAR SCALE KHUD KAM KAR DETE HAIN.
        // Browser ka canvas ek hadd ke baad CHUP-CHAAP khali lauta deta hai
        // (Chrome me kul pixel ki seema hai, aur koi error nahi aata) — aur
        // khali PDF dena hi wo cheez thi jiski wajah se pichhla raasta hata
        // tha.  Saath hi PNG banane ka waqt bhi pixel ke saath hi badhta
        // hai.  180dpi se 135dpi par girna, khali kaagaz dene se behtar hai.
        const PX_HADD = 24e6;
        let sc = 2;
        while (sc > 1 && naapW * naapH * sc * sc > PX_HADD) sc -= 0.25;

        const canvas = await html2canvas(el, {
          // ⚠ html2canvas APNA TEESRA DOCUMENT banata hai (clone) aur naap
          // WAHAN leta hai, jabki akshar MAIN PAGE ke canvas par likhta hai.
          // Font sirf hamare iframe me daalna kaafi nahi -- clone me bhi wahi
          // font chahiye, warna naap aur likhawat phir alag ho jaate hain aur
          // shabd bikhar jaate hain.
          onclone: (naklDoc) => {
            try {
              if (naklDoc && naklDoc.fonts && document.fonts) {
                document.fonts.forEach((ek) => {
                  if (ek.status === "loaded") { try { naklDoc.fonts.add(ek); } catch { /* ye font chhod do */ } }
                });
              }
            } catch { /* font set na mile to pehle jaisa */ }
          },
          backgroundColor: "#ffffff",
          scale: sc,                // 2 = ~180dpi (naap kar chuna)
          useCORS: true,
          logging: false,
          // Naap SAAF-SAAF dete hain.  Chhupe iframe me html2canvas ka apna
          // andaza kabhi-kabhi 0 aa jaata hai, aur tab PDF khali banti hai.
          width: naapW, height: naapH,
          windowWidth: naapW, windowHeight: naapH,
          scrollX: 0, scrollY: 0,
        });
        if (!canvas.width || !canvas.height) throw new Error("The sheet could not be captured");
        return canvasSePdf(jsPDF, canvas, khada, margin, tode);
      } finally {
        hatao();
      }
    // ⚠ PDF me `simtao` HAMESHA false (2026-09-18 ko pakda, site par).
    // v1.4.50 me yahan `simtao: !taiyaar` likh diya tha -- yaani jis sheet
    // ke saath `taiyaar` nahi aata (DMC, PM format, BD History, History
    // Card, Yearly PM -- slip ke siwa SAB) uspar print wala `transform:
    // scale()` lag jaata tha.  html2canvas phir sirf sheet ka apna, panne
    // jitna dabba utaarta hai: chaudi sheet daayen se kat-ti thi aur neeche
    // ka bada hissa gayab -- aur button "Downloaded" likh deta tha.  Naap:
    // History Card ke 13 me se 1-2 row, DMC me din 20 tak, Yearly PM me 283
    // me se ~109 machine aur sirf Apr-Jul.  PDF me simatna jsPDF karta hai
    // (poori tasveer panne ki chaudai par) -- wajah `kaagazParBithao` me.
    }, { simtao: false, margin });
  } catch (e) {
    return { theek: false, kyun: e?.message || "Could not create the PDF" };
  }
  return pdfDeDo(out, naam);
}

/* Ek DOM node ko PDF bana kar SEEDHA de do — ek tap, koi parda nahi.
 *
 * Doc yahan banta hai (`printDoc`), phir kaam `pdfDocSe` karta hai — to
 * print aur PDF hamesha EK HI doc se bante hain.
 *
 * Lautata hai { theek, native, kahan, panne } ya { theek:false, kyun } —
 * UI isi se tay karta hai ki kya likhna hai.  "Ho gaya" bolna jab kuch hua
 * hi na ho, sabse bura hai. */
export async function pdfNikalo(node, { naam = "sheet", khada = false, css = "" } = {}) {
  if (!node) return { theek: false, kyun: "There is nothing to save" };
  const chhapneWala = await tasveeronKoAndarBithao(node);
  return pdfDocSe(printDoc(chhapneWala, naam, khada, css), { naam, khada });
}

/* Table wale REPORT page (History Card, BD History…) ki print-CSS.
 *
 * Sheet wale page (DMC / PM format) pehle se KAAGAZ KE NAAP ke bane hote
 * hain — unme kuch theek karne ko hota hi nahi.  Report page alag hain, aur
 * unme teen cheezein kaagaz par galat aati hain:
 *
 *   1. Table ek SCROLL WALE DABBE me kaid hoti hai — bina khole sirf wahi
 *      hissa chhapta hai jo screen par dikh raha tha.
 *   2. Cell `white-space: nowrap` hote hain (screen par theek, kyunki
 *      scroll hai).  Kaagaz par wahi table ko hazaron px chauda kar deta
 *      hai, aur phir poori sheet itni simat jaati hai ki padhi hi nahi
 *      jaati.  Lipatne dena (wrap) yahan behtar hai.
 *   3. Header sirf PEHLE panne par aata hai — teen panne ki report me
 *      doosre panne par pata hi nahi chalta kaunsa column kya hai.
 *
 * `pre` = us page ka class prefix — History Card ka "hc", BD History ka
 * "bh".  Ek hi jagah likhne se dono report ek jaisi chhapti hain.
 */
export const tableReportCss = (pre) => `
  .${pre}-card, .${pre}-scroll, .${pre}-card > div {
    overflow: visible !important; max-height: none !important;
  }
  .${pre}-card {
    border: none !important; box-shadow: none !important; border-radius: 0 !important;
  }
  /* Screen par lamba text max-width + ellipsis se kaat diya jaata hai.
     Kaagaz par "..." bekaar hai -- wahan poora text chahiye, lipta hua.
     (Yahan backtick mat likhna -- ye poori CSS ek template literal hai.)

     ⚠ word-break: break-word YAHAN MAT LAGANA.  Ek baar laga kar naapa
     tha aur natija bahut bura tha: History Card me ~25 column hain, to har
     column ko bahut kam jagah milti hai, aur break-word ne har LAFZ KO
     BEECH SE CHEER diya -- PDF me "breakdown" ek-ek akshar karke khada
     nikla ("b r e a k d o w n").  Saada white-space: normal se lafz
     saabut rehta hai aur column utni chaudai le leta hai jitni us lafz ko
     chahiye; jo table phir bhi chaudi rahe use scale khud simata deta hai.

     min-width isliye ki khaali/chhote column 2-3 px ke na reh jaayein. */
  .${pre}-table td, .${pre}-table th {
    white-space: normal !important;
    max-width: none !important; overflow: visible !important;
    text-overflow: clip !important;
    min-width: 34px;
  }
  /* Print me browser background chup-chaap gira deta hai — header ki patti
     aur zebra qatarein gayab ho jaati hain.  Ye unhe rehne deta hai. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Har panne par column ke naam dohra do, aur kisi qatar ko beech se mat kaato. */
  .${pre}-table thead { display: table-header-group; }
  .${pre}-table tr { break-inside: avoid; page-break-inside: avoid; }
`;

/* ══════════════════════════════════════════════════════════════════════
   EXCEL
   ══════════════════════════════════════════════════════════════════════ */

/* SheetJS ko maango.
 *
 * npm se nahi, `/xlsx.full.min.js` se — plant ka network internet se kata
 * hua hai, isliye library ki apni copy `public/` me rakhi hai.  Yahi tareeqa
 * admin/ui.jsx me pehle se chal raha hai; wahan se yahan uthaya hai taaki
 * dono ek hi copy istemal karein. */
let xlsxWaada = null;
export function xlsxLagao() {
  if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxWaada) return xlsxWaada;            // do button ek saath dabein = ek hi download
  xlsxWaada = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/xlsx.full.min.js";
    s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error("XLSX not available")));
    s.onerror = () => { xlsxWaada = null; rej(new Error("Could not load xlsx.full.min.js")); };
    document.head.appendChild(s);
  });
  return xlsxWaada;
}

/* Excel ki file banao aur de do.
 *
 *   naam    — file ka naam, bina ".xlsx" ke
 *   headers — pehli qatar (column ke naam)
 *   rows    — baaki qatarein, har ek array
 *   sheet   — Excel ke andar tab ka naam (31 akshar ki hadd Excel ki apni hai)
 *
 * Lautata hai { theek: true } ya { theek: false, kyun }.  Bulane wala isse
 * user ko batata hai — kyunki chup-chaap fail hona hi sabse buri surat hai. */
export async function excelNikalo({ naam = "export", headers = [], rows = [], sheet = "Sheet1" }) {
  let XLSX;
  try {
    XLSX = await xlsxLagao();
  } catch {
    return { theek: false, kyun: "Excel library not loaded — reload the page and try again" };
  }

  try {
    const aoa = headers.length ? [headers, ...rows] : rows;
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column ki chaudai — bina iske sab column 8 akshar ke rehte hain aur
    // lambi cell "####" jaisi kati hui dikhti hai.  Har column ka sabse
    // lamba text naap kar chaudai deta hoon; 60 par rok isliye ki ek lamba
    // remark poori sheet ko na bigaad de.
    const kitne = Math.max(headers.length, ...rows.map((r) => r.length), 0);
    ws["!cols"] = Array.from({ length: kitne }, (_, c) => {
      let w = String(headers[c] ?? "").length;
      for (const r of rows) {
        const l = String(r[c] ?? "").length;
        if (l > w) w = l;
      }
      return { wch: Math.min(60, Math.max(9, w + 2)) };
    });
    // ⚠ YAHAN "header ko upar chipka do" (freeze pane) KA CODE THA — HATA
    // DIYA (2026-09-12).  Wo line `ws["!freeze"] = {xSplit:0, ySplit:1}`
    // thi aur DEKHNE ME theek lagti thi, par kuch karti hi nahi thi.
    //
    // Device par bani asli file kholkar pakda: `xl/worksheets/sheet1.xml`
    // me `<pane>` hai hi nahi, bas `<sheetView workbookViewId="0"/>`.  Phir
    // isi library (xlsx 0.18.5) par teeno roop alag-alag aazmaye —
    // `{xSplit,ySplit}`, `"A2"`, aur `{ySplit:1}` — teeno par `<pane>`
    // nadaarad.  Freeze pane SheetJS ke COMMUNITY build me hai hi nahi
    // (wo Pro ka hissa hai).
    //
    // Isliye line hata di: jo cheez kuch karti nahi, uska rehna sirf agle
    // aadmi ko dhokha deta hai ("header to pin kiya hua hai na?").  Sach me
    // chahiye ho to library badalni padegi (jaise exceljs).

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, String(sheet).slice(0, 31));

    const file = naam + ".xlsx";
    const P = nativePul();
    if (P?.faylSejo) {
      // APK: bytes Java ko do, wahan se asli Downloads folder me girti hai.
      const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
      const r = await P.faylSejo({
        base64: b64,
        naam: file,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      return { theek: true, kahan: r?.kahan || "Downloads" };
    }
    // Website: seedha download.
    XLSX.writeFile(wb, file);
    return { theek: true };
  } catch (e) {
    return { theek: false, kyun: e?.message || "Something went wrong while creating the Excel file" };
  }
}

/* Date/time ko Excel ke laayak seedha text banao.
 *
 * DB se "2026-09-08T04:30:00" jaisa aata hai.  Aise hi daal dein to Excel
 * kahin date samajhta hai kahin text — aur do machine par do alag natije
 * aate hain.  Isliye ek hi shakl me text bana kar dete hain. */
export const dt = (v) => {
  if (!v) return "";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}:\d{2})?/);
  return m ? m[3] + "-" + m[2] + "-" + m[1] + (m[4] ? " " + m[4] : "") : s;
};

/* Aaj ki tareekh file ke naam ke liye (2026-09-08). */
export const aajKaNaam = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
