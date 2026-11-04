/** Display copy only. Algorithm names, order values and saved analysis stay unchanged. */
export const similarityCopy = {
  clip: {
    label: 'subject',
    order: 'Subject similarity',
    method: 'Subject',
    explanation: 'Brings images with related subjects and scenes together.',
    reference: { label: 'MobileCLIP-S0', href: 'https://machinelearning.apple.com/research/mobileclip' },
  },
  color: {
    label: 'color',
    method: 'Color',
    explanation: 'Finds similar mixes of colors, wherever they appear in the image.',
  },
  pattern: {
    order: 'Pattern similarity',
    explanation: 'Brings images with similar light-and-dark patterns together.',
    reference: { label: 'pHash', href: 'https://www.phash.org/docs/design.html' },
  },
} as const;
