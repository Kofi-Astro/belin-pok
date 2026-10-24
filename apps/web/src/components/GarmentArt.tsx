// Simple drawings of the garments the shop sells, used wherever a photo is
// missing -- category tiles, product cards, the product page, the home page
// banner -- so a shop still being photographed looks deliberate rather than
// full of empty grey boxes. Drawn as SVG (crisp at any size, nothing to
// download); the garment is picked from a name ("Jeans shorts" -> shorts,
// "Sweatshirts" -> hoodie) and the colours from a fixed palette, so the
// same product or category always gets the same look.

export type GarmentKind = "cap" | "tee" | "hoodie" | "jacket" | "suit" | "shorts" | "trousers" | "boxers" | "socks" | "hanger";

// Checked in order: more specific words first ("sweatshirt" before
// "shirt", "jeans shorts" before "jeans").
const KEYWORDS: [GarmentKind, RegExp][] = [
  ["socks", /sock/i],
  ["boxers", /boxer|brief|underwear|trunk/i],
  ["cap", /\bcaps?\b|hat|beanie|snapback|headwear/i],
  ["suit", /suit|blazer|tux/i],
  ["hoodie", /sweat|hood|pullover|fleece/i],
  ["jacket", /jacket|coat|bomber|windbreaker|outerwear/i],
  ["shorts", /short/i],
  ["trousers", /jogger|trouser|pant|jean|chino|track/i],
  ["tee", /tee|t-shirt|tshirt|shirt|polo|top|vest/i],
];

export function garmentFor(...names: (string | null | undefined)[]): GarmentKind {
  for (const name of names) {
    if (!name) continue;
    for (const [kind, pattern] of KEYWORDS) if (pattern.test(name)) return kind;
  }
  return "hanger";
}

// [background, garment] colour pairs in the brand's family.
const PALETTE: [string, string][] = [
  ["#efe7fb", "#4b2884"],
  ["#fdeee4", "#c2410c"],
  ["#e5f3ec", "#1f7a5a"],
  ["#fbf1d9", "#a16207"],
  ["#e6eef9", "#1e4f9a"],
  ["#f8e6ee", "#9d2b5c"],
];

function paletteFor(seed: string): [string, string] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** The drawing itself, in a 100x100 box. Main shapes use `fill`; darker
 * details use the same colour at lower opacity, so one colour styles it. */
