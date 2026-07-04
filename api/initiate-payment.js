// /api/initiate-payment.js
// Vercel serverless function. Triggers a PayHero M-Pesa STK Push to the
// customer's phone for the Ksh 500/month Pro upgrade.
//
// Requires these Vercel env vars:
//   PAYHERO_AUTH_TOKEN   - the Basic auth token from your PayHero dashboard
//                          (Payment Channels -> API Credentials), e.g. the
//                          full "Basic xxxxx" string or just the base64 part.
//   PAYHERO_CHANNEL_ID   - your registered payment channel ID (a number)
//   APP_BASE_URL         - your deployed site's base URL, e.g.
//                          https://biasharastock.vercel.app
//                          (used to build the callback_url PayHero will hit)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, uid } = req.body || {};
  if (!phone || !uid) {
    return res.status(400).json({ error: 'Missing "phone" or "uid".' });
  }

  const authToken = process.env.PAYHERO_AUTH_TOKEN;
  const channelId = process.env.PAYHERO_CHANNEL_ID;
  const baseUrl = process.env.APP_BASE_URL;

  if (!authToken || !channelId || !baseUrl) {
    return res.status(500).json({ error: 'Server is missing PayHero configuration.' });
  }

  // Normalize to 07XXXXXXXX / 01XXXXXXXX format PayHero expects.
  let normalizedPhone = phone.replace(/\D/g, '');
  if (normalizedPhone.startsWith('254')) normalizedPhone = '0' + normalizedPhone.slice(3);
  if (normalizedPhone.length !== 10 || !normalizedPhone.startsWith('0')) {
    return res.status(400).json({ error: 'Enter a valid phone number, e.g. 0712345678.' });
  }

  // uid becomes part of the external_reference so the callback can map the
  // payment straight back to the Firestore user document without a lookup.
  const externalReference = `PRO-${uid}-${Date.now()}`;

  try {
    const response = await fetch('https://backend.payhero.co.ke/api/v2/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken.startsWith('Basic ') ? authToken : `Basic ${authToken}`
      },
      body: JSON.stringify({
        amount: 500,
        phone_number: normalizedPhone,
        channel_id: Number(channelId),
        provider: 'm-pesa',
        external_reference: externalReference,
        customer_name: 'BiasharaStock Pro Upgrade',
        callback_url: `${baseUrl}/api/payment-callback`
      })
    });

    const data = await response.json();

    if (!response.ok || data.success === false) {
      console.error('PayHero initiate error:', data);
      return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
    }

    // Return the reference so the client can show "check your phone" and,
    // if you later add polling, look up status by this reference.
    return res.status(200).json({
      status: data.status || 'QUEUED',
      reference: data.reference,
      checkoutRequestId: data.CheckoutRequestID
    });
  } catch (err) {
    console.error('initiate-payment error:', err);
    return res.status(500).json({ error: 'Server error while starting the payment.' });
  }
}
