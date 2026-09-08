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
  const tukde = [];
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
      tukde.push(t);
    } else if (sheet.ownerNode?.tagName === "STYLE") {
      // Google Fonts jaisa koi @import andar ho to cssRules mana kar deta
      // hai — aise me tag ka apna text hi le lo.
      tukde.push(sheet.ownerNode.innerHTML);
    }
  }
  return tukde.join("\n");
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
    css,
    "</style>",
    '</head><body><div class="tb-print-fit">' + chhapneWala.outerHTML + "</div></body></html>",
  ].join("\n");
}

export async function chhapoNode(node, { naam = "Sheet", khada = false, css = "" } = {}) {
  if (!node) return;
  const chhapneWala = await tasveeronKoAndarBithao(node);
  const doc = printDoc(chhapneWala, naam, khada, css);

  const P = nativePul();
  if (P?.chhapo) {
    P.chhapo({ html: doc, naam }).catch(() => browserPrint(doc, khada));
    return;
  }
  browserPrint(doc, khada);
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

/* Website wala raasta — chhupa hua iframe. */
function browserPrint(doc, khada) {
  // Kaagaz ki naap (96dpi par A4, dono taraf ke 6mm margin ghata kar).
  const chaudaiMm = (khada ? 210 : 297) - 12;
  const lambaiMm  = (khada ? 297 : 210) - 12;
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
  if (!d) { f.remove(); return; }
  d.open(); d.write(doc); d.close();

  const chalao = () => {
    try {
      const w = f.contentWindow;
      const id = w?.document;
      const fit = id?.querySelector(".tb-print-fit");
      if (fit) {
        // Content ko kaagaz ki chaudai do — jo `width:100%` par bane hain
        // wo isse theek baith jaate hain.  Jo phir bhi bahar nikalte hain
        // (DMC ke 31 din wale column) unhe neeche scale se simata jaata hai.
        fit.style.width = px + "px";
        const chaudai = asliChaudai(fit);
        // Sirf CHHOTA karo, bada kabhi nahi — bada karne par sheet
        // dhundhli aur phaili hui nikalti hai.
        if (chaudai > px + 1) {
          // ⚠ SIMATNE KI HADD.
          // Ek bhi cell me bina space wala lamba lafz (koi lamba remark, ya
          // galti se chipka hua text) sheet ko hazaron px chauda kar deta
          // hai.  Naap kar dekha: aise ek line par scale 0.075 tak aa gaya
          // -- yaani poori sheet 13 guna chhoti, jisme kuch padha hi nahi
          // ja sakta.  Utna simatne se BEHTAR hai ki wo ek line kat jaye
          // aur baaki sheet padhne layak rahe.  0.4 par 11px ka akshar
          // ~3pt ka bachta hai -- usse neeche waise bhi bekaar hai.
          const s = Math.max(0.4, px / chaudai);
          fit.style.transform = "scale(" + s + ")";
          // Simatne ke baad neeche ki khali jagah hata do, warna ek
          // khali panna aur nikal aata hai.
          fit.style.height = fit.getBoundingClientRect().height * s + "px";
        }
      }
      w?.focus();
      w?.print();
    } catch {
      /* print na ho paye to bhi neeche iframe hatana zaroori hai */
    }
    setTimeout(() => { if (f.parentNode) f.remove(); }, 1500);
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
}

/* Ek DOM node ko PDF bana kar de do.
 *
 * APP: Android me `PdfDocument` se ASLI PDF banti hai aur seedha Downloads
 * me girti hai -- ek tap, koi parda nahi.
 *
 * WEBSITE: browser bina library ke chup-chaap PDF nahi bana sakta.  jsPDF +
 * html2canvas ~1 MB ke hote hain aur us tareeqe me table TASVEER ban jaati
 * hai -- dhundhli, aur usme se text copy bhi nahi hota.  48-hafte wali
 * schedule ke liye wo saaf ghaata hai (aur plant ka network offline hai, to
 * library saath hi rakhni padti).  Isliye website par print ka parda kholte
 * hain, jahan har browser me "Save as PDF" maujood hota hai.
 *
 * Jawab me batate hain kaunsa raasta chala, taaki UI sahi baat likh sake --
 * "ho gaya" bolna jab kuch hua hi na ho, sabse bura hai.
 *
 * Lautata hai: { native: true, kahan, panne } ya { native: false } */
export async function pdfNikalo(node, { naam = "sheet", khada = false, css = "" } = {}) {
  if (!node) return { native: false };
  const P = nativePul();
  if (P?.pdfBanao) {
    const chhapneWala = await tasveeronKoAndarBithao(node);
    const doc = printDoc(chhapneWala, naam, khada, css);
    const r = await P.pdfBanao({ html: doc, naam, khada });
    return { native: true, kahan: r?.kahan || "Downloads", panne: r?.panne };
  }
  await chhapoNode(node, { naam, khada, css });
  return { native: false };
}

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
    s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error("XLSX nahi mili")));
    s.onerror = () => { xlsxWaada = null; rej(new Error("xlsx.full.min.js load nahi hui")); };
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
    return { theek: false, kyun: "Excel library nahi mili — page reload karke dobara dekhein" };
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
    if (headers.length) ws["!freeze"] = { xSplit: 0, ySplit: 1 };

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
    return { theek: false, kyun: e?.message || "Excel banate waqt dikkat aayi" };
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
