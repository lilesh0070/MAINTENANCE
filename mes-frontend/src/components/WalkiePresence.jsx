/* WalkiePresence.jsx — koi UI nahi, sirf "main online hoon" wala kaam.
 *
 * `Layout` me baithta hai, yaani HAR page par.  Kaam sirf itna:
 *   1. Poochho ki is user ko admin ne walkie par joda hai ya nahi
 *   2. Joda ho to socket chalu kar do (aur phone par Java ki service bhi)
 *
 * KYUN ZAROORI HAI
 * ----------------
 * Pehle ye kaam Walkie ke PAGE me hota tha.  Isliye banda tabhi "online"
 * dikhta tha jab wo wahi page khole baitha ho — kisi aur page par jaate hi
 * doosron ko offline lagne lagta tha, jabki app khuli hi hoti thi.  Ab jaise
 * hi app khulti hai (chahe koi bhi page ho), wo online ho jaata hai.
 *
 * Jinhe admin ne joda hi nahi, unke liye ye kuch nahi karta — na socket, na
 * service, na koi permission ka parda.
 */
import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { walkieLink, walkieWsBase } from "../constants/walkieLink";
import { walkieNative } from "../constants/walkieNative";

export default function WalkiePresence() {
  const { token } = useAuth();

  useEffect(() => {
    if (!token) { walkieLink.stop(); return undefined; }
    let ruk = false;
    let ghadi = null;

    (async () => {
      // Jude hue hain ya nahi — ye poochhe bina socket kholna bekaar hai,
      // server waise bhi 4403 de kar band kar dega.
      let mera = false;
      try {
        const r = await fetch("/api/walkie/roster", { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) mera = !!(await r.json())?.me?.enabled;
      } catch { /* server band ho to chup rah jao — baaki app chalti rahe */ }
      if (ruk || !mera) return;

      walkieLink.start(token);

      if (walkieNative.hai()) {
        /* Phone par sunne ka kaam service ka hai — page ko bajane se rok do,
           warna ek hi aawaz do baar aati hai.  Service kabhi mar jaye to
           `running` false ho jaata hai aur page khud bajane lagta hai. */
        const taaza = () => walkieNative.status()
          .then((s) => { if (!ruk) walkieLink.setPlayHere(!s?.running); })
          .catch(() => {});
        await walkieNative.requestPerms().catch(() => {});
        await walkieNative.start(walkieWsBase(), token).catch(() => {});
        taaza();
        ghadi = setInterval(taaza, 8000);
      }
    })();

    return () => { ruk = true; if (ghadi) clearInterval(ghadi); };
  }, [token]);

  return null;
}
