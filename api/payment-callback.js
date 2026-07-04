// /api/payment-callback.js
// PayHero POSTs here after an STK Push completes (success, failure, or
// cancellation). We parse the ExternalReference to find which Firestore
// user to upgrade, and use the Firebase Admin SDK (not the client SDK)
// because this runs server-side and must bypass the "users can only write
// their own doc" security rule — only this trusted backend should be able
// to grant the "pro" tier.
//
// Requires these Vercel env vars:
//   FIREBASE_SERVICE_ACCOUNT  - the full JSON of a Firebase service account
//                               key, stringified into one line. Generate one
//                               in Firebase Console -> Project Settings ->
//                               Service Accounts -> Generate new private key.

import admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (err) {
    console.error('Firebase Admin init failed — check FIREBASE_SERVICE_ACCOUNT env var:', err);
  }
}

const USERS_COLLECTION = 'biasharastock_users';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // PayHero always responds 200 expected — always ack even on our own
  // errors below, so PayHero doesn't retry-storm us; just log problems.
  const body = req.body || {};
  const result = body.response || body;

  const externalReference = result.ExternalReference;
  const resultCode = result.ResultCode;
  const status = result.Status;
  const mpesaReceipt = result.MpesaReceiptNumber;

  console.log('PayHero callback received:', { externalReference, resultCode, status });

  if (!externalReference || !externalReference.startsWith('PRO-')) {
    console.warn('Callback missing or unrecognized external_reference:', externalReference);
    return res.status(200).json({ received: true });
  }

  // external_reference shape: PRO-<uid>-<timestamp>
  const parts = externalReference.split('-');
  const uid = parts.length >= 3 ? parts.slice(1, -1).join('-') : null;

  if (!uid) {
    console.warn('Could not extract uid from external_reference:', externalReference);
    return res.status(200).json({ received: true });
  }

  const isSuccess = resultCode === 0 || status === 'Success';

  if (!isSuccess) {
    console.log(`Payment for uid ${uid} did not succeed (status: ${status}). No tier change.`);
    return res.status(200).json({ received: true });
  }

  if (!admin.apps.length) {
    console.error('Firebase Admin not initialized — cannot upgrade user tier.');
    return res.status(200).json({ received: true });
  }

  try {
    const db = admin.firestore();
    await db.collection(USERS_COLLECTION).doc(uid).set(
      {
        tier: 'pro',
        proSince: admin.firestore.FieldValue.serverTimestamp(),
        lastPaymentReceipt: mpesaReceipt || null
      },
      { merge: true }
    );
    console.log(`Upgraded uid ${uid} to Pro tier. Receipt: ${mpesaReceipt}`);
  } catch (err) {
    console.error('Failed to update Firestore tier for uid', uid, err);
  }

  return res.status(200).json({ received: true });
}
