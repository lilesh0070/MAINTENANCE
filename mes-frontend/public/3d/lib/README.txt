3D View -- local libraries (2026-09-21)
========================================

Plant ka LAN internet se kata hai, isliye 3D page (../cylinder.html) ki
teeno library yahin rakhi hain.  Asal file (D:/3d/cylinder.html) inhe CDN
se laati thi; sirf wo 3 link badle hain, baaki code jyon ka tyon.

three/three.module.min.js                  three@0.169.0  (cdn.jsdelivr.net, sha256 jsdelivr se milaya)
three/addons/controls/OrbitControls.js     three@0.169.0  examples/jsm
three/addons/environments/RoomEnvironment.js  three@0.169.0  examples/jsm
fontawesome/css/all.min.css                Font Awesome 6.4.0 (cdnjs, sha512 SRI milaya)
fontawesome/webfonts/fa-solid-900.woff2    sirf "solid" -- page me wahi icon hain
tailwind.css                               Tailwind v3.4.19 se PEHLE SE BANI CSS (play CDN nahi)

tailwind.css sirf wahi class rakhti hai jo ../*.html me likhi hain.
Kisi 3D page me nayi class jodo (ya naya 3D page lagao) to dobara banao:

  npm i -D tailwindcss@3        (kisi alag folder me, project me nahi)
  tailwind.config.js:  module.exports = { content: ["<ye folder>/../*.html"] };
  in.css:              @tailwind base; @tailwind components; @tailwind utilities;
  npx tailwindcss -c tailwind.config.js -i in.css -o tailwind.css --minify

Naya 3D model lagana: HTML ../ me rakho, uske CDN link yahan ki files par
karo, aur src/pages/ThreeDView.jsx ki MODELS list me ek line jodo.
