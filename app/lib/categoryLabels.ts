// Display labels for the 8 category values a classification can carry — a
// fixed canonical order (rather than whatever order SQLite happens to return)
// so any list/breakdown built from these reads like a considered order, not a
// database dump. Shared between ClosetScreen (the filter chip bar) and
// InsightsScreen (the category breakdown) rather than each defining its own
// copy of the same 8-entry mapping.
export const CATEGORY_ORDER = [
  "tops",
  "bottoms",
  "outerwear",
  "dresses",
  "footwear",
  "activewear",
  "underwear-sleepwear",
  "accessories",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  outerwear: "Outerwear",
  dresses: "Dresses",
  footwear: "Footwear",
  activewear: "Activewear",
  "underwear-sleepwear": "Underwear & Sleepwear",
  accessories: "Accessories",
};
