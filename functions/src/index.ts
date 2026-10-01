import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Razorpay from 'razorpay';

admin.initializeApp();
// maxInstances caps concurrent Cloud Run instances so a traffic spike or abuse
// can't scale costs unboundedly — safe for a low-traffic personal app.
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Pro unlock is a one-time purchase: ₹299, in paise.
const PRO_UNLOCK_AMOUNT_PAISE = 29900;
const PRO_UNLOCK_CURRENCY = 'INR';

export const createRazorpayOrder = onCall(
  { secrets: [razorpayKeyId, razorpayKeySecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const instance = new Razorpay({
      key_id: razorpayKeyId.value(),
      key_secret: razorpayKeySecret.value(),
    });

    const order = await instance.orders.create({
      amount: PRO_UNLOCK_AMOUNT_PAISE,
      currency: PRO_UNLOCK_CURRENCY,
      receipt: `pro_${request.auth.uid}_${Date.now()}`,
      notes: { uid: request.auth.uid, product: 'pro_unlock' },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId.value(),
    };
  }
);

export const verifyRazorpayPayment = onCall(
  { secrets: [razorpayKeyId, razorpayKeySecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { orderId, paymentId, signature } = (request.data ?? {}) as {
      orderId?: string;
      paymentId?: string;
      signature?: string;
    };
    if (!orderId || !paymentId || !signature) {
      throw new HttpsError('invalid-argument', 'Missing payment details.');
    }

    const expectedSignature = crypto
      .createHmac('sha256', razorpayKeySecret.value())
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (expectedSignature !== signature) {
      throw new HttpsError('permission-denied', 'Payment signature verification failed.');
    }

    // The signature alone doesn't bind the payment to this caller — without this
    // check, someone could replay another user's genuine orderId/paymentId/signature
    // triple (e.g. observed over the network) to unlock their own account for free.
    const instance = new Razorpay({
      key_id: razorpayKeyId.value(),
      key_secret: razorpayKeySecret.value(),
    });
    const order = await instance.orders.fetch(orderId);
    if (order.notes?.uid !== request.auth.uid || order.notes?.product !== 'pro_unlock') {
      throw new HttpsError('permission-denied', 'This order does not belong to you.');
    }
    if (order.amount !== PRO_UNLOCK_AMOUNT_PAISE || order.currency !== PRO_UNLOCK_CURRENCY) {
      throw new HttpsError('failed-precondition', 'Unexpected order amount.');
    }

    const db = admin.firestore();
    const paymentRef = db.doc(`payments/${paymentId}`);

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(paymentRef);
      if (existing.exists) {
        // Already processed (e.g. duplicate client retry) — nothing further to do.
        return;
      }
      tx.set(paymentRef, {
        uid: request.auth!.uid,
        orderId,
        amount: order.amount,
        currency: order.currency,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(
        db.doc(`users/${request.auth!.uid}`),
        { proUnlocked: true, proUnlockedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    });

    return { ok: true };
  }
);

export const deleteAccount = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = request.auth.uid;
  const db = admin.firestore();

  // payments/{paymentId} records are kept indefinitely for financial/accounting
  // records — deleting the user's own data and Auth account does not remove them.
  const expensesSnap = await db.collection(`users/${uid}/expenses`).get();
  const batch = db.batch();
  expensesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(db.doc(`users/${uid}`));
  await batch.commit();

  // A retried request (e.g. the first call timed out client-side after
  // succeeding) finds the Auth user already gone — treat that as success.
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }

  return { ok: true };
});

// Secrets set by piping a file on Windows can carry a UTF-8 BOM or trailing
// newline, which fetch rejects as an invalid header value.
function cleanSecret(value: string): string {
  return value.replace(/^﻿/, '').trim();
}

const GEMINI_MODEL = 'gemini-flash-latest';
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_TURNS = 10;

interface CoachChatMessage {
  role: 'user' | 'coach';
  text: string;
}

interface CoachContext {
  salary: number;
  rent: number;
  emi: number;
  expenses: number;
  sip: number;
  sipAmt: number;
  sipR: number;
  sipY: number;
  taxIncome: number;
  tax80c: number;
  taxHra: number;
  affIncome: number;
  affDown: number;
  affRate: number;
  affTenure: number;
  scoreTotal: number;
}

function buildCoachSystemPrompt(ctx: CoachContext): string {
  return [
    "You are Money Coach, a warm and practical financial assistant inside the SalaryWise app, talking to an Indian user.",
    'All amounts are in INR. Ground every answer in the numbers below — do not ask the user to repeat information you already have.',
    'Keep replies short: 2-5 sentences, plain language, no markdown headers or bullet walls.',
    "This is general financial education, not certified financial, tax, or legal advice — say so briefly only when giving a specific tax or investment recommendation.",
    '',
    "User's numbers this month:",
    `- Monthly salary (take-home): ₹${ctx.salary}`,
    `- Rent: ₹${ctx.rent}`,
    `- EMI outgo: ₹${ctx.emi}`,
    `- Other monthly expenses: ₹${ctx.expenses}`,
    `- Current SIP investment: ₹${ctx.sip}`,
    `- SIP planning inputs: ₹${ctx.sipAmt}/month at ${ctx.sipR}% expected return for ${ctx.sipY} years`,
    `- Annual taxable income: ₹${ctx.taxIncome}, Section 80C: ₹${ctx.tax80c}, HRA exemption: ₹${ctx.taxHra}`,
    `- Home affordability inputs: income ₹${ctx.affIncome}/month, down payment ₹${ctx.affDown}, loan rate ${ctx.affRate}%, tenure ${ctx.affTenure} years`,
    `- Their overall SalaryWise financial score: ${ctx.scoreTotal}/100`,
  ].join('\n');
}

export const askMoneyCoach = onCall(
  { secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const userDoc = await admin.firestore().doc(`users/${request.auth.uid}`).get();
    if (!userDoc.data()?.proUnlocked) {
      throw new HttpsError('permission-denied', 'Money Coach is a Pro feature.');
    }

    const { message, context, history } = (request.data ?? {}) as {
      message?: string;
      context?: CoachContext;
      history?: CoachChatMessage[];
    };
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new HttpsError('invalid-argument', 'Message is required.');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new HttpsError('invalid-argument', 'Message is too long.');
    }
    if (!context) {
      throw new HttpsError('invalid-argument', 'Financial context is required.');
    }

    const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
    const contents = [
      ...recentHistory.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('model' as const),
        parts: [{ text: String(m.text).slice(0, MAX_MESSAGE_LENGTH) }],
      })),
      { role: 'user' as const, parts: [{ text: message.trim() }] },
    ];

    const callGemini = () =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': cleanSecret(geminiApiKey.value()),
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildCoachSystemPrompt(context) }] },
          contents,
          generationConfig: { maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });

    let response = await callGemini();
    // Gemini returns 503 when the model is briefly overloaded — a short retry
    // usually succeeds without the user needing to resend their message.
    if (response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await callGemini();
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error', response.status, errText);
      throw new HttpsError('internal', 'Money Coach is unavailable right now. Please try again.');
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!reply) {
      throw new HttpsError('internal', 'Money Coach could not generate a reply.');
    }

    return { reply };
  }
);
