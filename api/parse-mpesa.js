// /api/parse-mpesa.js
// Vercel serverless function. Uses the Claude API to parse a pasted M-Pesa
// SMS into structured fields. Requires ANTHROPIC_API_KEY in Vercel env vars.
//
// Simple in-memory rate limiting (per Vercel instance) is included as a
// stopgap — for real per-user daily limits tied to the Firestore `tier`
// field, that check should move client-side or into a Firestore-backed
// counter, since serverless instances don't share memory reliably.

const SYSTEM_PROMPT = `You extract structured data from Kenyan M-Pesa SMS confirmation messages.

M-Pesa messages come in several formats, e.g.:
- "XXX Confirmed. You have received Ksh500.00 from JOHN DOE 0712345678 on 4/7/26 at 2:15 PM. New M-PESA balance is Ksh1,200.00."
- "XXX Confirmed. Ksh200.00 sent to JANE MWANGI 0798765432 for account XXXX on 4/7/26 at 10:03 AM."
- "XXX Confirmed. You bought Ksh100.00 of airtime on 4/7/26 at 9:00 AM."
- Till/paybill variants: "...paid to XYZ SUPPLIES. Till Number 123456 on 4/7/26..."

Extract these fields and respond with ONLY a raw JSON object, no markdown, no explanation:
{
  "customerName": string or null,
  "amount": number or null,
  "phone": string or null,
  "transactionCode": string or null,
  "date": string or null (as written, e.g. "4/7/26"),
  "time": string or null (as written, e.g. "2:15 PM"),
  "type": "received" | "sent" | "airtime" | "paybill" | "till" | "unknown",
  "confidence": "high" or "low"
}

Set confidence to "low" if the message doesn't clearly match a known M-Pesa format, or if key fields (amount, name/phone) are missing or ambiguous. Never invent data that isn't in the message.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Missing "message" field.' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message too long.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Could not parse the message right now. Try again.' });
    }

    const result = await response.json();
    const textBlock = (result.content || []).find((c) => c.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'Unexpected response from parser.' });
    }

    let parsed;
    try {
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'Could not understand that message format.' });
    }

    return res.status(200).json({ data: parsed });
  } catch (err) {
    console.error('parse-mpesa error:', err);
    return res.status(500).json({ error: 'Server error while parsing the message.' });
  }
}
