// phone-check.js -- app ke kisi bhi page par ek saath saat jaanch.
//
// CHALANE KA TAREEQA (emulator me chalti app par):
//   .\emu-cdp.ps1 -Js (Get-Content .\phone-check.js -Raw)
//
// KYA-KYA DEKHTA HAI
//   chhupa            cheezein jo daayein screen se bahar hain aur
//                     scroll karke bhi nahi milti
//   dabbeSeBahar      text jo apne dabbe se BAHAR chhap raha hai
//   screenSeBahar     text jo screen se bahar hai
//   chartOverlap      chart ke label jo ek doosre ke UPAR chhap rahe hain
//   usernameDikhRahaHai   app me username dikhna nahi chahiye
//   lambaiSeBahar     pakki height wale dabbe jinka content neeche nikla
//   textTakrav        TOPBAR ke andar do cheezein ek doosre ke UPAR
//   logoGearTakrav    koi button/title app ke LOGO ya GEAR ke neeche
//   chaudaiTheek      page ki chaudai screen se zyada to nahi
//
// CHAAR SEEKH JO IS FILE ME BAITHI HAIN (har ek ek galti se aayi):
//   1. scroll ke dabbe ka content "chhupa" NAHI hai -- ek baar isi galti se
//      ANDON ko bigaad diya tha aur 4 bekaar rule likh diye the.
//   2. `overflow: hidden` ke peeche SAJAWAT chhupe to theek, par BUTTON ya
//      text chhupe to ASLI bug -- Skill Upgradation ka Save button isi
//      dheelai se ek baar chhoot gaya tha.
//   3. purvaj dekhte waqt PEHLE overflow par rukna galat hai -- chart ke
//      andar `hidden` node hota hai jabki us se bahar wala dabba scroll
//      karta hai.  Saare purvaj dekho.
//   4. username ginte waqt LEAF dekho aur `offsetParent` dekho -- chhupe
//      hue span ke maa-baap ka textContent bhi "DEMO" lautata hai, aur
//      band slide-nav ka naam x=-187 par pada rehta hai.
//
//   5. takrav-jaanch SIRF topbar tak rakhi hai.  Poore page par chalayi to
//      17/17 page jhooth me fail hue -- gear aur AI ka button jaan-boojh kar
//      content ke upar tairte hain, aur band drawer ke item bhi "takrate"
//      gine jaate hain.  Asli dikkat topbar me hi mili thi (Deviations par
//      title aur "Signed in as DEMO" pill 69px overlap).
//
//   6. TAB kholna mat bhoolna.  Har page ka sirf pehla view dekhna kaafi
//      nahi -- ANDON ke 7, PM ke 6, Historical ke 8, Document Update ke 5
//      tab hain.  Aur kuch view button dabane par hi khulte hain (KPI ka
//      Annual Index) -- wahin Back button logo ke neeche mila tha.
//
// AUR SABSE BADI SEEKH: ye jaanch paas ho jaana KAAFI NAHI hai.
// Har baar SCREENSHOT dekhna -- `select` ka text chup-chaap katta hai,
// dropdown ka teer ~25px leta hai, aur chart ke label ka takrana bhi
// pehli baar aankh ne hi pakda tha.
(() => {
  const W = document.documentElement.clientWidth;
  const nav = e => !!e.closest('[class*="slide"], [class*="drawer"], nav');

  // Kaata hua content GALTI NAHI hai jab wo jaan-boojh kar kaata gaya ho:
  //  - kisi purvaj me overflow-x auto/scroll  -> scroll karke mil jaata hai
  //  - kisi purvaj me overflow hidden          -> design hi clip karna hai (bar/track)
  // kaam ki cheez = jispar click/type hota hai, ya jisme text hai
  const kaamKi = e =>
    /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(e.tagName) ||
    e.querySelector("button,input,select,textarea,a") !== null ||
    (e.textContent || "").trim().length > 0;

  const dhaka = e => {
    // PEHLE ke overflow purvaj par ruk jaana galat tha: chart ke andar ek
    // SVG node `hidden` hota hai, jabki us se BAHAR `.ba-chartwrap` scroll
    // karta hai -- cheez pahunch me hai.  Isliye SAARE purvaj dekho.
    let hiddenMila = false;
    for (let p = e.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p);
      if (c.overflowX === "auto" || c.overflowX === "scroll") return true;  // scroll = mil jaayegi
      if (c.overflowX === "hidden" || c.overflow === "hidden") hiddenMila = true;
    }
    // koi scroll nahi mila.  hidden ne kaata -> sajawat ho to theek,
    // par BUTTON/text chhupe to ASLI bug (Upgradation ka Save aise hi chhoot gaya tha).
    return hiddenMila ? !kaamKi(e) : false;
  };
  //  - khud par text-overflow: ellipsis -> "..." dikhana design hai
  const ellipsis = e => {
    const c = getComputedStyle(e);
    return c.textOverflow === "ellipsis" && (c.overflow === "hidden" || c.overflowX === "hidden");
  };

  const rg = document.createRange();

  const chhupa = [...document.querySelectorAll("body *")].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > W + 1 && !dhaka(e) && !nav(e);
  });

  const dabbeSe = [], screenSe = [];
  document.querySelectorAll("body *").forEach(e => {
    if (!e.childNodes.length || [...e.childNodes].some(n => n.nodeType === 1)) return;
    if (!e.textContent.trim() || nav(e) || ellipsis(e)) return;
    rg.selectNodeContents(e);
    const t = rg.getBoundingClientRect(), b = e.getBoundingClientRect();
    if (b.width > 0 && t.width > b.width + 2) dabbeSe.push(e.textContent.trim().slice(0, 24));
    if (t.right > W + 1 && !dhaka(e)) screenSe.push(e.textContent.trim().slice(0, 24));
  });

  const ov = (a, b) => !(a.right <= b.left + .5 || b.right <= a.left + .5 ||
                         a.bottom <= b.top + .5 || b.bottom <= a.top + .5);

  // chart ke tick label aapas me takra rahe hain kya
  // (`ov` upar hi declare ho chuki hai)
  let chartOverlap = 0, chartCount = 0;
  document.querySelectorAll("svg").forEach(svg => {
    const bx = [...svg.querySelectorAll(".recharts-cartesian-axis-tick-value")]
      .map(t => t.getBoundingClientRect()).filter(r => r.width > 0);
    if (!bx.length) return;
    chartCount++;
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++)
      if (ov(bx[i], bx[j])) chartOverlap++;
  });

  // HEADER ke andar text-takrav.  Poore page par ye jaanch bekaar hai:
  // ⚙ gear aur 🤖 button jaan-boojh kar content ke UPAR tairte hain, aur
  // band drawer ke item bhi "takrate" gine jaate hain -- ek baar maine aisi
  // hi khuli jaanch chalayi aur 17/17 page jhooth me fail ho gaye.
  // Isliye sirf wahi dekho jahan asli dikkat mili thi: topbar ke andar
  // do alag cheezein ek doosre ke upar (Deviations par title aur
  // "Signed in as DEMO" pill 69px overlap kar rahe the).
  const dikhta = e => { const c = getComputedStyle(e);
    return c.display !== "none" && c.visibility !== "hidden" && +c.opacity > 0.05; };
  const takrav = [];
  document.querySelectorAll('[class*="-top"], [class*="topbar"]').forEach(bar => {
    const br = bar.getBoundingClientRect();
    if (br.top > 140 || br.height < 20 || br.height > 200) return;   // sirf upar wali patti
    const kids = [...bar.querySelectorAll('*')].filter(e => {
      const c = getComputedStyle(e), r = e.getBoundingClientRect();
      if (c.position === 'fixed') return false;             // tairte button chhod do
      return e.textContent.trim() && dikhta(e) && r.width > 0 && r.height > 0;
    });
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const A = kids[i], B = kids[j];
      if (A.contains(B) || B.contains(A)) continue;
      const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
      // 4px se kam ka chhoona line-box ka mamool hai, galti nahi
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 4 && y > 4)
        takrav.push(A.textContent.trim().slice(0, 16) + ' <> ' + B.textContent.trim().slice(0, 16) + ' (' + Math.round(x) + 'px)');
    }
  });
  // APP KA LOGO (upar-baayein) aur GEAR (upar-daayein) sab page par tairte
  // hain.  Topbar par 52/60 padding isi liye hai.  Jis view ka header us
  // list me nahi hota, wahan button logo ke NEECHE chala jaata hai --
  // KPI -> Annual Index par yahi hua (Back button x=26, logo x=8-44).
  const chhotaSa = e => { const r = e.getBoundingClientRect(); return r.width < 260 && r.height < 90; };
  const tairte = [...document.querySelectorAll('body *')].filter(e => {
    const c = getComputedStyle(e), r = e.getBoundingClientRect();
    return c.position === 'fixed' && r.top < 70 && r.width > 25 && r.width < 90 && r.height > 25 && r.height < 90;
  });
  const logoGearTakrav = [];
  tairte.forEach(t => {
    const tr = t.getBoundingClientRect();
    document.querySelectorAll('button, a, input, select, [class*="back"], [class*="title"]').forEach(e => {
      if (e === t || t.contains(e) || e.contains(t) || nav(e)) return;
      if (getComputedStyle(e).position === 'fixed') return;   // doosra tairta hua nahi
      if (!chhotaSa(e)) return;
      const r = e.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) return;
      const x = Math.min(r.right, tr.right) - Math.max(r.left, tr.left);
      const y = Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top);
      if (x > 3 && y > 3)
        logoGearTakrav.push((e.textContent || '').trim().slice(0, 18) + ' (' + Math.round(x) + 'px)');
    });
  });

  const uname = [...document.querySelectorAll("span,div")].filter(s => {
    if (s.children.length) return false;
    if (!/^(DEMO|Administrator)$/i.test(s.textContent.trim())) return false;
    if (s.offsetParent === null || getComputedStyle(s).display === "none") return false;
    const r = s.getBoundingClientRect();
    return r.width > 0 && r.left >= -1 && r.right <= W + 1 && r.top >= -1 && !nav(s);
  }).length;

  const lambaiSe = [];
  document.querySelectorAll("body *").forEach(e => {
    const cs = getComputedStyle(e);
    if (cs.overflowY !== "visible" || cs.height === "auto" || nav(e)) return;
    const r = e.getBoundingClientRect();
    if (r.height < 8 || r.height > 400) return;
    let d = 0, kya = "";
    e.querySelectorAll("*").forEach(k => {
      const kr = k.getBoundingClientRect();
      if (kr.height > 0 && kr.width > 0 && kr.bottom > r.bottom + 1) {
        const x = Math.round(kr.bottom - r.bottom);
        if (x > d) { d = x; kya = k.textContent.trim().slice(0, 22); }
      }
    });
    if (d > 1) lambaiSe.push(((e.className || "").toString().slice(0, 18) || e.tagName) + " +" + d + "px : " + kya);
  });

  return {
    page: location.pathname,
    chhupa: chhupa.length,
    chhupaKya: chhupa.slice(0, 4).map(e => (e.className || "").toString().slice(0, 22) + " +" +
                                           Math.round(e.getBoundingClientRect().right - W)),
    dabbeSeBahar: dabbeSe.slice(0, 5),
    screenSeBahar: screenSe.slice(0, 5),
    chart: chartCount, chartOverlap,
    textTakrav: [...new Set(takrav)].slice(0, 5),
    logoGearTakrav: [...new Set(logoGearTakrav)].slice(0, 4),
    usernameDikhRahaHai: uname,
    lambaiSeBahar: lambaiSe.slice(0, 3),
    pageW: document.body.scrollWidth, viewW: W,
    chaudaiTheek: document.body.scrollWidth <= W + 1
  };
})()
