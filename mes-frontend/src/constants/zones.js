// The six PRODUCTION zones shown in every Zone selection across the app.
// (Only the Preventive Maintenance pages keep the full master zone list.)
// Order fixed as the user specified.
export const PROD_ZONES = [
  "SEAT_SLIDER",
  "RECLINER",
  "SUB_ASSEMBLY",
  "PRESS_SHOP",
  "THIN_RECLINER",
  "LOOP_PIPE",
];

// Keep only the production zones (in PROD_ZONES order) from a zone list.
export const onlyProdZones = (zones) =>
  (zones || [])
    .filter((z) => PROD_ZONES.includes(z))
    .sort((a, b) => PROD_ZONES.indexOf(a) - PROD_ZONES.indexOf(b));
