"""
routers/study_seed_core.py
==========================
Study Material ka SEED content — part 1: maintenance ke core concepts
(Basics, KPI, CAPA, Preventive, ANDON).

Har topic ka dhancha:  (category, title, body_en, body_hi)

Hindi hissa DEVANAGARI me hai.  Acronym (PLC, HMI, MTTR, MTBF, CAPA, QPR,
PM, DMC, ANDON) Latin me hi rakhe gaye hain — Hindi ke technical document
me bhi wo aise hi likhe jaate hain, aur shop floor par wahi padha jaata hai.

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
     "मेंटेनेंस का मतलब है मशीन को ऐसी हालत में रखना कि वह सुरक्षित तरीके से "
     "चलती रहे और सही पार्ट बनाती रहे।\n\n"
     "इसके दो हिस्से हैं:\n\n"
     "1. ब्रेकडाउन मेंटेनेंस — मशीन रुक चुकी है या दिक्कत दे रही है, और हम उसे "
     "ठीक करते हैं।\n\n"
     "2. प्रिवेंटिव मेंटेनेंस (PM) — हम प्लान बनाकर पहले ही सर्विसिंग करते हैं, "
     "ताकि मशीन खराब हो ही न।\n\n"
     "अच्छी मेंटेनेंस टीम की पहचान यह नहीं है कि वह कितनी जल्दी रिपेयर करती है, "
     "बल्कि यह है कि उसे रिपेयर करना कितना कम पड़ता है।"),

    ("Basics", "What is a Breakdown?",
     "A breakdown is any machine problem that needs maintenance action.\n\n"
     "In our system every breakdown is recorded on a BREAK DOWN SLIP, which "
     "carries: machine, date, shift, start time, OK time, what the problem was, "
     "what action was taken, spares used, and who attended.\n\n"
     "The slip is the source of every number you see on the KPI and Dashboard "
     "pages. If the slip is filled carelessly, every report built on it is "
     "wrong.",
     "ब्रेकडाउन का मतलब है मशीन की कोई भी ऐसी दिक्कत जिसके लिए मेंटेनेंस को काम "
     "करना पड़े।\n\n"
     "हमारे सिस्टम में हर ब्रेकडाउन BREAK DOWN SLIP पर लिखा जाता है, जिसमें "
     "होता है: मशीन, तारीख, शिफ्ट, स्टार्ट टाइम, OK टाइम, समस्या क्या थी, क्या "
     "एक्शन लिया, कौन से स्पेयर लगे, और किसने अटेंड किया।\n\n"
     "KPI और डैशबोर्ड पर जो भी नंबर दिखता है, वह इसी स्लिप से बनता है। स्लिप "
     "लापरवाही से भरी गई तो उस पर बनी हर रिपोर्ट गलत हो जाती है।"),

    ("Basics", "Breakdown Categories (A and B)",
     "Every slip must be marked with one category.\n\n"
     "A CATEGORY - Machine or line has STOPPED and there is production loss "
     "directly.\n\n"
     "B CATEGORY - Machine is still RUNNING but production is affected "
     "(adjustment).\n\n"
     "Why it matters: A-category losses hit output immediately, so they are "
     "reviewed first. Marking a real A-category slip as B hides a genuine "
     "production loss from the report.",
     "हर स्लिप पर एक कैटेगरी ज़रूर लगानी होती है।\n\n"
     "A CATEGORY — मशीन या लाइन बंद हो गई है और सीधा प्रोडक्शन लॉस हो रहा है।\n\n"
     "B CATEGORY — मशीन चल तो रही है, पर प्रोडक्शन पर असर पड़ रहा है "
     "(एडजस्टमेंट)।\n\n"
     "यह क्यों ज़रूरी है: A-कैटेगरी का नुकसान तुरंत आउटपुट पर लगता है, इसलिए "
     "पहले उसी को देखा जाता है। असली A-कैटेगरी स्लिप पर B लगा देना एक सच्चे "
     "प्रोडक्शन लॉस को रिपोर्ट से छिपा देता है।"),

    ("Basics", "Down Time vs Response Time",
     "These two are often confused. They are not the same thing.\n\n"
     "RESPONSE TIME - from the moment the call is raised to the moment "
     "maintenance reaches the machine. It measures how quickly we REACT.\n\n"
     "DOWN TIME (M/C down time) - from B/D start time to B/D OK time. It "
     "measures how long PRODUCTION was affected.\n\n"
     "A fast response with a long repair still means a long down time. Both "
     "numbers are tracked separately for this reason.",
     "इन दोनों में अक्सर गड़बड़ हो जाती है। ये एक चीज़ नहीं हैं।\n\n"
     "RESPONSE TIME — कॉल लगने से लेकर मेंटेनेंस के मशीन तक पहुँचने तक का समय। "
     "यह बताता है कि हम कितनी जल्दी पहुँचे।\n\n"
     "DOWN TIME (M/C down time) — B/D स्टार्ट टाइम से B/D OK टाइम तक। यह बताता "
     "है कि प्रोडक्शन कितनी देर रुका रहा।\n\n"
     "जल्दी पहुँच गए पर रिपेयर लंबा चला, तो डाउन टाइम फिर भी लंबा है। इसीलिए "
     "दोनों नंबर अलग-अलग रखे जाते हैं।"),

    ("Basics", "The plant day and the financial year",
     "PLANT DAY: our day runs from 07:00 to 06:30 the next morning, not "
     "midnight to midnight. A call at 6 AM belongs to the PREVIOUS day's "
     "report. This is why a night-shift breakdown appears on the earlier "
     "date.\n\n"
     "FINANCIAL YEAR: April to March. 'FY 2026-27' means 01-Apr-2026 to "
     "31-Mar-2027. Every yearly report on this system follows this, not the "
     "calendar year.",
     "प्लांट दिन: हमारा दिन सुबह 07:00 से अगले दिन 06:30 तक चलता है, रात 12 बजे "
     "से नहीं। सुबह 6 बजे की कॉल पिछले दिन की रिपोर्ट में जाती है। इसीलिए नाइट "
     "शिफ्ट का ब्रेकडाउन पहले वाली तारीख पर दिखता है।\n\n"
     "फाइनेंशियल ईयर: अप्रैल से मार्च। 'FY 2026-27' मतलब 01-अप्रैल-2026 से "
     "31-मार्च-2027। इस सिस्टम की हर सालाना रिपोर्ट इसी हिसाब से बनती है, "
     "कैलेंडर ईयर से नहीं।"),

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
     "इस सिस्टम का हर KPI ब्रेकडाउन स्लिप से ही बनता है। अलग से कुछ टाइप नहीं "
     "किया जाता।\n\n"
     "  • गलत स्टार्ट या OK टाइम → गलत डाउन टाइम → गलत MTTR और गलत "
     "अवेलेबिलिटी\n\n"
     "  • फ्रीक्वेंसी खाली → MTTR और MTBF दोनों गलत (फ्रीक्वेंसी से ही भाग दिया "
     "जाता है)\n\n"
     "  • गलत कैटेगरी → एक सच्चा प्रोडक्शन लॉस रिपोर्ट से गायब\n\n"
     "  • समस्या/एक्शन अधूरा लिखा → अगला बंदा आपकी पूरी जाँच शुरू से दोहराता है\n\n"
     "आज स्लिप पर पाँच मिनट ज़्यादा देने से बाद में घंटों का अंदाज़ा लगाना बच "
     "जाता है।"),

    # ── KPI ─────────────────────────────────────────────────────────────
    ("KPI", "What is a KPI?",
     "KPI = Key Performance Indicator. It is a number that tells you whether "
     "things are getting better or worse, without reading every slip.\n\n"
     "Our maintenance KPIs are: MTTR, MTBF, LTTR, Availability, Breakdown "
     "Frequency, Total Breakdown Hours, and Breakdowns of 60 minutes or "
     "more.\n\n"
     "A KPI is only as honest as the data behind it. Every one of these is "
     "calculated live from the breakdown slips - nothing is typed in by hand.",
     "KPI = Key Performance Indicator. यह एक ऐसा नंबर है जो बिना हर स्लिप पढ़े "
     "बता देता है कि हालत सुधर रही है या बिगड़ रही है।\n\n"
     "हमारे मेंटेनेंस के KPI हैं: MTTR, MTBF, LTTR, अवेलेबिलिटी, ब्रेकडाउन "
     "फ्रीक्वेंसी, कुल ब्रेकडाउन घंटे, और 60 मिनट या उससे ज़्यादा वाले "
     "ब्रेकडाउन।\n\n"
     "KPI उतना ही सच्चा होता है जितना उसके पीछे का डेटा। ये सब लाइव ब्रेकडाउन "
     "स्लिप से बनते हैं — कोई भी हाथ से नहीं भरता।"),

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
     "MTTR बताता है कि मशीन खराब होने के बाद औसतन कितनी देर बंद रहती है।\n\n"
     "फ़ॉर्मूला (जो इस सिस्टम में चलता है):\n\n"
     "    MTTR = कुल डाउन टाइम (मिनट) / कुल ब्रेकडाउन फ्रीक्वेंसी\n\n"
     "इकाई: मिनट। कम हो तो बेहतर।\n\n"
     "ध्यान से: MTTR रिपेयर के समय का है, रेस्पॉन्स टाइम का नहीं। दोनों को मत "
     "मिलाइए।\n\n"
     "MTTR बढ़ रहा हो तो पूछिए: स्पेयर उपलब्ध हैं? शिफ्ट में सही स्किल वाला बंदा "
     "है? क्या वही फ़ॉल्ट बार-बार आ रहा है और हम जुगाड़ करके छोड़ दे रहे हैं?"),

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
     "MTBF बताता है कि मशीन औसतन कितनी देर चलती है, अगली बार खराब होने से "
     "पहले।\n\n"
     "फ़ॉर्मूला (जो इस सिस्टम में चलता है):\n\n"
     "    MTBF = (बीते हुए घंटे − कुल डाउन घंटे) / कुल ब्रेकडाउन फ्रीक्वेंसी\n\n"
     "इकाई: घंटे। ज़्यादा हो तो बेहतर।\n\n"
     "MTTR और MTBF दो अलग सवालों का जवाब देते हैं:\n\n"
     "  MTTR — खराब होने पर हम कितनी जल्दी वापस लाते हैं?\n"
     "  MTBF — वह खराब होती ही कितनी बार है?\n\n"
     "MTBF सुधारना प्रिवेंटिव काम है (PM, DMC, जड़ तक जाकर ठीक करना)। MTTR "
     "सुधारना रिपेयर की तैयारी है (स्पेयर, स्किल, टूल्स)।"),

    ("KPI", "LTTR - Longest Time To Repair",
     "LTTR is the single longest breakdown in the selected period.\n\n"
     "    LTTR = MAX(down time)\n\n"
     "Unit: usually shown in hours. Lower is better.\n\n"
     "Why it is tracked separately: an average can look healthy while one "
     "12-hour breakdown quietly caused most of the month's loss. LTTR makes "
     "that one bad event visible instead of letting the average hide it.",
     "LTTR चुने हुए समय का सबसे लंबा एक ब्रेकडाउन है।\n\n"
     "    LTTR = MAX(डाउन टाइम)\n\n"
     "इकाई: आम तौर पर घंटों में। कम हो तो बेहतर।\n\n"
     "इसे अलग क्यों देखा जाता है: औसत ठीक दिख सकती है, जबकि एक ही 12-घंटे का "
     "ब्रेकडाउन चुपचाप महीने का ज़्यादातर नुकसान कर गया हो। LTTR उस एक बड़ी "
     "घटना को सामने ले आता है, औसत उसे छिपा लेती है।"),

    ("KPI", "Availability",
     "Availability is the share of planned time a machine was actually "
     "available to run.\n\n"
     "    Availability = MTBF / (MTBF + MTTR in hours) x 100\n\n"
     "Unit: PERCENT. Higher is better.\n\n"
     "It combines both sides in one number: breaking rarely (high MTBF) AND "
     "recovering quickly (low MTTR) both push availability up.",
     "अवेलेबिलिटी बताती है कि प्लान किए गए समय में से मशीन असल में कितने समय "
     "चलने लायक थी।\n\n"
     "    Availability = MTBF / (MTBF + MTTR घंटों में) × 100\n\n"
     "इकाई: प्रतिशत। ज़्यादा हो तो बेहतर।\n\n"
     "यह एक ही नंबर में दोनों बातें जोड़ देती है: कम खराब होना (ज़्यादा MTBF) "
     "और जल्दी ठीक हो जाना (कम MTTR) — दोनों अवेलेबिलिटी बढ़ाते हैं।"),

    ("KPI", "Breakdown Frequency",
     "Frequency is how MANY times breakdowns happened - not how long they "
     "lasted.\n\n"
     "Important: our reports add up the FREQUENCY column on the slips, they do "
     "not simply count rows. One slip can record more than one occurrence.\n\n"
     "Frequency is also the divider in both MTTR and MTBF, so a wrong "
     "frequency quietly corrupts both of those KPIs.",
     "फ्रीक्वेंसी बताती है कि ब्रेकडाउन कितनी बार हुआ — कितनी देर चला यह नहीं।\n\n"
     "ज़रूरी बात: हमारी रिपोर्ट स्लिप के FREQUENCY कॉलम को जोड़ती है, सिर्फ़ "
     "पंक्तियाँ नहीं गिनती। एक स्लिप पर एक से ज़्यादा बार भी दर्ज हो सकती है।\n\n"
     "फ्रीक्वेंसी से ही MTTR और MTBF दोनों में भाग दिया जाता है, इसलिए गलत "
     "फ्रीक्वेंसी चुपचाप दोनों KPI खराब कर देती है।"),

    # ── CAPA ────────────────────────────────────────────────────────────
    ("CAPA", "Breakdowns of 60 minutes or more",
     "Any breakdown whose down time is 60 MINUTES OR MORE is treated as a "
     "serious loss and needs a CAPA.\n\n"
     "Note the rule carefully: it is 60 minutes OR MORE. A breakdown of exactly "
     "60 minutes DOES count.\n\n"
     "(Earlier two pages disagreed on this - one used 'more than 60' and the "
     "other used '60 or more' - and the counts never matched. The whole system "
     "now uses 60-or-more everywhere.)",
     "जिस ब्रेकडाउन का डाउन टाइम 60 मिनट या उससे ज़्यादा है, उसे बड़ा नुकसान "
     "माना जाता है और उसकी CAPA बनती है।\n\n"
     "नियम ध्यान से: 60 मिनट या उससे ज़्यादा। ठीक 60 मिनट वाला ब्रेकडाउन भी "
     "गिना जाता है।\n\n"
     "(पहले दो पेज इस पर अलग चलते थे — एक '60 से ज़्यादा' और दूसरा '60 या उससे "
     "ज़्यादा' — और गिनती कभी मिलती ही नहीं थी। अब पूरे सिस्टम में '60 या उससे "
     "ज़्यादा' ही चलता है।)"),

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
     "CORRECTIVE — जो दिक्कत हुई उसे ठीक करना।\n"
     "PREVENTIVE — पक्का करना कि वह दोबारा हो ही न सके।\n\n"
     "टूटा हुआ सेंसर बदल देना करेक्टिव है। यह पता लगाना कि सेंसर बार-बार चोट "
     "क्यों खा रहा है और उस पर गार्ड लगा देना प्रिवेंटिव है। आगे के ब्रेकडाउन "
     "सिर्फ़ दूसरी वाली चीज़ कम करती है।\n\n"
     "हमारे सिस्टम में 60 मिनट या उससे ज़्यादा का हर ब्रेकडाउन CAPA बनता है, और "
     "QPR शीट भरकर ही बंद होता है।"),

    ("CAPA", "What is QPR?",
     "QPR is the quality problem report sheet used to close a CAPA.\n\n"
     "It walks through the problem in order: what was observed, how it was "
     "confirmed, what was done immediately to contain it, what the root cause "
     "was for OCCURRENCE and for OUTFLOW, and what permanent action was "
     "taken.\n\n"
     "A CAPA is not closed because the machine is running again. It is closed "
     "when the QPR shows the cause was found and blocked.",
     "QPR वह क्वालिटी प्रॉब्लम रिपोर्ट शीट है जिससे CAPA बंद की जाती है।\n\n"
     "यह समस्या को क्रम से लेकर चलती है: क्या दिखा, उसे कन्फ़र्म कैसे किया, "
     "तुरंत रोकने के लिए क्या किया, जड़ क्या थी — OCCURRENCE की भी और OUTFLOW "
     "की भी, और पक्का इलाज क्या किया।\n\n"
     "CAPA इसलिए बंद नहीं होती कि मशीन फिर से चल पड़ी। वह तब बंद होती है जब QPR "
     "दिखा दे कि जड़ मिल गई और उसे रोक दिया गया।"),

    # ── Preventive ──────────────────────────────────────────────────────
    ("Preventive", "PM - Preventive Maintenance",
     "PM is planned servicing done BEFORE the machine fails - cleaning, "
     "lubrication, tightening, checking wear, replacing parts on schedule.\n\n"
     "Each machine has a PM frequency and a yearly schedule of planned weeks. "
     "When PM is actually done, the actual week and date are recorded, so plan "
     "vs actual can be compared.\n\n"
     "PM is the main lever on MTBF. Breakdown repair only restores what was "
     "lost; PM is what stops the loss from happening.",
     "PM वह प्लान की गई सर्विसिंग है जो मशीन के खराब होने से पहले की जाती है — "
     "सफ़ाई, ग्रीसिंग/ऑइलिंग, कसना, घिसावट देखना, और शेड्यूल के हिसाब से पार्ट "
     "बदलना।\n\n"
     "हर मशीन की एक PM फ्रीक्वेंसी होती है और साल भर का प्लान होता है कि किस "
     "हफ़्ते PM करनी है। PM हो जाने पर असली हफ़्ता और तारीख भरी जाती है, ताकि "
     "प्लान और एक्चुअल की तुलना हो सके।\n\n"
     "MTBF सुधारने का सबसे बड़ा ज़रिया PM ही है। ब्रेकडाउन रिपेयर तो सिर्फ़ जो "
     "चला गया उसे वापस लाता है; PM उस नुकसान को होने ही नहीं देती।"),

    ("Preventive", "DMC - Daily Machine Check",
     "DMC is the short daily check the operator does on the machine - a small "
     "list of points marked OK or NG every day.\n\n"
     "It is the cheapest early warning available. A loose guard, a small leak "
     "or an odd sound caught in a 5-minute daily check is a 10-minute job; the "
     "same thing found after failure can cost a full shift.\n\n"
     "An NG point raised in DMC goes to maintenance for action.",
     "DMC वह छोटी सी रोज़ की जाँच है जो ऑपरेटर मशीन पर करता है — कुछ पॉइंट की "
     "लिस्ट, जिन्हें रोज़ OK या NG मार्क किया जाता है।\n\n"
     "यह सबसे सस्ती पहले से मिलने वाली चेतावनी है। ढीला गार्ड, हल्की लीकेज या अजीब आवाज़ अगर "
     "5 मिनट की रोज़ की जाँच में पकड़ ली जाए तो 10 मिनट का काम है; वही चीज़ फ़ेल "
     "होने के बाद मिले तो पूरी शिफ़्ट ले सकती है।\n\n"
     "DMC में उठाया गया NG पॉइंट मेंटेनेंस के पास एक्शन के लिए जाता है।"),

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
     "ANDON शॉप फ़्लोर का कॉल सिस्टम है। मशीन में दिक्कत होने पर ऑपरेटर बटन "
     "दबाता है और सही डिपार्टमेंट को कॉल चली जाती है — मेंटेनेंस, टूल रूम, "
     "क्वालिटी, मैटेरियल वग़ैरह।\n\n"
     "कॉल में दर्ज होता है कि वह कब शुरू हुई, कब किसी ने रेस्पॉन्स दिया, और कब "
     "ख़त्म हुई। इससे रेस्पॉन्स टाइम और ड्यूरेशन अपने आप मिल जाते हैं, किसी को "
     "लिखना नहीं पड़ता।\n\n"
     "मेंटेनेंस और टूल रूम के लिए टावर लाइट तभी बुझ जाती है जब कोई रेस्पॉन्स दे "
     "देता है। बाकी डिपार्टमेंट के लिए वह कॉल बंद होने तक जलती रहती है।"),

    ("ANDON", "Total Loss and why lines are counted separately",
     "When two departments are called on the same line, the time is not counted "
     "twice - the newest call takes over, and the earlier one resumes when the "
     "newer one ends.\n\n"
     "But two different LINES can be down at the same time, and both losses are "
     "real. So the loss is worked out separately for each line and then added "
     "up. Treating the whole plant as one timeline would under-report the loss.",
     "जब एक ही लाइन पर दो डिपार्टमेंट को कॉल जाती है, तो समय दो बार नहीं गिना "
     "जाता — नई कॉल पुरानी को रोक देती है, और नई ख़त्म होने पर पुरानी फिर से "
     "चालू हो जाती है।\n\n"
     "पर दो अलग लाइन एक ही वक़्त पर बंद हो सकती हैं, और दोनों का नुकसान असली "
     "है। इसलिए नुकसान हर लाइन का अलग निकालकर फिर जोड़ा जाता है। पूरे प्लांट को "
     "एक ही टाइमलाइन मान लेने से नुकसान कम दिखता।"),
]