export function GarmentIcon({ kind, className, color = "currentColor" }: { kind: GarmentKind; className?: string; color?: string }) {
  const shade = { fill: color, fillOpacity: 0.55 };
  const line = { stroke: color, strokeOpacity: 0.45, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const };
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {kind === "cap" && (
        <>
          <path d="M22 60 C22 36 35 24 50 24 C65 24 78 36 78 60 Z" fill={color} />
          <path d="M12 62 Q50 52 88 62 Q88 71 50 68 Q12 71 12 62 Z" {...shade} />
          <circle cx="50" cy="24" r="3.5" {...shade} />
          <path d="M50 27 L50 58 M36 30 Q34 44 35 58 M64 30 Q66 44 65 58" {...line} />
        </>
      )}
      {kind === "tee" && (
        <>
          <path d="M35 20 L21 27 L10 42 L21 50 L28 45 L28 84 L72 84 L72 45 L79 50 L90 42 L79 27 L65 20 Q58 29 50 29 Q42 29 35 20 Z" fill={color} />
          <path d="M37 21 Q50 34 63 21" {...line} strokeOpacity={0.6} strokeWidth={3} />
          <path d="M28 45 L28 50 M72 45 L72 50" {...line} />
        </>
      )}
      {kind === "hoodie" && (
        <>
          <path d="M33 25 L20 31 L11 76 L22 78 L28 50 L28 86 L72 86 L72 50 L78 78 L89 76 L80 31 L67 25 Z" fill={color} />
          <path d="M35 27 Q34 11 50 11 Q66 11 65 27 Q59 35 50 35 Q41 35 35 27 Z" {...shade} />
          <path d="M37 64 L63 64 L67 77 L33 77 Z" {...shade} fillOpacity={0.35} />
          <path d="M45 35 L44 47 M55 35 L56 47" {...line} strokeOpacity={0.7} />
          <path d="M28 82 L72 82 M11 74 L22 76 M78 76 L89 74" {...line} />
        </>
      )}
      {kind === "jacket" && (
        <>
          <path d="M33 21 L20 27 L11 76 L22 78 L28 48 L28 86 L72 86 L72 48 L78 78 L89 76 L80 27 L67 21 L50 33 Z" fill={color} />
          <path d="M33 21 L43 19 L50 33 Z M67 21 L57 19 L50 33 Z" {...shade} />
          <path d="M50 33 L50 86" {...line} strokeOpacity={0.7} />
          <path d="M34 62 L44 62 M56 62 L66 62 M28 82 L72 82" {...line} />
        </>
      )}
      {kind === "suit" && (
        <>
          <path d="M33 21 L20 27 L11 76 L22 78 L28 48 L28 86 L72 86 L72 48 L78 78 L89 76 L80 27 L67 21 L50 52 Z" fill={color} />
          <path d="M40 19 L50 52 L60 19 Z" fill="#ffffff" fillOpacity={0.9} />
          <path d="M47 24 L53 24 L51 29 L54 46 L50 51 L46 46 L49 29 Z" {...shade} />
          <path d="M33 21 L41 19 L46 40 Z M67 21 L59 19 L54 40 Z" {...shade} fillOpacity={0.35} />
          <circle cx="50" cy="62" r="1.8" {...shade} />
          <circle cx="50" cy="71" r="1.8" {...shade} />
        </>
      )}
      {kind === "shorts" && (
        <>
          <path d="M25 30 L75 30 L80 74 L56 76 L50 48 L44 76 L20 74 Z" fill={color} />
          <path d="M25 24 L75 24 L75 31 L25 31 Z" {...shade} />
          <path d="M46 31 L46 42 M54 31 L54 42 M30 38 Q36 42 42 38" {...line} />
        </>
      )}
      {kind === "trousers" && (
        <>
          <path d="M29 18 L71 18 L76 86 L56 88 L50 38 L44 88 L24 86 Z" fill={color} />
          <path d="M29 12 L71 12 L71 19 L29 19 Z" {...shade} />
          <path d="M24 82 L44 84 L44 88 L24 86 Z M56 84 L76 82 L76 86 L56 88 Z" {...shade} />
          <path d="M46 19 L46 26 M54 19 L54 26 M33 24 Q39 28 45 24" {...line} />
        </>
      )}
      {kind === "boxers" && (
        <>
          <path d="M24 36 L76 36 L78 70 L58 72 L50 58 L42 72 L22 70 Z" fill={color} />
          <path d="M24 27 L76 27 L76 37 L24 37 Z" {...shade} />
          <path d="M50 37 L50 56" {...line} />
        </>
      )}
      {kind === "socks" && (
        <>
          <path d="M34 16 L54 16 L54 60 Q54 68 62 71 L76 76 Q86 80 81 87 Q77 92 68 89 L42 82 Q34 79 34 69 Z" fill={color} />
          <path d="M34 16 L54 16 L54 26 L34 26 Z" {...shade} />
          <path d="M34 34 L54 34 M34 40 L54 40" {...line} strokeOpacity={0.6} strokeWidth={3} />
        </>
      )}
      {kind === "hanger" && (
        <>
          <path d="M44 24 a6 6 0 1 1 6 6 L50 38" {...line} strokeOpacity={1} strokeWidth={4} />
          <path d="M50 38 L12 66 Q8 72 16 72 L84 72 Q92 72 88 66 Z" fill={color} />
          <path d="M18 66 L82 66" {...line} />
        </>
      )}
    </svg>
  );
}

/** A tinted card with the right drawing, filling its parent -- the stand-in
 * for a missing photo. `name` picks both the garment and the colours;
 * `hint` (e.g. the category) is used when the name alone says nothing. */
export function GarmentArt({ name, hint, className = "", dark = false }: { name: string; hint?: string | null; className?: string; dark?: boolean }) {
  const kind = garmentFor(name, hint);
  const [bg, fg] = paletteFor(`${hint ?? ""}${name}`);
  return (
    <div className={`flex h-full w-full items-center justify-center ${className}`} style={dark ? undefined : { background: bg }}>
      <GarmentIcon kind={kind} className="h-1/2 w-1/2 drop-shadow-sm" color={dark ? "rgba(255,255,255,0.85)" : fg} />
    </div>
  );
}
