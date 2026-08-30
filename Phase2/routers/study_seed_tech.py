"""
routers/study_seed_tech.py
==========================
Study Material ka SEED content — part 2: machine ke parts aur systems
(Sensors, Pneumatic, Hydraulic, Electrical, Control/PLC-HMI, Mechanical,
Safety).

Har topic ka dhancha:  (category, title, body_en, body_hi)

Har topic ke aakhir me "COMMON FAULTS" jaan-boojh kar rakha hai — padhne
wala aksar kisi dikkat ke waqt hi yahan aata hai, to seedhe kaam ki baat
mil jaye.

Seed sirf pehli baar chalta hai (table bilkul khali ho tab).  Uske baad
admin page se hi sab kuch badalta hai — is file ko chhune ki zaroorat nahi.
"""

TECH = [
    # ── Sensors ─────────────────────────────────────────────────────────
    ("Sensors", "What is a Sensor?",
     "A sensor is a device that senses something on the machine - a part "
     "present, a cylinder at the end, a level, a pressure, a temperature - and "
     "sends the PLC a simple ON/OFF (or a value).\n\n"
     "Most machine sensors are 24V DC and have 3 wires: brown (+24V), blue "
     "(0V) and black (signal).\n\n"
     "PNP type switches the SIGNAL to +24V when it senses. NPN switches it to "
     "0V. Fitting the wrong type is a very common mistake - the sensor light "
     "glows but the PLC input never comes ON.\n\n"
     "COMMON FAULTS: dirty face, sensing distance too far, loose connector, "
     "cable broken at the drag chain, wrong PNP/NPN type.",
     "Sensor wo device hai jo machine par kuch mehsoos karta hai - part aaya "
     "ya nahi, cylinder end par pahuncha ya nahi, level, pressure, temperature "
     "- aur PLC ko ek simple ON/OFF (ya value) bhej deta hai.\n\n"
     "Zyadatar machine sensor 24V DC ke hote hain aur unme 3 taar hote hain: "
     "brown (+24V), blue (0V) aur black (signal).\n\n"
     "PNP type sense karne par SIGNAL ko +24V par le jaata hai. NPN use 0V par "
     "le jaata hai. Galat type laga dena bahut aam galti hai - sensor ki light "
     "jalti hai par PLC ka input kabhi ON hi nahi hota.\n\n"
     "AAM DIKKAT: sensor ka face gandha, sensing distance zyada door, connector "
     "dheela, drag chain me cable toota, galat PNP/NPN type."),

    ("Sensors", "Proximity Sensor (Inductive)",
     "An inductive proximity sensor detects METAL without touching it. It is "
     "the most used sensor on our machines - to confirm a cylinder position, a "
     "fixture closed, or a metal part present.\n\n"
     "It only senses metal. Sensing distance is small (usually 2-8 mm) and it "
     "REDUCES for non-ferrous metal like aluminium or brass - roughly half for "
     "aluminium compared to mild steel.\n\n"
     "COMMON FAULTS: gap increased due to loosening or vibration, metal chips "
     "stuck on the face, sensor knocked out of position by the part, water/oil "
     "ingress in the connector.",
     "Inductive proximity sensor bina chhue METAL ko pakadta hai. Apni machinon "
     "par sabse zyada isi ka istemal hota hai - cylinder ki position confirm "
     "karne, fixture band hua ya nahi, ya metal part hai ya nahi.\n\n"
     "Ye sirf metal ko pakadta hai. Sensing distance kam hoti hai (aam taur par "
     "2-8 mm) aur aluminium/brass jaise non-ferrous metal par ye aur GHAT jaati "
     "hai - mild steel ke muqable aluminium par lagbhag aadhi.\n\n"
     "AAM DIKKAT: dheela hone ya vibration se gap badh jana, face par metal ke "
     "chips chipak jana, part ki chot se sensor apni jagah se hat jana, "
     "connector me paani/oil chala jana."),

    ("Sensors", "Capacitive Sensor",
     "A capacitive sensor detects almost ANY material - plastic, water, oil, "
     "powder, wood - not just metal. It is used for level detection in tanks "
     "and hoppers, and for non-metal parts.\n\n"
     "Because it senses everything, it is also easily fooled: dust, moisture or "
     "an oil film on the face can hold it ON. Most have a small sensitivity "
     "screw to set the trip point.\n\n"
     "COMMON FAULTS: sensitivity set too high, condensation or oil film on the "
     "face, wrong material in front of it, temperature drift.",
     "Capacitive sensor lagbhag HAR cheez pakadta hai - plastic, paani, oil, "
     "powder, lakdi - sirf metal nahi. Iska istemal tank/hopper me level dekhne "
     "aur non-metal parts ke liye hota hai.\n\n"
     "Kyunki ye sab kuch pakadta hai, isliye aasani se dhokha bhi kha jaata hai: "
     "dhool, nami ya face par oil ki parat ise ON hi rakh sakti hai. Zyadatar me "
     "ek chhota sensitivity screw hota hai jisse trip point set kiya jaata hai.\n\n"
     "AAM DIKKAT: sensitivity zyada set ho jana, face par nami ya oil ki parat, "
     "saamne galat material aa jana, temperature se drift."),

    ("Sensors", "Photoelectric Sensor",
     "A photoelectric sensor works on light. Three common types:\n\n"
     "THROUGH BEAM - transmitter one side, receiver the other. Longest range, "
     "most reliable.\n"
     "RETRO-REFLECTIVE - sensor and a reflector; beam goes and comes back.\n"
     "DIFFUSE - sensor alone; light bounces off the part itself. Shortest "
     "range, most affected by part colour and surface.\n\n"
     "COMMON FAULTS: lens or reflector dirty, alignment disturbed, a shiny part "
     "reflecting when it should not, strong ambient light, black/matt parts not "
     "reflecting enough for a diffuse type.",
     "Photoelectric sensor roshni par kaam karta hai. Teen aam type:\n\n"
     "THROUGH BEAM - ek taraf transmitter, doosri taraf receiver. Sabse lambi "
     "range, sabse bharose ka.\n"
     "RETRO-REFLECTIVE - sensor aur ek reflector; beam jaakar wapas aati hai.\n"
     "DIFFUSE - akela sensor; roshni part se hi takra kar lautti hai. Sabse "
     "chhoti range, aur part ke rang/surface ka sabse zyada asar.\n\n"
     "AAM DIKKAT: lens ya reflector gandha, alignment hil jana, chamakdaar part "
     "ka bewajah reflection, tez ambient light, diffuse type par kaale/matt part "
     "ka theek se reflect na karna."),

    ("Sensors", "Limit Switch",
     "A limit switch is a mechanical switch operated by a lever, roller or "
     "plunger that the moving part physically pushes. Simple and cheap, and it "
     "gives a definite contact - which is why it is still used for safety and "
     "end-of-travel positions.\n\n"
     "It has NO (normally open) and NC (normally closed) contacts. Safety "
     "circuits normally use the NC contact, so a broken wire also trips the "
     "circuit.\n\n"
     "COMMON FAULTS: worn or bent lever, contact burnt or oxidised, mounting "
     "loose so the actuation point shifted, water inside the body.",
     "Limit switch ek mechanical switch hai jise lever, roller ya plunger se "
     "chalta hua part khud dabata hai. Simple aur sasta, aur ye pakka contact "
     "deta hai - isiliye aaj bhi safety aur end-of-travel ke liye chalta hai.\n\n"
     "Isme NO (normally open) aur NC (normally closed) contact hote hain. Safety "
     "circuit me aam taur par NC contact lagta hai, taaki taar toot jaye to bhi "
     "circuit trip ho jaye.\n\n"
     "AAM DIKKAT: lever ghis jana ya mud jana, contact jal jana ya kaala pad "
     "jana, mounting dheela hone se dabne ka point khisak jana, body me paani."),

    ("Sensors", "Reed Switch (Cylinder Sensor)",
     "A reed switch is the small sensor clamped on the OUTSIDE of a pneumatic "
     "cylinder barrel. The piston inside carries a magnet; when it comes near, "
     "the reed contacts close and the PLC knows the cylinder reached that "
     "end.\n\n"
     "Every automatic cylinder normally has two - one for home, one for work "
     "position.\n\n"
     "COMMON FAULTS: clamp loosened by vibration so the switch slid along the "
     "barrel, LED glows but contact welded, cable damaged where it bends, and "
     "cylinder speed so high that the magnet passes before the switch responds.",
     "Reed switch wo chhota sensor hai jo pneumatic cylinder ki barrel ke BAHAR "
     "clamp se laga hota hai. Andar piston par magnet hota hai; jab wo paas aata "
     "hai to reed ka contact jud jaata hai aur PLC ko pata chal jaata hai ki "
     "cylinder us end tak pahunch gaya.\n\n"
     "Har automatic cylinder par aam taur par do hote hain - ek home ke liye, ek "
     "work position ke liye.\n\n"
     "AAM DIKKAT: vibration se clamp dheela hokar switch barrel par khisak jana, "
     "LED jalti hai par contact chipak (weld) gaya, jhukne wali jagah par cable "
     "kharab, aur cylinder itni tez ki magnet switch ke response se pehle hi "
     "nikal jaye."),

    ("Sensors", "Pressure Switch",
     "A pressure switch watches air or oil pressure and gives an ON/OFF signal "
     "when the pressure crosses a set point. It is what stops the machine from "
     "running on low air.\n\n"
     "Do not confuse it with a pressure TRANSMITTER, which sends a continuous "
     "value (4-20 mA or 0-10 V) instead of ON/OFF.\n\n"
     "COMMON FAULTS: set point drifted, diaphragm damaged, port choked with "
     "dirt or moisture, and the switch reading fine while the actual problem is "
     "a leak downstream keeping real pressure low.",
     "Pressure switch hawa ya oil ka pressure dekhta hai aur set point paar hone "
     "par ON/OFF signal deta hai. Kam hawa par machine ko chalne se yahi rokta "
     "hai.\n\n"
     "Ise pressure TRANSMITTER se mat milaiye - transmitter ON/OFF ke bajaye "
     "lagataar value bhejta hai (4-20 mA ya 0-10 V).\n\n"
     "AAM DIKKAT: set point khisak jana, diaphragm kharab, port me gandagi ya "
     "nami se choking, aur switch to theek padh raha ho par asli dikkat aage "
     "kahin leakage ho jo pressure girata rehta hai."),

    ("Sensors", "Encoder",
     "An encoder converts movement into pulses so the PLC can measure position "
     "or speed. A rotary encoder on a shaft, or a linear scale on a slide.\n\n"
     "INCREMENTAL type only sends pulses - position is counted from a home "
     "reference, so it must be homed after every power off.\n"
     "ABSOLUTE type sends the actual position, so homing is not needed.\n\n"
     "COMMON FAULTS: coupling loose or slipping so counts drift, cable "
     "screening broken causing noise and wrong counts, home sensor faulty so "
     "homing itself is wrong, dirt on a linear scale.",
     "Encoder movement ko pulses me badal deta hai, taaki PLC position ya speed "
     "naap sake. Shaft par rotary encoder, ya slide par linear scale.\n\n"
     "INCREMENTAL type sirf pulses bhejta hai - position home reference se gini "
     "jaati hai, isliye har power off ke baad homing zaroori hai.\n"
     "ABSOLUTE type asli position bhejta hai, isliye homing ki zaroorat nahi.\n\n"
     "AAM DIKKAT: coupling dheela ya slip hone se count khisak jana, cable ki "
     "shielding toot jane se noise aur galat count, home sensor kharab hone se "
     "homing hi galat, linear scale par gandagi."),

    # ── Pneumatic ───────────────────────────────────────────────────────
    ("Pneumatic", "What is a Pneumatic System?",
     "A pneumatic system uses COMPRESSED AIR to do work - clamping, pushing, "
     "lifting, blowing.\n\n"
     "The path is always the same: compressor -> receiver tank -> main line -> "
     "FRL unit -> solenoid valve -> cylinder.\n\n"
     "Air is clean, cheap and safe, but it is COMPRESSIBLE - so pneumatic "
     "motion is springy and cannot hold an exact mid position or a very high "
     "force. That is where hydraulics is used instead.\n\n"
     "Typical machine line pressure is around 5-6 bar.\n\n"
     "COMMON FAULTS: low line pressure, leakage, water in the line, choked "
     "filter.",
     "Pneumatic system DABAAI HUI HAWA se kaam karta hai - clamping, dhakkna, "
     "uthana, blowing.\n\n"
     "Raasta hamesha ek hi hota hai: compressor -> receiver tank -> main line -> "
     "FRL unit -> solenoid valve -> cylinder.\n\n"
     "Hawa saaf, sasti aur safe hai, par ye DABTI hai - isliye pneumatic "
     "movement thodi springy hoti hai aur beech me exact position ya bahut zyada "
     "force nahi rok sakti. Wahan hydraulic ka istemal hota hai.\n\n"
     "Machine line ka aam pressure lagbhag 5-6 bar hota hai.\n\n"
     "AAM DIKKAT: line pressure kam, leakage, line me paani, filter choke."),

    ("Pneumatic", "Pneumatic Cylinder",
     "A cylinder converts air pressure into straight-line movement. Air pushes "
     "the piston, the rod moves out or in.\n\n"
     "SINGLE ACTING - air on one side, a spring returns it.\n"
     "DOUBLE ACTING - air on both sides, powered both ways. Almost all machine "
     "cylinders are double acting.\n\n"
     "Force depends on bore size and pressure, not on the flow. Speed depends "
     "on flow, which is set by the speed-control (flow control) fittings on the "
     "ports.\n\n"
     "COMMON FAULTS: seal worn so it leaks and loses force, rod bent from side "
     "load, cushion screw wrongly set causing banging at ends, mounting bolts "
     "loose, speed control choked or fully opened.",
     "Cylinder hawa ke pressure ko seedhi line ki movement me badalta hai. Hawa "
     "piston ko dhakelti hai aur rod bahar ya andar jaata hai.\n\n"
     "SINGLE ACTING - ek taraf hawa, wapas spring laata hai.\n"
     "DOUBLE ACTING - dono taraf hawa, dono taraf taakat se chalta hai. Machine "
     "ke lagbhag saare cylinder double acting hi hote hain.\n\n"
     "Force bore ke size aur pressure par depend karta hai, flow par nahi. Speed "
     "flow par depend karti hai, jo port par lage speed-control (flow control) "
     "se set hoti hai.\n\n"
     "AAM DIKKAT: seal ghis jane se leakage aur force kam, side load se rod mud "
     "jana, cushion screw galat set hone se end par thok, mounting bolt dheele, "
     "speed control choke ya poora khula."),

    ("Pneumatic", "Solenoid Valve",
     "A solenoid valve is the electrical switch for air. The PLC energises the "
     "coil, the spool shifts, and air is sent to one side of the cylinder.\n\n"
     "5/2 valve - 5 ports, 2 positions. The normal valve for a double acting "
     "cylinder.\n"
     "SINGLE SOLENOID returns by spring when de-energised; DOUBLE SOLENOID "
     "stays where it was until the other coil is energised.\n\n"
     "Every valve has a MANUAL OVERRIDE button - very useful to check whether "
     "the fault is electrical or pneumatic.\n\n"
     "COMMON FAULTS: coil burnt, spool stuck due to dirt or no lubrication, no "
     "24V reaching the coil, silencer on the exhaust port choked (cylinder "
     "becomes slow or does not return).",
     "Solenoid valve hawa ka electrical switch hai. PLC coil ko supply deta hai, "
     "spool khisakta hai, aur hawa cylinder ki ek taraf chali jaati hai.\n\n"
     "5/2 valve - 5 port, 2 position. Double acting cylinder ke liye aam valve.\n"
     "SINGLE SOLENOID supply hatne par spring se wapas aa jaata hai; DOUBLE "
     "SOLENOID wahin ruka rehta hai jab tak doosri coil ko supply na mile.\n\n"
     "Har valve par ek MANUAL OVERRIDE button hota hai - ye jaanchne ke liye "
     "bahut kaam ka hai ki dikkat electrical hai ya pneumatic.\n\n"
     "AAM DIKKAT: coil jal jana, gandagi ya lubrication na hone se spool "
     "atak jana, coil tak 24V na pahunchna, exhaust port ka silencer choke "
     "(cylinder dheema ho jata hai ya wapas nahi aata)."),

    ("Pneumatic", "FRL Unit (Filter - Regulator - Lubricator)",
     "The FRL is the air preparation unit at the machine inlet. Three parts:\n\n"
     "FILTER - removes dust and water. Its bowl must be drained.\n"
     "REGULATOR - sets and holds the machine pressure, shown on the gauge.\n"
     "LUBRICATOR - adds a fine oil mist for valves and cylinders (not used on "
     "oil-free systems).\n\n"
     "Most 'low pressure' complaints are simply a choked filter element or a "
     "full water bowl.\n\n"
     "COMMON FAULTS: filter element choked, auto-drain not working so water "
     "carries forward, regulator knob disturbed by someone, lubricator empty or "
     "dripping too fast.",
     "FRL machine ke inlet par lagi hawa taiyaar karne wali unit hai. Teen "
     "hisse:\n\n"
     "FILTER - dhool aur paani nikalta hai. Iska bowl khali karte rehna zaroori "
     "hai.\n"
     "REGULATOR - machine ka pressure set karke rakhta hai, gauge par dikhta "
     "hai.\n"
     "LUBRICATOR - valve aur cylinder ke liye baareek oil mist deta hai (oil-free "
     "system par nahi lagta).\n\n"
     "'Pressure kam hai' ki zyadatar shikayat asal me choke filter element ya "
     "bhara hua paani ka bowl hi hoti hai.\n\n"
     "AAM DIKKAT: filter element choke, auto-drain kaam na karna jisse paani "
     "aage chala jaye, kisi ne regulator ka knob ghuma diya, lubricator khali ya "
     "zyada tez tapak raha ho."),

    ("Pneumatic", "Air Pressure and Leakage",
     "Air leakage is the most expensive and most ignored loss in a plant. A "
     "leak does not stop the machine, so nobody reports it - but the compressor "
     "runs longer, and pressure drops when many cylinders work together.\n\n"
     "The right way to find leaks is in a silent shift: walk the line and "
     "listen, and check fittings with soap water.\n\n"
     "Watch for: pressure OK at the gauge but dropping during the cycle (a leak "
     "or an undersized pipe), and a cylinder that is slow only when other "
     "machines are running.",
     "Hawa ki leakage plant ka sabse mehnga aur sabse nazarandaaz kiya jaane "
     "wala nuksaan hai. Leakage se machine rukti nahi, isliye koi batata nahi - "
     "par compressor zyada der chalta hai, aur jab bahut se cylinder ek saath "
     "chalte hain to pressure gir jaata hai.\n\n"
     "Leakage dhoondhne ka sahi tareeqa khaali shift me hai: line ke saath "
     "chal kar suniye, aur fitting par sabun-paani laga kar dekhiye.\n\n"
     "Ispar nazar rakhiye: gauge par pressure theek par cycle ke dauran girta "
     "hua (leakage ya patli pipe), aur aisa cylinder jo sirf tab dheema hota hai "
     "jab doosri machine chal rahi hon."),

    ("Pneumatic", "Common Pneumatic Faults - quick checks",
     "CYLINDER DOES NOT MOVE: press the valve manual override. If it moves, the "
     "fault is electrical (no 24V / PLC output / coil). If it does not, the "
     "fault is pneumatic (no air, spool stuck, choked line).\n\n"
     "CYLINDER SLOW: speed control choked, silencer choked, low pressure, or "
     "worn seal.\n\n"
     "CYLINDER DOES NOT REACH END: low pressure, mechanical jam, or the part is "
     "not seated correctly.\n\n"
     "SIGNAL NOT COMING: reed switch position shifted, cable broken, or the "
     "cylinder truly did not reach the end.",
     "CYLINDER HILTA HI NAHI: valve ka manual override dabaiye. Hil gaya to "
     "dikkat electrical hai (24V nahi / PLC output nahi / coil). Nahi hila to "
     "dikkat pneumatic hai (hawa nahi, spool atka, line choke).\n\n"
     "CYLINDER DHEEMA: speed control choke, silencer choke, pressure kam, ya "
     "seal ghisa hua.\n\n"
     "CYLINDER END TAK NAHI JAATA: pressure kam, mechanical jam, ya part theek "
     "se baitha nahi hai.\n\n"
     "SIGNAL NAHI AA RAHA: reed switch apni jagah se khisak gaya, cable toota, "
     "ya cylinder sach me end tak pahuncha hi nahi."),

    # ── Hydraulic ───────────────────────────────────────────────────────
    ("Hydraulic", "What is a Hydraulic System?",
     "A hydraulic system uses OIL under pressure to do work. Oil does not "
     "compress, so hydraulics gives very high force and can hold a position "
     "steadily - which air cannot.\n\n"
     "The path: tank -> pump (driven by motor) -> pressure relief valve -> "
     "directional valve -> cylinder, and back to tank through the return "
     "filter.\n\n"
     "Working pressure is far higher than air - often 50 to 200 bar. That is "
     "why a hydraulic leak is a safety matter, not just a housekeeping one: a "
     "pinhole jet can cut skin.\n\n"
     "COMMON FAULTS: low oil level, hot oil, contaminated oil, choked filter, "
     "air in the system.",
     "Hydraulic system dabaav wale OIL se kaam karta hai. Oil dabta nahi, "
     "isliye hydraulic bahut zyada force deta hai aur position ko sthir rok "
     "sakta hai - jo hawa nahi kar sakti.\n\n"
     "Raasta: tank -> pump (motor se) -> pressure relief valve -> directional "
     "valve -> cylinder, aur return filter se hokar wapas tank me.\n\n"
     "Iska pressure hawa se kahin zyada hota hai - aksar 50 se 200 bar. Isiliye "
     "hydraulic leakage sirf safai ka nahi, SAFETY ka mamla hai: pinhole se "
     "nikalti patli dhaar chamdi kaat sakti hai.\n\n"
     "AAM DIKKAT: oil level kam, oil garam, oil gandha, filter choke, system me "
     "hawa."),

    ("Hydraulic", "Hydraulic Pump",
     "The pump is driven by the motor and pushes oil into the system. It "
     "creates FLOW; pressure is created by the resistance the flow meets, and "
     "is limited by the pressure relief valve setting.\n\n"
     "Common types on machines: gear pump (simple, fixed flow) and vane or "
     "piston pump (can be variable).\n\n"
     "COMMON FAULTS: noisy pump usually means it is sucking air or starving - "
     "check oil level, suction strainer and suction line joints. Also: coupling "
     "worn, wrong rotation direction after a motor rewind, and internal wear "
     "which shows up as low pressure and hot oil.",
     "Pump motor se chalta hai aur oil ko system me bhejta hai. Ye FLOW banata "
     "hai; pressure us rukawat se banta hai jo flow ko milti hai, aur pressure "
     "relief valve ki setting se seemit hota hai.\n\n"
     "Machinon par aam type: gear pump (simple, fixed flow) aur vane ya piston "
     "pump (variable ho sakta hai).\n\n"
     "AAM DIKKAT: pump ka shor aam taur par matlab hai ki wo hawa kheench raha "
     "hai ya oil kam pad raha hai - oil level, suction strainer aur suction line "
     "ke joint dekhiye. Aur: coupling ghisa hua, motor rewind ke baad ghoomne ki "
     "direction galat, aur andar ki ghisawat - jo kam pressure aur garam oil ke "
     "roop me dikhti hai."),

    ("Hydraulic", "Hydraulic Cylinder",
     "Same idea as a pneumatic cylinder, but with oil - so it gives far more "
     "force and holds position without springiness.\n\n"
     "Because pressure is high, seals matter much more. A worn piston seal lets "
     "oil pass INSIDE the cylinder, so the cylinder becomes slow or drifts down "
     "under load, even though there is no visible leak outside.\n\n"
     "COMMON FAULTS: rod seal leaking (oil on the rod), piston seal passing "
     "(loss of force, drifting), rod scored or rusted which then cuts the seal "
     "again, and air trapped inside causing jerky motion.",
     "Soch pneumatic cylinder jaisi hi hai, par oil ke saath - isliye ye kahin "
     "zyada force deta hai aur bina springiness ke position rokta hai.\n\n"
     "Pressure zyada hone ki wajah se seal ka mahatva bahut badh jaata hai. "
     "Ghisa hua piston seal oil ko cylinder ke ANDAR hi nikal jaane deta hai, "
     "isliye cylinder dheema ho jaata hai ya load me neeche khisakta hai - "
     "jabki bahar koi leakage dikhti hi nahi.\n\n"
     "AAM DIKKAT: rod seal se leakage (rod par oil), piston seal pass hona "
     "(force kam, khisakna), rod par khraash ya jang jo phir se seal kaat deti "
     "hai, aur andar phansi hawa se jhatke wali movement."),

    ("Hydraulic", "Hydraulic Oil and Filter",
     "Most hydraulic failures are oil failures. Three things decide oil "
     "health:\n\n"
     "LEVEL - check with the machine idle and cylinders home, otherwise the "
     "reading is wrong.\n"
     "CLEANLINESS - dirt is the number one killer of valves and pumps. Change "
     "filters on schedule, not only when they look dirty.\n"
     "TEMPERATURE - hot oil becomes thin, loses film strength and ages fast. If "
     "oil runs hot, look for a relief valve dumping continuously or a choked "
     "cooler.\n\n"
     "Milky oil means water has entered. Dark, burnt-smelling oil means it has "
     "been overheated. Both need attention, not top-up.",
     "Zyadatar hydraulic failure asal me oil ki failure hoti hai. Oil ki sehat "
     "teen cheezon se tay hoti hai:\n\n"
     "LEVEL - machine band aur cylinder home position me ho tabhi dekhein, warna "
     "reading galat aati hai.\n"
     "SAFAI - gandagi valve aur pump ki sabse badi dushman hai. Filter schedule "
     "par badlein, sirf gande dikhne par nahi.\n"
     "TEMPERATURE - garam oil patla ho jaata hai, film strength khota hai aur "
     "jaldi puraana padta hai. Oil garam chal raha ho to dekhein ki relief valve "
     "lagataar to nahi chhod raha, ya cooler choke to nahi.\n\n"
     "Doodhiya oil matlab paani chala gaya hai. Kaala aur jala hua smell wala "
     "oil matlab zyada garam hua hai. Dono me top-up nahi, dhyan chahiye."),

    ("Hydraulic", "Common Hydraulic Faults - quick checks",
     "NO PRESSURE: relief valve set too low or stuck open, pump worn, suction "
     "starved, or motor turning the wrong way.\n\n"
     "PRESSURE OK BUT NO MOVEMENT: directional valve not shifting (check 24V "
     "and manual override), or a line valve closed.\n\n"
     "SLOW OR WEAK: internal leakage past worn seals, oil too hot and thin, or "
     "flow control set low.\n\n"
     "NOISY: air in the suction line, low oil, choked strainer.\n\n"
     "CYLINDER DRIFTS DOWN: piston seal passing or a pilot-operated check valve "
     "leaking. Never work under a drifting cylinder - support it mechanically.",
     "PRESSURE NAHI BAN RAHA: relief valve kam set ya khula atka, pump ghisa "
     "hua, suction me oil kam, ya motor ulta ghoom raha hai.\n\n"
     "PRESSURE THEEK PAR MOVEMENT NAHI: directional valve shift nahi ho raha "
     "(24V aur manual override dekhein), ya line ka koi valve band hai.\n\n"
     "DHEEMA YA KAMZOR: ghise seal se andar hi leakage, oil bahut garam aur "
     "patla, ya flow control kam set.\n\n"
     "SHOR: suction line me hawa, oil kam, strainer choke.\n\n"
     "CYLINDER NEECHE KHISAKTA HAI: piston seal pass kar raha hai ya pilot-"
     "operated check valve leak kar raha hai. Khisakte cylinder ke NEECHE kabhi "
     "kaam mat kijiye - use mechanically support kijiye."),

    # ── Electrical ──────────────────────────────────────────────────────
    ("Electrical", "Induction Motor",
     "The three-phase induction motor is the workhorse of the plant - it drives "
     "pumps, conveyors, spindles and fans.\n\n"
     "The nameplate tells you what it should draw: kW/HP, voltage, full load "
     "current (FLA) and RPM. Comparing the measured current against FLA is the "
     "quickest health check there is.\n\n"
     "COMMON FAULTS: overload tripping (mechanical jam, bearing seized, "
     "under-voltage, single phasing), overheating (blocked cooling fan, "
     "overload, high ambient), noisy bearings, insulation failure due to "
     "moisture - check with a megger before re-energising a suspect motor.",
     "Three-phase induction motor plant ka sabse mehnati hissa hai - pump, "
     "conveyor, spindle aur fan sab isi se chalte hain.\n\n"
     "Nameplate batata hai ki use kitna lena chahiye: kW/HP, voltage, full load "
     "current (FLA) aur RPM. Naapa hua current FLA se milana sabse tez sehat-"
     "jaanch hai.\n\n"
     "AAM DIKKAT: overload trip (mechanical jam, bearing jam, voltage kam, "
     "single phasing), zyada garam hona (cooling fan band, overload, aas-paas "
     "garmi), bearing ka shor, nami se insulation fail - shak wale motor ko "
     "dobara supply dene se pehle megger se jaanch kijiye."),

    ("Electrical", "VFD (Variable Frequency Drive)",
     "A VFD controls motor speed by changing the FREQUENCY supplied to it. It "
     "also gives soft start, which reduces mechanical shock and starting "
     "current.\n\n"
     "It shows fault codes on its display - always note the code BEFORE "
     "resetting, otherwise the evidence is gone.\n\n"
     "COMMON FAULTS: OVER CURRENT (mechanical load, acceleration time too "
     "short, motor cable fault), OVER VOLTAGE (deceleration too fast - needs "
     "longer ramp or a braking resistor), OVER HEAT (cooling fan or filter "
     "choked, panel too hot), UNDER VOLTAGE (incoming supply dip). Never "
     "repeatedly reset a tripping drive without finding the cause.",
     "VFD motor ki speed uske FREQUENCY ko badal kar control karta hai. Ye soft "
     "start bhi deta hai, jisse mechanical jhatka aur starting current dono kam "
     "hote hain.\n\n"
     "Ye apne display par fault code dikhata hai - reset karne se PEHLE code "
     "hamesha note kar lijiye, warna saboot chala jaata hai.\n\n"
     "AAM DIKKAT: OVER CURRENT (mechanical load, acceleration time bahut kam, "
     "motor cable me fault), OVER VOLTAGE (deceleration bahut tez - lamba ramp "
     "ya braking resistor chahiye), OVER HEAT (cooling fan ya filter choke, "
     "panel garam), UNDER VOLTAGE (aane wali supply gir rahi hai). Trip hote "
     "drive ko bina wajah dhoondhe baar-baar reset mat kijiye."),

    ("Electrical", "Relay",
     "A relay is an electrically operated switch: a small coil current controls "
     "a larger or separate circuit. It is also used to isolate the PLC from "
     "field voltages.\n\n"
     "Contacts are NO (normally open) and NC (normally closed). Coil voltage is "
     "printed on the body - 24V DC is the common one on machines.\n\n"
     "COMMON FAULTS: contact pitted or welded from switching an inductive load, "
     "coil burnt, relay loose in its base, and the flyback diode missing on a "
     "DC coil (which slowly damages the driving output).",
     "Relay ek electrically chalne wala switch hai: coil ka chhota current ek "
     "bade ya alag circuit ko control karta hai. Isse PLC ko field ke voltage se "
     "alag rakhne ka kaam bhi liya jaata hai.\n\n"
     "Contact NO (normally open) aur NC (normally closed) hote hain. Coil ka "
     "voltage body par likha hota hai - machinon par aam taur par 24V DC.\n\n"
     "AAM DIKKAT: inductive load switch karne se contact ka gaddha pad jana ya "
     "chipak jana, coil jal jana, relay apne base me dheela, aur DC coil par "
     "flyback diode na hona (jo dheere-dheere chalane wale output ko kharab "
     "karta hai)."),

    ("Electrical", "Contactor and Overload Relay",
     "A contactor is a heavy-duty relay used to switch motors. An OVERLOAD "
     "RELAY sits with it and trips if the motor draws more current than set for "
     "too long.\n\n"
     "The overload must be set to the motor nameplate FLA - not higher 'so it "
     "stops tripping'. Raising the setting to stop nuisance tripping is how "
     "motors get burnt.\n\n"
     "COMMON FAULTS: contact tips burnt or welded (motor keeps running after "
     "stop - dangerous), coil burnt, chattering due to low control voltage or "
     "loose wiring, overload set wrong, and single phasing which the overload "
     "may not always catch.",
     "Contactor ek heavy-duty relay hai jo motor ko switch karta hai. Uske saath "
     "OVERLOAD RELAY lagta hai, jo motor ke set se zyada current lene par "
     "(kuch der tak) trip kar deta hai.\n\n"
     "Overload ko motor ke nameplate FLA par hi set karna chahiye - 'baar-baar "
     "trip na kare' isliye zyada par nahi. Setting badha kar trip rokna hi wo "
     "tareeqa hai jisse motor jalte hain.\n\n"
     "AAM DIKKAT: contact tip jal jana ya chipak jana (stop ke baad bhi motor "
     "chalta rahe - khatarnaak), coil jalna, control voltage kam ya wiring "
     "dheeli hone se khadkhadana, overload galat set, aur single phasing jise "
     "overload hamesha nahi pakadta."),

    ("Electrical", "MCB and MCCB",
     "These are the protection devices in the panel.\n\n"
     "MCB - small breaker for control and lighting circuits.\n"
     "MCCB - larger breaker for motors and main incomers, usually adjustable.\n\n"
     "They protect against OVERLOAD (slow, thermal) and SHORT CIRCUIT (instant, "
     "magnetic).\n\n"
     "A breaker that trips is doing its job - it is telling you something. "
     "Never bypass or hold one closed. If it trips again immediately, there is "
     "a dead short; if it trips after some minutes, it is an overload.\n\n"
     "COMMON FAULTS: repeated tripping (find the cause), loose terminals "
     "causing heating, and a breaker that will not reset because the fault is "
     "still present.",
     "Ye panel ke suraksha wale device hain.\n\n"
     "MCB - control aur lighting circuit ke liye chhota breaker.\n"
     "MCCB - motor aur main incomer ke liye bada breaker, aam taur par adjustable.\n\n"
     "Ye OVERLOAD (dheere, thermal) aur SHORT CIRCUIT (turant, magnetic) dono se "
     "bachate hain.\n\n"
     "Trip hota breaker apna kaam kar raha hai - wo aapko kuch bata raha hai. "
     "Use kabhi bypass mat kijiye aur na hi zabardasti band pakdiye. Turant "
     "dobara trip kare to seedha short hai; kuch minute baad kare to overload "
     "hai.\n\n"
     "AAM DIKKAT: baar-baar trip (wajah dhoondhein), terminal dheele hone se "
     "garmi, aur breaker ka reset na hona kyunki fault abhi maujood hai."),

    ("Electrical", "SMPS (24V Power Supply)",
     "The SMPS converts 230V AC into the 24V DC that the PLC, sensors, HMI and "
     "solenoid coils run on. If it is weak, MANY unrelated things start "
     "misbehaving at once - that pattern is a strong clue.\n\n"
     "Always measure the actual 24V under load, not with everything switched "
     "off.\n\n"
     "COMMON FAULTS: output sagging under load (undersized or ageing SMPS), "
     "output capacitors dried so the DC has ripple, overload from a shorted "
     "sensor cable, and heat because the panel fan or filter is choked.",
     "SMPS 230V AC ko 24V DC me badalta hai, jispar PLC, sensor, HMI aur "
     "solenoid coil chalte hain. Ye kamzor ho jaye to ek saath BAHUT SI alag-alag "
     "cheezein ajeeb harkat karne lagti hain - yahi pattern bada sanket hai.\n\n"
     "24V hamesha load ke saath naapiye, sab band karke nahi.\n\n"
     "AAM DIKKAT: load par output gir jana (chhota ya purana SMPS), output "
     "capacitor sookh jane se DC me ripple, kisi short sensor cable se overload, "
     "aur panel ka fan/filter choke hone se garmi."),

    ("Electrical", "Transformer",
     "A transformer changes voltage - for example 415V to 230V for control, or "
     "to 110V for safety circuits. It also isolates the control circuit from "
     "the main supply.\n\n"
     "It should hum lightly, not buzz loudly or smell hot.\n\n"
     "COMMON FAULTS: overheating from overload or blocked ventilation, loud "
     "buzzing from loose laminations or loose terminals, burnt smell and "
     "discoloured windings (replace, do not re-energise), and low output "
     "voltage due to a loose tap connection.",
     "Transformer voltage badalta hai - jaise control ke liye 415V se 230V, ya "
     "safety circuit ke liye 110V. Ye control circuit ko main supply se alag bhi "
     "rakhta hai.\n\n"
     "Iski halki gungunahat normal hai, par tez bhinbhinahat ya garam smell "
     "nahi.\n\n"
     "AAM DIKKAT: overload ya hawa ruk jane se zyada garam hona, lamination ya "
     "terminal dheele hone se tez awaaz, jala hua smell aur rang badli winding "
     "(badal dijiye, dobara supply mat dijiye), aur tap connection dheela hone se "
     "output voltage kam."),

    ("Electrical", "Earthing",
     "Earthing gives fault current a safe path to ground. It is what keeps a "
     "person alive when insulation fails, and it is also what keeps sensor and "
     "communication signals clean.\n\n"
     "Every panel, motor body and machine frame must be properly bonded. Cable "
     "SCREENS should be earthed at one end only - earthing both ends can create "
     "a loop that injects noise.\n\n"
     "COMMON FAULTS: loose or painted-over earth connections, corroded earth "
     "pit, earth removed during a modification and never restored, and "
     "unexplained sensor or communication faults that are actually an earthing "
     "problem.",
     "Earthing fault current ko zameen tak ek surakshit raasta deti hai. "
     "Insulation fail hone par insaan ki jaan yahi bachati hai, aur sensor tatha "
     "communication ke signal bhi yahi saaf rakhti hai.\n\n"
     "Har panel, motor ki body aur machine ka frame theek se bonded hona "
     "chahiye. Cable ki SCREEN sirf EK sire par earth honi chahiye - dono sire "
     "earth karne se loop ban kar noise aa sakta hai.\n\n"
     "AAM DIKKAT: earth connection dheela ya uspar paint, earth pit me jang, "
     "kisi modification me earth khol kar wapas na lagana, aur sensor ya "
     "communication ke aise fault jo asal me earthing ki dikkat hote hain."),

    # ── Control (PLC / HMI) ─────────────────────────────────────────────
    ("Control", "What is a PLC?",
     "A PLC (Programmable Logic Controller) is the industrial computer that "
     "runs the machine. It reads INPUTS (sensors, switches), runs the program, "
     "and drives OUTPUTS (solenoids, contactors, lamps).\n\n"
     "It works in a SCAN CYCLE, repeated continuously and very fast: read all "
     "inputs -> solve the program -> write all outputs.\n\n"
     "Because it reads all inputs at the START of the scan, a signal shorter "
     "than one scan can be missed entirely - which is exactly why a very fast "
     "cylinder can 'skip' its reed switch.\n\n"
     "The PLC also has a RUN/STOP mode and battery-backed memory for retained "
     "data.",
     "PLC (Programmable Logic Controller) wo industrial computer hai jo machine "
     "chalata hai. Ye INPUT padhta hai (sensor, switch), program chalata hai, "
     "aur OUTPUT chalata hai (solenoid, contactor, lamp).\n\n"
     "Ye SCAN CYCLE me kaam karta hai, jo lagataar aur bahut tez dohraya jaata "
     "hai: saare input padho -> program hal karo -> saare output likho.\n\n"
     "Kyunki ye saare input scan ke SHURU me padhta hai, isliye ek scan se chhota "
     "signal poori tarah chhoot sakta hai - aur isi wajah se bahut tez cylinder "
     "apna reed switch 'skip' kar jaata hai.\n\n"
     "PLC me RUN/STOP mode bhi hota hai aur battery se bachi hui memory bhi, "
     "retained data ke liye."),

    ("Control", "PLC Input and Output",
     "INPUT (X / I) - signals coming INTO the PLC from sensors and switches.\n"
     "OUTPUT (Y / Q) - signals going OUT to solenoids, contactors and lamps.\n\n"
     "Digital means ON/OFF. Analog means a value - 4-20 mA or 0-10 V - used for "
     "pressure, temperature and position.\n\n"
     "Each I/O point has an LED on the module. That LED is your fastest "
     "diagnostic tool:\n\n"
     "  Sensor LED ON but PLC input LED OFF -> wiring, common, or wrong "
     "PNP/NPN.\n"
     "  PLC output LED ON but device dead -> coil, fuse or field wiring.\n"
     "  Output LED OFF when it should be ON -> the program is not commanding "
     "it; look for an interlock, not a hardware fault.",
     "INPUT (X / I) - sensor aur switch se PLC ke ANDAR aane wale signal.\n"
     "OUTPUT (Y / Q) - solenoid, contactor aur lamp ki taraf BAHAR jaane wale "
     "signal.\n\n"
     "Digital matlab ON/OFF. Analog matlab ek value - 4-20 mA ya 0-10 V - jo "
     "pressure, temperature aur position ke liye use hoti hai.\n\n"
     "Har I/O point par module par ek LED hoti hai. Wahi LED aapka sabse tez "
     "jaanch ka auzaar hai:\n\n"
     "  Sensor ki LED ON par PLC input ki LED OFF -> wiring, common, ya galat "
     "PNP/NPN.\n"
     "  PLC output ki LED ON par device band -> coil, fuse ya field wiring.\n"
     "  Output LED OFF jabki ON honi chahiye -> program hi use command nahi kar "
     "raha; hardware nahi, koi interlock dhoondhiye."),

    ("Control", "Ladder Logic - the basics",
     "Ladder logic is drawn like an electrical circuit, which is why "
     "maintenance people read it easily.\n\n"
     "  --| |--  normally open contact: passes when the bit is ON\n"
     "  --|/|--  normally closed contact: passes when the bit is OFF\n"
     "  --( )--  output coil\n\n"
     "Contacts in a row = AND. Contacts in parallel branches = OR.\n\n"
     "SET / RESET (latch) holds a bit ON until something resets it - this is "
     "why an output can stay ON even after its condition has gone.\n\n"
     "When reading a fault: find the output coil that is not coming ON, then "
     "work LEFT along its rung to find which contact is blocking it. That one "
     "habit solves most control faults.",
     "Ladder logic electrical circuit ki tarah bani hoti hai, isiliye "
     "maintenance wale ise aasani se padh lete hain.\n\n"
     "  --| |--  normally open contact: bit ON hone par current jaata hai\n"
     "  --|/|--  normally closed contact: bit OFF hone par current jaata hai\n"
     "  --( )--  output coil\n\n"
     "Ek line me contact = AND. Alag-alag branch me contact = OR.\n\n"
     "SET / RESET (latch) bit ko ON pakad kar rakhta hai jab tak koi use reset "
     "na kare - isiliye kabhi-kabhi condition hatne ke baad bhi output ON raha "
     "aata hai.\n\n"
     "Fault dekhte waqt: wo output coil dhoondhiye jo ON nahi ho rahi, phir "
     "uski rung par BAAYEN chaliye aur dekhiye kaunsa contact rok raha hai. "
     "Yahi ek aadat zyadatar control ke fault hal kar deti hai."),

    ("Control", "HMI (Human Machine Interface)",
     "The HMI is the touch screen on the machine. It shows status, alarms and "
     "counters, and lets the operator give commands and change recipe or "
     "setting values.\n\n"
     "The HMI does not control anything by itself - it only reads and writes "
     "PLC memory. So an HMI alarm is really a PLC bit; if the screen shows a "
     "fault, the truth is in the PLC.\n\n"
     "COMMON FAULTS: no communication with the PLC (cable, IP address, station "
     "number), touch not responding or offset (needs calibration), backlight "
     "dim or dead, and a blank screen which is usually a 24V supply problem.",
     "HMI machine par laga touch screen hai. Ye status, alarm aur counter "
     "dikhata hai, aur operator ko command dene tatha recipe/setting ki value "
     "badalne deta hai.\n\n"
     "HMI khud kuch control nahi karta - ye sirf PLC ki memory padhta aur likhta "
     "hai. Isliye HMI ka alarm asal me PLC ka ek bit hi hai; screen par fault "
     "dikhe to sach PLC me hai.\n\n"
     "AAM DIKKAT: PLC se communication na hona (cable, IP address, station "
     "number), touch ka kaam na karna ya jagah se hat kar lagna (calibration "
     "chahiye), backlight dheemi ya band, aur khali screen - jo aam taur par 24V "
     "supply ki dikkat hoti hai."),

    ("Control", "Industrial Communication",
     "Machines talk to each other and to systems like this MES over industrial "
     "networks - usually Ethernet based.\n\n"
     "On our ANDON the PLCs are read over MC protocol (SLMP) on Ethernet. The "
     "PLC listens on a set IP and PORT, and a device connects to read or write "
     "its memory (M bits, D registers).\n\n"
     "One important limit: many PLC Ethernet settings allow only a LIMITED "
     "number of simultaneous connections - sometimes only one. If two systems "
     "try to read the same port, one of them gets refused, and the fault looks "
     "random.\n\n"
     "COMMON FAULTS: wrong IP or port, cable or switch fault, connection limit "
     "reached, and PLC in STOP mode.",
     "Machine aapas me aur is MES jaise systems se industrial network par baat "
     "karti hain - aam taur par Ethernet par.\n\n"
     "Apne ANDON me PLC ko Ethernet par MC protocol (SLMP) se padha jaata hai. "
     "PLC ek tay IP aur PORT par sunta hai, aur koi device usse jud kar uski "
     "memory (M bit, D register) padhta ya likhta hai.\n\n"
     "Ek zaroori seema: bahut se PLC ki Ethernet setting me ek saath SEEMIT hi "
     "connection ban sakte hain - kabhi-kabhi sirf ek. Do system ek hi port "
     "padhne ki koshish karein to ek ko mana kar diya jaata hai, aur fault "
     "bilkul random lagta hai.\n\n"
     "AAM DIKKAT: galat IP ya port, cable ya switch ki dikkat, connection ki "
     "seema bhar jana, aur PLC ka STOP mode me hona."),

    ("Control", "Safety Relay and Emergency Stop",
     "Safety circuits are deliberately built so that ANY failure stops the "
     "machine. That is why E-stops and guard switches use NORMALLY CLOSED "
     "contacts - a cut wire or a loose terminal opens the circuit and trips the "
     "machine, exactly as a real E-stop would.\n\n"
     "A safety relay monitors these contacts, usually on two channels, and only "
     "allows the machine to run when both agree. It normally needs a deliberate "
     "RESET after a trip - it must never restart on its own.\n\n"
     "NEVER bypass, jumper or defeat a safety device to keep production "
     "running. If a safety circuit trips repeatedly, find the cause and record "
     "it.",
     "Safety circuit jaan-boojh kar aise banaye jaate hain ki KOI BHI kharabi "
     "machine ko rok de. Isiliye E-stop aur guard switch me NORMALLY CLOSED "
     "contact lagte hain - taar katne ya terminal dheela hone par circuit khul "
     "jaata hai aur machine ruk jaati hai, bilkul waise jaise asli E-stop par "
     "hoti.\n\n"
     "Safety relay in contact ko dekhta rehta hai, aam taur par do channel par, "
     "aur tabhi chalne deta hai jab dono ek baat kahein. Trip ke baad ise "
     "jaan-boojh kar RESET karna padta hai - ye khud se kabhi chalu nahi hona "
     "chahiye.\n\n"
     "Production chalu rakhne ke liye kisi safety device ko KABHI bypass, jumper "
     "ya band mat kijiye. Safety circuit baar-baar trip ho to wajah dhoondhiye "
     "aur likhiye."),

    # ── Mechanical ──────────────────────────────────────────────────────
    ("Mechanical", "Bearing",
     "A bearing lets a shaft turn with little friction and carries the load.\n\n"
     "Most bearing failures are not the bearing's fault - they come from wrong "
     "fitting, wrong lubrication, contamination or misalignment.\n\n"
     "Warning signs: noise (growling or a regular click), heat, and vibration. "
     "A bearing that has started to sound bad will not recover; plan its "
     "replacement instead of waiting for seizure.\n\n"
     "COMMON FAULTS: over-greasing (as damaging as under-greasing), hammering "
     "the bearing on during fitting, wrong shaft or housing fit, water/dust "
     "entry due to a damaged seal, and misalignment from a worn coupling.",
     "Bearing shaft ko kam ghisawat me ghoomne deta hai aur load uthata hai.\n\n"
     "Zyadatar bearing failure bearing ki galti hoti hi nahi - wo galat fitting, "
     "galat lubrication, gandagi ya misalignment se aati hai.\n\n"
     "Chetavni ke sanket: awaaz (gurgurahat ya lagataar click), garmi, aur "
     "vibration. Jo bearing awaaz dena shuru kar de wo theek nahi hoti; jam hone "
     "ka intezaar karne ke bajaye uska replacement plan kijiye.\n\n"
     "AAM DIKKAT: zyada grease (kam grease jitna hi nuksaandeh), fitting ke waqt "
     "hathoda maarna, shaft ya housing ka galat fit, seal kharab hone se paani/"
     "dhool jana, aur ghise coupling se misalignment."),

    ("Mechanical", "Coupling",
     "A coupling joins the motor shaft to the driven shaft and transmits "
     "torque. Flexible couplings (spider/jaw, tyre, pin-bush) also absorb small "
     "misalignment and shock.\n\n"
     "The rubber element is a wear part - it is meant to fail before the "
     "bearings or the shaft do.\n\n"
     "COMMON FAULTS: worn spider or bush causing backlash and knocking, "
     "misalignment which quickly kills bearings on both sides, loose grub screw "
     "or key so the coupling slips, and rubber dust around the guard - which is "
     "an early sign the element is going.",
     "Coupling motor ke shaft ko chalne wale shaft se jodta hai aur torque "
     "pahunchata hai. Flexible coupling (spider/jaw, tyre, pin-bush) thodi "
     "misalignment aur jhatka bhi soakh leti hai.\n\n"
     "Rubber wala element ghisne wala part hai - wo jaan-boojh kar bearing ya "
     "shaft se pehle fail hone ke liye banaya jaata hai.\n\n"
     "AAM DIKKAT: spider ya bush ghis jane se backlash aur thok, misalignment jo "
     "dono taraf ke bearing jaldi kharab kar deta hai, grub screw ya key dheeli "
     "hone se coupling ka slip hona, aur guard ke aas-paas rubber ka bura - jo "
     "element kharab hone ka pehla sanket hai."),

    ("Mechanical", "Gearbox",
     "A gearbox changes speed and increases torque between the motor and the "
     "machine. Its ratio and oil grade are on the nameplate.\n\n"
     "Gearboxes are simple to look after and expensive to replace, so oil and "
     "breather care pays back many times.\n\n"
     "COMMON FAULTS: low or degraded oil, breather choked (pressure builds and "
     "pushes oil out through the seals), oil leak at the output seal, unusual "
     "noise or vibration from worn gears or bearings, and overheating from "
     "overload or wrong oil grade. Metal particles on the drain plug magnet "
     "mean internal wear - investigate, do not just refill.",
     "Gearbox motor aur machine ke beech speed badalta hai aur torque badhata "
     "hai. Uska ratio aur oil grade nameplate par likha hota hai.\n\n"
     "Gearbox ki dekhbhal aasan hai par badalna mehnga, isliye oil aur breather "
     "ka dhyan kai guna wapas deta hai.\n\n"
     "AAM DIKKAT: oil kam ya kharab, breather choke (andar pressure banta hai "
     "aur seal se oil bahar nikalta hai), output seal par leakage, ghise gear ya "
     "bearing se ajeeb awaaz/vibration, aur overload ya galat oil grade se zyada "
     "garam hona. Drain plug ke magnet par metal ke kan matlab andar ghisawat - "
     "sirf oil bharkar mat chhodiye, jaanch kijiye."),

    ("Mechanical", "Chain and Belt Drive",
     "Chains and belts transmit power between two shafts.\n\n"
     "TENSION is everything. Too loose and it jumps, slaps and wears the "
     "sprocket teeth; too tight and it destroys the bearings on both shafts.\n\n"
     "Chains need lubrication; most V-belts must be kept clean and dry - oil "
     "makes a belt slip and rot.\n\n"
     "COMMON FAULTS: wrong tension, misaligned pulleys or sprockets (belt runs "
     "to one side, chain wears on one face), worn sprocket teeth becoming "
     "hooked, stretched chain, glazed or cracked belt, and belts of different "
     "ages running as a set - always replace a matched set together.",
     "Chain aur belt do shaft ke beech power pahunchate hain.\n\n"
     "TENSION sab kuch hai. Bahut dheela ho to uchhalta hai, patakhta hai aur "
     "sprocket ke daant ghis deta hai; bahut kasa ho to dono shaft ke bearing "
     "kharab kar deta hai.\n\n"
     "Chain ko lubrication chahiye; zyadatar V-belt ko saaf aur sookha rakhna "
     "hota hai - oil lagne se belt slip karti hai aur gal jaati hai.\n\n"
     "AAM DIKKAT: galat tension, pulley ya sprocket ka misalignment (belt ek "
     "taraf chalti hai, chain ek hi face par ghisti hai), sprocket ke daant ghis "
     "kar hook ban jana, chain ka khinch jana, belt ka chikna ya phata hona, aur "
     "alag-alag umar ki belt ek set me chalana - matched set hamesha ek saath "
     "badliye."),

    ("Mechanical", "Lubrication",
     "Lubrication reduces friction, carries away heat and keeps dirt out. Most "
     "'mechanical' failures are really lubrication failures.\n\n"
     "Three rules: the RIGHT lubricant, the RIGHT quantity, at the RIGHT "
     "interval. More is not better - over-greasing a bearing or a motor churns "
     "the grease, heats it and pushes it into the windings.\n\n"
     "Never mix two greases of different types; they can separate and stop "
     "working.\n\n"
     "COMMON FAULTS: missed lubrication points (the ones that are hard to "
     "reach), blocked grease nipple, wrong grade used because it was what was "
     "available, and contamination from a dirty grease gun nozzle.",
     "Lubrication ghisawat kam karti hai, garmi bahar le jaati hai aur gandagi "
     "ko andar aane se rokti hai. Zyadatar 'mechanical' failure asal me "
     "lubrication ki failure hoti hai.\n\n"
     "Teen niyam: SAHI lubricant, SAHI maatra, SAHI samay par. Zyada matlab "
     "behtar nahi - bearing ya motor me zyada grease bharna use mathta hai, "
     "garam karta hai aur winding me dhakel deta hai.\n\n"
     "Do alag type ki grease kabhi mat milaiye; wo alag ho kar kaam karna band "
     "kar sakti hain.\n\n"
     "AAM DIKKAT: chhoot gaye lubrication point (jo pahunch se door hain), "
     "grease nipple band, jo mil gaya wahi grade daal dena, aur gande grease gun "
     "nozzle se gandagi jana."),

    ("Mechanical", "Fasteners and Torque",
     "A bolt holds by the TENSION created when it is tightened, not by "
     "friction alone. That is why torque matters: too little and it works "
     "loose, too much and it stretches or the thread strips.\n\n"
     "Use a torque wrench where a value is specified, and tighten in the "
     "correct sequence on flanges and covers.\n\n"
     "COMMON FAULTS: bolts loosened by vibration (use lock washers, thread "
     "locker or a locking nut where specified), reused self-locking nuts, "
     "damaged or dirty threads giving false torque, and mixing bolt grades - a "
     "lower grade bolt in a high load place will fail.",
     "Bolt us TENSION se pakadta hai jo kasne par banta hai, sirf rukawat se "
     "nahi. Isliye torque mayne rakhta hai: kam kasa to vibration se dheela ho "
     "jayega, zyada kasa to khinch jayega ya thread ukhad jayegi.\n\n"
     "Jahan value di gayi ho wahan torque wrench use kijiye, aur flange ya cover "
     "par sahi kram me kasiye.\n\n"
     "AAM DIKKAT: vibration se bolt dheele hona (jahan bataya ho wahan lock "
     "washer, thread locker ya locking nut lagaiye), self-locking nut dobara "
     "istemal karna, thread kharab ya gandi hone se galat torque, aur bolt ke "
     "grade milana - zyada load wali jagah par kam grade ka bolt fail hoga."),

    # ── Safety ──────────────────────────────────────────────────────────
    ("Safety", "LOTO - Lock Out Tag Out",
     "LOTO makes sure a machine cannot start while someone is working on it.\n\n"
     "The steps: inform production -> shut down -> isolate every energy source "
     "-> LOCK the isolator and put your TAG on it -> release stored energy "
     "(air, hydraulic pressure, springs, gravity, capacitors) -> TRY to start "
     "the machine to prove it is dead -> then work.\n\n"
     "Remember there is more than one energy source. Switching off the main "
     "supply does not release trapped air pressure or a raised ram.\n\n"
     "One lock, one key, one person. Only the person who fitted the lock "
     "removes it.",
     "LOTO ye pakka karta hai ki jab koi machine par kaam kar raha ho to wo "
     "chalu na ho sake.\n\n"
     "Kram: production ko batao -> machine band karo -> har energy source alag "
     "karo -> isolator par TAALA lagao aur apna TAG lagao -> jama energy chhodo "
     "(hawa, hydraulic pressure, spring, gravity, capacitor) -> machine chalu "
     "karke DEKHO ki wo sach me band hai -> phir kaam karo.\n\n"
     "Yaad rakhiye energy ek se zyada jagah hoti hai. Main supply band karne se "
     "phansi hui hawa ya upar utha hua ram nahi khulta.\n\n"
     "Ek taala, ek chaabi, ek aadmi. Taala wahi kholega jisne lagaya tha."),

    ("Safety", "PPE - Personal Protective Equipment",
     "PPE is the LAST line of defence, not the first. The first is removing the "
     "hazard; PPE only protects you when everything else has already failed.\n\n"
     "On maintenance work the usual set is: safety shoes, safety glasses, hand "
     "gloves suited to the job, and ear protection in high-noise areas. Add a "
     "face shield for grinding, and insulated gloves and mat for live "
     "electrical work.\n\n"
     "One warning: gloves that protect against cuts can be dangerous near "
     "rotating parts, where a glove can be caught and pull the hand in. Choose "
     "PPE for the actual job.",
     "PPE bachaav ki AAKHRI line hai, pehli nahi. Pehli line khatra hi hata dena "
     "hai; PPE tabhi bachata hai jab baaki sab pehle hi fail ho chuka ho.\n\n"
     "Maintenance ke kaam me aam set hai: safety shoes, safety glasses, kaam ke "
     "hisaab se hand gloves, aur zyada shor wali jagah par kaan ke liye "
     "protection. Grinding par face shield, aur live electrical kaam par "
     "insulated gloves aur mat.\n\n"
     "Ek chetavni: kat se bachane wale gloves ghoomte hue parts ke paas "
     "khatarnaak ho sakte hain, jahan glove phans kar haath andar kheench sakta "
     "hai. PPE kaam dekh kar chuniye."),

    ("Safety", "Machine Guarding",
     "Guards keep people away from moving parts. Fixed guards are bolted on; "
     "interlocked guards are wired so that opening them stops the machine.\n\n"
     "An interlocked guard is part of the safety circuit - not a "
     "convenience.\n\n"
     "The most dangerous shortcut in any plant is defeating a guard switch with "
     "a spare actuator or a jumper 'just for trials'. It removes the one thing "
     "standing between a person and a moving machine, and it is usually "
     "forgotten in place.\n\n"
     "If a guard interlock keeps tripping, treat it as a fault to be fixed and "
     "recorded - never as something to be bypassed.",
     "Guard logon ko chalte hue parts se door rakhte hain. Fixed guard bolt se "
     "kase hote hain; interlocked guard aise jude hote hain ki kholte hi machine "
     "ruk jaye.\n\n"
     "Interlocked guard safety circuit ka hissa hai - suvidha ki cheez nahi.\n\n"
     "Kisi bhi plant ka sabse khatarnaak shortcut yahi hai ki guard switch ko "
     "spare actuator ya jumper se 'sirf trial ke liye' bypass kar diya jaye. Wo "
     "insaan aur chalti machine ke beech ki ekmatra cheez hata deta hai, aur aam "
     "taur par wahi laga rah jaata hai.\n\n"
     "Guard interlock baar-baar trip kare to use theek karne aur likhne wali "
     "kharabi maaniye - bypass karne wali cheez kabhi nahi."),
]
