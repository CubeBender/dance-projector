# Output pages – design notes

- **Audience and job:** parents and dancers in the hall, finding their start number in a heat from a distance.
- **Signature:** start numbers, judge letters and competition numbers are drawn as competitor back-number cards: white card, heavy condensed black numerals, a thin strip in the floor-side colour.
- **Colour:** the only accent is the slot's floor-side colour (`--side`). Everything else is white paper, near-black ink and dark glass plates (`rgba(9,11,18,0.8)`) over a transparent page.
- **Type:** Bahnschrift (built into Windows, DIN-like, variable width) for numerals, titles and captions; Segoe UI for names. No web fonts, so it works offline in OBS.
- **Dance progress:** dances shown in order as pills; done ones struck through, current one filled. This is a real sequence, so the order carries meaning.
- **Fit:** the heats page measures the space below the header and sizes rows to fill it (40–110 px). Wide heats split into sub-columns while there is room (max 4 columns).
- **Motion:** a short settle-in with stagger only when the content changes (new dance, new competition). Routine polls never re-render. Reduced motion is respected.
- **Tried and changed:** first version estimated header height and left the bottom quarter empty with small names; replaced with measuring. Names went from 0.30 to 0.42 of the row height.
