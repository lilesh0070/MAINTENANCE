/* upperCaret.js — "type karte hi BADE AKSHAR" wali dikkat ka hal.
 *
 * DIKKAT KYA THI
 * --------------
 * Slip ke box me `onChange={e => set(e.target.value.toUpperCase())}` likha tha.
 * Jab aap lafz ke BEECH me kuch likhte the:
 *
 *   1. browser ne DOM me chhota akshar daal diya  ->  "abcXdef"
 *   2. hamne state me BADA bhej diya              ->  "ABCXDEF"
 *   3. React ne dekha ki DOM aur state alag hain, to usne poori value
 *      dobara likh di — aur value dobara likhte hi browser caret ko
 *      SEEDHA AAKHIR me pheink deta hai.
 *
 * Isliye pehla akshar to beech me chala jaata tha, par uske baad caret
 * aakhir me pahunch jaata aur baaki sab aakhir me judta chala jaata.
 *
 * HAL
 * ---
 * React ke likhne se PEHLE hum khud DOM me bada-akshar wali value daal
 * dete hain aur caret wahin rakh dete hain jahan tha.  Ab React jab
 * milaan karega to DOM aur state ek jaise milenge — wo kuch likhega hi
 * nahi, aur caret jahan hai wahin rahega.
 *
 * ISTEMAL
 * -------
 *   onChange={(e) => set("field", upperCaret(e))}
 *
 * Yaani jahan pehle `e.target.value.toUpperCase()` tha, wahan `upperCaret(e)`.
 * Lautata wahi bada-akshar wali value hai, to baaki code waisa hi rehta hai.
 */
export function upperCaret(e) {
  const el = e.target;
  const up = String(el.value || "").toUpperCase();
  if (up !== el.value) {
    // caret ki jagah pehle yaad kar lo — value badalte hi ye khatam ho jaati hai
    const pos = el.selectionStart;
    el.value = up;
    // number/date/email jaise input par setSelectionRange chalta hi nahi —
    // wahan chup-chaap chhod dena hi theek hai, warna poora handler mar jaata.
    try { el.setSelectionRange(pos, pos); } catch { /* is input par nahi chalta */ }
  }
  return up;
}

/* maskCaret — wahi dikkat, par un khaano ke liye jinme MASK lagta hai.
 *
 * KYUN ALAG HELPER
 * ----------------
 * `upperCaret` sirf tab kaam karta hai jab value ka SIRF case badalta ho.
 * Spare "ERP No." jaisa khaana alag hai: uska formatter (`fmtErp`) akshar
 * GIRA bhi deta hai — pehle chaar sirf A-Z, agle chaar sirf 0-9, baaki sab
 * hataa diye jaate hain.
 *
 * To lafz ke beech me kuch type karne par value ki lambai hi badal jaati
 * hai, React poori value dobara likhta hai, aur caret aakhir me chala jaata
 * hai — bilkul wahi shikayat.
 *
 * CARET KI NAYI JAGAH KAISE NIKALI
 * --------------------------------
 * Caret se PEHLE wale hisse ko usi formatter se guzaar dete hain, aur uski
 * lambai hi nayi jagah hai.  Ye isliye chalta hai ki formatter baayen se
 * daayen chalta hai aur har akshar ka faisla sirf "ab tak kitne bane" par
 * hota hai — yaani aadhe text ka natija poore text ke natije ka shuruati
 * hissa hi hota hai.
 *
 * ISTEMAL
 *   onChange={(e) => setSpare(i, "spare_cnmm_no", maskCaret(e, fmtErp))}
 */
export function maskCaret(e, fmt) {
  const el = e.target;
  const raw = String(el.value || "");
  const naya = fmt(raw);
  if (naya !== raw) {
    const tha = el.selectionStart;
    // caret se pehle ka hissa formatter se guzaar kar naapo
    const pos = fmt(raw.slice(0, tha == null ? raw.length : tha)).length;
    el.value = naya;
    try { el.setSelectionRange(pos, pos); } catch { /* is input par nahi chalta */ }
  }
  return naya;
}
