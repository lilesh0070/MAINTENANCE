"""
routers/study_seed_core.py
==========================
Study Material ka SEED content — part 1: maintenance ke core concepts
(Basics, KPI, CAPA, Preventive, ANDON).

Har topic ka dhancha:  (category, title, body_en, body_hi)

Ye content is plant ke ASLI niyam se likha gaya hai, kitaabi nahi —
formula wahi jo KPI page chalata hai, CAPA ka niyam wahi jo CAPA page par
hai.  Kabhi formula badle to YAHAN bhi badalna, warna padhne wala kuch aur
seekhega aur screen kuch aur dikhayegi.

Seed sirf pehli baar chalta hai (table bilkul khali ho tab).  Uske baad
admin page se hi sab kuch badalta hai — is file ko chhune ki zaroorat nahi.
"""

CORE = [
    # ── Basics ──────────────────────────────────────────────────────────
    ("Basics", "What is Maintenance?",
     "Maintenance means keeping a machine in a condition where it can run and "
     "produce good parts safely.\n\n"
     "It has two sides:\n\n"
     "1. BREAKDOWN maintenance - the machine has already stopped or is giving "
     "trouble, and we repair it.\n\n"
     "2. PREVENTIVE maintenance (PM) - we service the machine on a plan so that "
     "it does not break down in the first place.\n\n"
     "A good maintenance team is judged less by how fast it repairs, and more "
     "by how rarely it has to.",
     "Maintenance ka matlab hai machine ko aisi haalat me rakhna ki wo chalti "
     "rahe aur safe tareeke se sahi parts banati rahe.\n\n"
     "Iske do hisse hain:\n\n"
     "1. BREAKDOWN maintenance - machine ruk chuki hai ya dikkat de rahi hai, "
     "aur hum use theek karte hain.\n\n"
     "2. PREVENTIVE maintenance (PM) - hum plan bana kar pehle hi servicing "
     "karte hain, taaki machine kharab ho hi na.\n\n"
     "Achhi maintenance team ki pehchaan ye nahi hai ki wo kitni jaldi repair "
     "karti hai, balki ye hai ki use repair karna kitna KAM padta hai."),

    ("Basics", "What is a Breakdown?",
     "A breakdown is any machine problem that needs maintenance action.\n\n"
     "In our system every breakdown is recorded on a BREAK DOWN SLIP, which "
     "carries: machine, date, shift, start time, OK time, what the problem was, "
     "what action was taken, spares used, and who attended.\n\n"
     "The slip is the source of every number you see on the KPI and Dashboard "
     "pages. If the slip is filled carelessly, every report built on it is "
     "wrong.",
     "Breakdown ka matlab hai machine ki koi bhi aisi dikkat jiske liye "
     "maintenance ko kaam karna pade.\n\n"
     "Apne system me har breakdown BREAK DOWN SLIP par likhi jaati hai, jisme "
     "hota hai: machine, date, shift, start time, OK time, problem kya thi, kya "
     "action liya, kaunse spare lage, aur kisne attend kiya.\n\n"
     "KPI aur Dashboard par jo bhi number dikhta hai, wo isi slip se banta hai. "
     "Slip laparwaahi se bhari to us par bani har report galat ho jaati hai."),

    ("Basics", "Breakdown Categories (A and B)",
     "Every slip must be marked with one category.\n\n"
     "A CATEGORY - Machine or line has STOPPED and there is production loss "
     "directly.\n\n"
     "B CATEGORY - Machine is still RUNNING but production is affected "
     "(adjustment).\n\n"
     "Why it matters: A-category losses hit output immediately, so they are "
     "reviewed first. Marking a real A-category slip as B hides a genuine "
     "production loss from the report.",
     "Har slip par ek category zaroor lagani hoti hai.\n\n"
     "A CATEGORY - Machine ya line BAND ho gayi hai aur seedha production loss "
     "ho raha hai.\n\n"
     "B CATEGORY - Machine chal to rahi hai, par production par asar pad raha "
     "hai (adjustment).\n\n"
     "Ye zaroori kyun hai: A-category ka nuksaan turant output par lagta hai, "
     "isliye pehle usi ko dekha jaata hai. Asli A-category slip par B laga dena "
     "ek sachche production loss ko report se chhupa deta hai."),

    ("Basics", "Down Time vs Response Time",
     "These two are often confused. They are not the same thing.\n\n"
     "RESPONSE TIME - from the moment the call is raised to the moment "
     "maintenance reaches the machine. It measures how quickly we REACT.\n\n"
     "DOWN TIME (M/C down time) - from B/D start time to B/D OK time. It "
     "measures how long PRODUCTION was affected.\n\n"
     "A fast response with a long repair still means a long down time. Both "
     "numbers are tracked separately for this reason.",
     "In dono me aksar gadbad ho jaati hai. Ye ek cheez nahi hain.\n\n"
     "RESPONSE TIME - call lagne se lekar maintenance ke machine tak pahunchne "
     "tak ka samay. Ye batata hai ki hum kitni jaldi PAHUNCHE.\n\n"
     "DOWN TIME (M/C down time) - B/D start time se B/D OK time tak. Ye batata "
     "hai ki PRODUCTION kitni der rukka raha.\n\n"
     "Jaldi pahunch gaye par repair lamba chala, to down time phir bhi lamba "
     "hai. Isiliye dono number alag-alag rakhe jaate hain."),

    ("Basics", "The plant day and the financial year",
     "PLANT DAY: our day runs from 07:00 to 06:30 the next morning, not "
     "midnight to midnight. A call at 6 AM belongs to the PREVIOUS day's "
     "report. This is why a night-shift breakdown appears on the earlier "
     "date.\n\n"
     "FINANCIAL YEAR: April to March. 'FY 2026-27' means 01-Apr-2026 to "
     "31-Mar-2027. Every yearly report on this system follows this, not the "
     "calendar year.",
     "PLANT DIN: apna din subah 07:00 se agle din 06:30 tak chalta hai, raat "
     "12 baje se nahi. Subah 6 baje ki call PICHHLE din ki report me jaati hai. "
     "Isiliye night shift ka breakdown pehli waali date par dikhta hai.\n\n"
     "FINANCIAL YEAR: April se March. 'FY 2026-27' matlab 01-Apr-2026 se "
     "31-Mar-2027. Is system ki har saalana report isi hisaab se banti hai, "
     "calendar year se nahi."),

    ("Basics", "Why filling the slip properly matters",
     "Every KPI on this system is built from the breakdown slips. Nothing is "
     "typed in separately.\n\n"
     "  - Wrong start or OK time -> wrong down time -> wrong MTTR and wrong "
     "availability\n\n"
     "  - Blank frequency -> wrong MTTR and MTBF (frequency is the divider)\n\n"
     "  - Wrong category -> a real production loss disappears from the report\n\n"
     "  - Vague problem / action -> the next person repeats your investigation "
     "from zero\n\n"
     "Five extra minutes on the slip today saves hours of guessing later.",
     "Is system ka har KPI breakdown slip se hi banta hai. Alag se kuch type "
     "nahi kiya jaata.\n\n"
     "  - Galat start ya OK time -> galat down time -> galat MTTR aur galat "
     "availability\n\n"
     "  - Frequency khali -> MTTR aur MTBF dono galat (frequency se hi bhaag "
     "diya jaata hai)\n\n"
     "  - Galat category -> ek sachcha production loss report se gayab\n\n"
     "  - Problem/action adhoora likha -> agla banda aapki poori jaanch shuru "
     "se dohrata hai\n\n"
     "Aaj slip par paanch minute zyada dene se baad me ghanton ka andaaza "
     "lagana bach jaata hai."),

    # ── KPI ─────────────────────────────────────────────────────────────
    ("KPI", "What is a KPI?",
     "KPI = Key Performance Indicator. It is a number that tells you whether "
     "things are getting better or worse, without reading every slip.\n\n"
     "Our maintenance KPIs are: MTTR, MTBF, LTTR, Availability, Breakdown "
     "Frequency, Total Breakdown Hours, and Breakdowns of 60 minutes or "
     "more.\n\n"
     "A KPI is only as honest as the data behind it. Every one of these is "
     "calculated live from the breakdown slips - nothing is typed in by hand.",
     "KPI = Key Performance Indicator. Ye ek aisa number hai jo bina har slip "
     "padhe bata deta hai ki haalat sudhar rahi hai ya bigad rahi hai.\n\n"
     "Apne maintenance ke KPI hain: MTTR, MTBF, LTTR, Availability, Breakdown "
     "Frequency, Total Breakdown Hours, aur 60 minute ya usse zyada wale "
     "breakdown.\n\n"
     "KPI utna hi sachcha hota hai jitna uske peeche ka data. Ye sab live "
     "breakdown slip se bante hain - koi bhi haath se nahi bharta."),

    ("KPI", "MTTR - Mean Time To Repair",
     "MTTR tells you, on average, how long a machine stays down once it "
     "breaks.\n\n"
     "FORMULA (as used in this system):\n\n"
     "    MTTR = Total down time (minutes) / Total breakdown frequency\n\n"
     "Unit: MINUTES. Lower is better.\n\n"
     "Note carefully: MTTR is about REPAIR time, not response time. Do not mix "
     "the two.\n\n"
     "If MTTR is rising, ask: are spares available? is the right skill on "
     "shift? is the same fault repeating and being patched instead of fixed?",
     "MTTR batata hai ki machine kharab hone ke baad औsatan kitni der band "
     "rehti hai.\n\n"
     "FORMULA (jo is system me chalta hai):\n\n"
     "    MTTR = Kul down time (minute) / Kul breakdown frequency\n\n"
     "Unit: MINUTE. Kam ho to behtar.\n\n"
     "Dhyan se: MTTR REPAIR ke samay ka hai, response time ka nahi. Dono ko mat "
     "milaiye.\n\n"
     "MTTR badh raha ho to poochhiye: spare available hain? shift me sahi skill "
     "wala banda hai? kya wahi fault baar-baar aa raha hai aur hum jugaad kar ke "
     "chhod de rahe hain?"),

    ("KPI", "MTBF - Mean Time Between Failures",
     "MTBF tells you how long a machine runs, on average, before it fails "
     "again.\n\n"
     "FORMULA (as used in this system):\n\n"
     "    MTBF = (Elapsed hours - Total down hours) / Total breakdown "
     "frequency\n\n"
     "Unit: HOURS. Higher is better.\n\n"
     "MTTR and MTBF answer two different questions:\n\n"
     "  MTTR - when it breaks, how fast are we back?\n"
     "  MTBF - how often does it break at all?\n\n"
     "Improving MTBF is preventive work (PM, DMC, root-cause fixes). Improving "
     "MTTR is repair readiness (spares, skill, tools).",
     "MTBF batata hai ki machine औsatan kitni der chalti hai, agli baar kharab "
     "hone se pehle.\n\n"
     "FORMULA (jo is system me chalta hai):\n\n"
     "    MTBF = (Beete hue ghante - Kul down ghante) / Kul breakdown "
     "frequency\n\n"
     "Unit: GHANTE. Zyada ho to behtar.\n\n"
     "MTTR aur MTBF do alag sawaalon ka jawab dete hain:\n\n"
     "  MTTR - kharab hone par hum kitni jaldi wapas laate hain?\n"
     "  MTBF - wo kharab hoti hi kitni baar hai?\n\n"
     "MTBF sudharna preventive kaam hai (PM, DMC, jad tak jaakar fix karna). "
     "MTTR sudharna repair ki taiyari hai (spare, skill, tools)."),

    ("KPI", "LTTR - Longest Time To Repair",
     "LTTR is the single longest breakdown in the selected period.\n\n"
     "    LTTR = MAX(down time)\n\n"
     "Unit: usually shown in hours. Lower is better.\n\n"
     "Why it is tracked separately: an average can look healthy while one "
     "12-hour breakdown quietly caused most of the month's loss. LTTR makes "
     "that one bad event visible instead of letting the average hide it.",
     "LTTR chune hue samay ka SABSE LAMBA ek breakdown hai.\n\n"
     "    LTTR = MAX(down time)\n\n"
     "Unit: aam taur par ghanton me. Kam ho to behtar.\n\n"
     "Ise alag kyun dekha jaata hai: औsat theek dikh sakti hai, jabki ek hi "
     "12-ghante ka breakdown chupchap mahine ka zyadatar nuksaan kar gaya ho. "
     "LTTR us ek badi ghatna ko saamne le aata hai, औsat use chhupa leta hai."),

    ("KPI", "Availability",
     "Availability is the share of planned time a machine was actually "
     "available to run.\n\n"
     "    Availability = MTBF / (MTBF + MTTR in hours) x 100\n\n"
     "Unit: PERCENT. Higher is better.\n\n"
     "It combines both sides in one number: breaking rarely (high MTBF) AND "
     "recovering quickly (low MTTR) both push availability up.",
     "Availability batati hai ki plan kiye gaye samay me se machine asal me "
     "kitne samay chalne layak thi.\n\n"
     "    Availability = MTBF / (MTBF + MTTR ghanton me) x 100\n\n"
     "Unit: PRATISHAT. Zyada ho to behtar.\n\n"
     "Ye ek hi number me dono baatein jod deti hai: kam kharab hona (zyada "
     "MTBF) AUR jaldi theek ho jaana (kam MTTR) - dono availability badhate "
     "hain."),

    ("KPI", "Breakdown Frequency",
     "Frequency is how MANY times breakdowns happened - not how long they "
     "lasted.\n\n"
     "Important: our reports add up the FREQUENCY column on the slips, they do "
     "not simply count rows. One slip can record more than one occurrence.\n\n"
     "Frequency is also the divider in both MTTR and MTBF, so a wrong "
     "frequency quietly corrupts both of those KPIs.",
     "Frequency batati hai ki breakdown KITNI BAAR hua - kitni der chala ye "
     "nahi.\n\n"
     "Zaroori baat: apni report slip ke FREQUENCY column ko jodti hai, sirf "
     "rows nahi ginti. Ek slip par ek se zyada baar bhi darj ho sakti hai.\n\n"
     "Frequency se hi MTTR aur MTBF dono me bhaag diya jaata hai, isliye galat "
     "frequency chupchap dono KPI kharab kar deti hai."),

    # ── CAPA ────────────────────────────────────────────────────────────
    ("CAPA", "Breakdowns of 60 minutes or more",
     "Any breakdown whose down time is 60 MINUTES OR MORE is treated as a "
     "serious loss and needs a CAPA.\n\n"
     "Note the rule carefully: it is 60 minutes OR MORE. A breakdown of exactly "
     "60 minutes DOES count.\n\n"
     "(Earlier two pages disagreed on this - one used 'more than 60' and the "
     "other used '60 or more' - and the counts never matched. The whole system "
     "now uses 60-or-more everywhere.)",
     "Jis breakdown ka down time 60 MINUTE YA USSE ZYADA hai, use bada nuksaan "
     "maana jaata hai aur uski CAPA banti hai.\n\n"
     "Niyam dhyan se: 60 minute YA USSE ZYADA. Theek 60 minute wala breakdown "
     "bhi GINTA hai.\n\n"
     "(Pehle do page is par alag chalte the - ek '60 se zyada' aur doosra '60 "
     "ya usse zyada' - aur ginti kabhi milti hi nahi thi. Ab poore system me "
     "'60 ya usse zyada' hi chalta hai.)"),

    ("CAPA", "What is CAPA?",
     "CAPA = Corrective And Preventive Action.\n\n"
     "CORRECTIVE - fix the problem that happened.\n"
     "PREVENTIVE - make sure it cannot happen again.\n\n"
     "Repairing a broken sensor is corrective. Finding out why the sensor keeps "
     "getting hit, and adding a guard, is preventive. Only the second one "
     "reduces future breakdowns.\n\n"
     "In our system every breakdown of 60 minutes or more becomes a CAPA, and "
     "it is closed by filling the QPR sheet.",
     "CAPA = Corrective And Preventive Action.\n\n"
     "CORRECTIVE - jo dikkat hui use theek karna.\n"
     "PREVENTIVE - pakka karna ki wo dobara ho hi na sake.\n\n"
     "Toota hua sensor badal dena corrective hai. Ye pata lagana ki sensor baar-"
     "baar chot kyun kha raha hai aur uspar guard laga dena preventive hai. "
     "Aage ke breakdown sirf doosri wali cheez kam karti hai.\n\n"
     "Apne system me 60 minute ya usse zyada ka har breakdown CAPA banta hai, "
     "aur QPR sheet bhar kar hi band hota hai."),

    ("CAPA", "What is QPR?",
     "QPR is the quality problem report sheet used to close a CAPA.\n\n"
     "It walks through the problem in order: what was observed, how it was "
     "confirmed, what was done immediately to contain it, what the root cause "
     "was for OCCURRENCE and for OUTFLOW, and what permanent action was "
     "taken.\n\n"
     "A CAPA is not closed because the machine is running again. It is closed "
     "when the QPR shows the cause was found and blocked.",
     "QPR wo quality problem report sheet hai jisse CAPA band ki jaati hai.\n\n"
     "Ye problem ko kram se le kar chalti hai: kya dikha, use confirm kaise "
     "kiya, turant rokne ke liye kya kiya, jad kya thi - OCCURRENCE ki bhi aur "
     "OUTFLOW ki bhi, aur pakka ilaaj kya kiya.\n\n"
     "CAPA isliye band nahi hoti ki machine phir se chal padi. Wo tab band hoti "
     "hai jab QPR dikha de ki jad mil gayi aur use rok diya gaya."),

    # ── Preventive ──────────────────────────────────────────────────────
    ("Preventive", "PM - Preventive Maintenance",
     "PM is planned servicing done BEFORE the machine fails - cleaning, "
     "lubrication, tightening, checking wear, replacing parts on schedule.\n\n"
     "Each machine has a PM frequency and a yearly schedule of planned weeks. "
     "When PM is actually done, the actual week and date are recorded, so plan "
     "vs actual can be compared.\n\n"
     "PM is the main lever on MTBF. Breakdown repair only restores what was "
     "lost; PM is what stops the loss from happening.",
     "PM wo planned servicing hai jo machine ke kharab hone se PEHLE ki jaati "
     "hai - safai, greasing/oiling, kasna, ghisawat dekhna, aur schedule ke "
     "hisaab se parts badalna.\n\n"
     "Har machine ki ek PM frequency hoti hai aur saal bhar ka plan hota hai ki "
     "kis hafte PM karni hai. PM ho jaane par asli hafta aur date bhari jaati "
     "hai, taaki plan aur actual ki tulna ho sake.\n\n"
     "MTBF sudharne ka sabse bada zariya PM hi hai. Breakdown repair to sirf jo "
     "chala gaya use wapas laata hai; PM us nuksaan ko hone hi nahi deti."),

    ("Preventive", "DMC - Daily Machine Check",
     "DMC is the short daily check the operator does on the machine - a small "
     "list of points marked OK or NG every day.\n\n"
     "It is the cheapest early warning available. A loose guard, a small leak "
     "or an odd sound caught in a 5-minute daily check is a 10-minute job; the "
     "same thing found after failure can cost a full shift.\n\n"
     "An NG point raised in DMC goes to maintenance for action.",
     "DMC wo chhoti si roz ki jaanch hai jo operator machine par karta hai - "
     "kuch points ki list, jinhe roz OK ya NG mark kiya jaata hai.\n\n"
     "Ye sabse sasta early warning hai. Dheela guard, halki leakage ya ajeeb "
     "awaaz agar 5 minute ki roz ki jaanch me pakad li jaye to 10 minute ka kaam "
     "hai; wahi cheez fail hone ke baad mile to poori shift le sakti hai.\n\n"
     "DMC me uthaya gaya NG point maintenance ke paas action ke liye jaata hai."),

    # ── ANDON ───────────────────────────────────────────────────────────
    ("ANDON", "What is ANDON?",
     "ANDON is the call system on the shop floor. When a machine has a problem "
     "the operator presses a button, and a call is raised to the right "
     "department - Maintenance, Tool Room, Quality, Material and so on.\n\n"
     "The call records when it started, when someone responded, and when it "
     "ended. From this we get response time and duration automatically, without "
     "anyone writing it down.\n\n"
     "For Maintenance and Tool Room the tower light goes OFF as soon as someone "
     "RESPONDS. For the other departments it stays ON until the call is closed.",
     "ANDON shop floor ka call system hai. Machine me dikkat hone par operator "
     "button dabata hai aur sahi department ko call chali jaati hai - "
     "Maintenance, Tool Room, Quality, Material waghera.\n\n"
     "Call me darj hota hai ki wo kab shuru hui, kab kisi ne response diya, aur "
     "kab khatam hui. Isse response time aur duration apne aap mil jaate hain, "
     "kisi ko likhna nahi padta.\n\n"
     "Maintenance aur Tool Room ke liye tower light tabhi BUJH jaati hai jab "
     "koi RESPONSE de deta hai. Baaki department ke liye wo call band hone tak "
     "jalti rehti hai."),

    ("ANDON", "Total Loss and why lines are counted separately",
     "When two departments are called on the same line, the time is not counted "
     "twice - the newest call takes over, and the earlier one resumes when the "
     "newer one ends.\n\n"
     "But two different LINES can be down at the same time, and both losses are "
     "real. So the loss is worked out separately for each line and then added "
     "up. Treating the whole plant as one timeline would under-report the loss.",
     "Jab ek hi line par do department ko call jaati hai, to samay do baar nahi "
     "gina jaata - nayi call purani ko rok deti hai, aur nayi khatam hone par "
     "purani phir se chalu ho jaati hai.\n\n"
     "Par do ALAG LINE ek hi waqt par band ho sakti hain, aur dono ka nuksaan "
     "asli hai. Isliye nuksaan har line ka alag nikal kar phir joda jaata hai. "
     "Poore plant ko ek hi timeline maan lene se nuksaan kam dikhta."),
]
