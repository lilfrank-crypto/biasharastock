// /api/stock-insight.js
// Vercel serverless function. NO AI call — pure deterministic logic, so
// it's free, instant, and never unreliable. Looks at stock vs threshold
// ratios and returns one actionable sentence, Kenyan-shop-owner style.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { payload } = req.body || {};
  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({ error: 'Missing or empty "payload" array.' });
  }

  const insight = buildInsight(payload);
  return res.status(200).json({ insight });
}

function buildInsight(products) {
  const withRatio = products
    .filter((p) => typeof p.stock === 'number' && typeof p.threshold === 'number' && p.threshold > 0)
    .map((p) => ({ ...p, ratio: p.stock / p.threshold }));

  if (!withRatio.length) {
    return "Add stock and threshold numbers to your products to get insights here.";
  }

  const outOfStock = withRatio.filter((p) => p.stock <= 0);
  const critical = withRatio.filter((p) => p.stock > 0 && p.ratio <= 1);
  const gettingLow = withRatio.filter((p) => p.ratio > 1 && p.ratio <= 1.5);

  if (outOfStock.length) {
    const names = outOfStock.slice(0, 3).map((p) => p.name).join(', ');
    const extra = outOfStock.length > 3 ? ` and ${outOfStock.length - 3} more` : '';
    return `⚠️ You're completely out of ${names}${extra} — restock these first, you're losing sales right now.`;
  }

  if (critical.length) {
    const names = critical.slice(0, 3).map((p) => p.name).join(', ');
    const extra = critical.length > 3 ? ` and ${critical.length - 3} more` : '';
    return `${names}${extra} ${critical.length === 1 ? 'is' : 'are'} at or below your reorder point — plan to restock within the next day or two.`;
  }

  if (gettingLow.length) {
    const names = gettingLow.slice(0, 3).map((p) => p.name).join(', ');
    return `${names} ${gettingLow.length === 1 ? 'is' : 'are'} getting close to your reorder point — worth keeping an eye on this week.`;
  }

  return "✅ All your stock levels look healthy right now. No action needed.";
}
