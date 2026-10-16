/** Reuse collation options instead of constructing a collator for every comparison. */
export const compareNames = new Intl.Collator(undefined, { numeric: true }).compare;
