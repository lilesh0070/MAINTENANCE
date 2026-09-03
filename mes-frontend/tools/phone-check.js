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
  let chartOverlap = 0, chartCount = 0;
  document.querySelectorAll("svg").forEach(svg => {
    const bx = [...svg.querySelectorAll(".recharts-cartesian-axis-tick-value")]
      .map(t => t.getBoundingClientRect()).filter(r => r.width > 0);
    if (!bx.length) return;
    chartCount++;
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++)
      if (ov(bx[i], bx[j])) chartOverlap++;
  });

  // sirf wahi username gino jo SACH ME screen par dikh raha ho.
  // (band slide-nav ka naam x=-187 par pada rehta hai -- wo galti nahi.)
  // Sirf wahi ginna jo SACH ME chhap raha ho:
  //  - element khud dikh raha ho (offsetParent) -- app-user par display:none laga hai
  //  - LEAF ho -- warna uske maa-baap div ka textContent bhi "DEMO" lautata hai
  //    aur chhupe hue span ke liye jhootha alarm aata hai
  //  - screen ke andar ho -- band slide-nav ka naam x=-187 par pada rehta hai
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
    usernameDikhRahaHai: uname,
    lambaiSeBahar: lambaiSe.slice(0, 3),
    pageW: document.body.scrollWidth, viewW: W,
    chaudaiTheek: document.body.scrollWidth <= W + 1
  };
})()
