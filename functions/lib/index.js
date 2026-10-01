"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askMoneyCoach = exports.deleteAccount = exports.verifyRazorpayPayment = exports.createRazorpayOrder = void 0;
const crypto = __importStar(require("crypto"));
const admin = __importStar(require("firebase-admin"));
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const razorpay_1 = __importDefault(require("razorpay"));
admin.initializeApp();
// maxInstances caps concurrent Cloud Run instances so a traffic spike or abuse
// can't scale costs unboundedly — safe for a low-traffic personal app.
(0, v2_1.setGlobalOptions)({ region: 'asia-south1', maxInstances: 10 });
const razorpayKeyId = (0, params_1.defineSecret)('RAZORPAY_KEY_ID');
const razorpayKeySecret = (0, params_1.defineSecret)('RAZORPAY_KEY_SECRET');
const geminiApiKey = (0, params_1.defineSecret)('GEMINI_API_KEY');
// Pro unlock is a one-time purchase: ₹299, in paise.
const PRO_UNLOCK_AMOUNT_PAISE = 29900;
const PRO_UNLOCK_CURRENCY = 'INR';
exports.createRazorpayOrder = (0, https_1.onCall)({ secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    const instance = new razorpay_1.default({
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
});
exports.verifyRazorpayPayment = (0, https_1.onCall)({ secrets: [razorpayKeyId, razorpayKeySecret] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    const { orderId, paymentId, signature } = (request.data ?? {});
    if (!orderId || !paymentId || !signature) {
        throw new https_1.HttpsError('invalid-argument', 'Missing payment details.');
    }
    const expectedSignature = crypto
        .createHmac('sha256', razorpayKeySecret.value())
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    if (expectedSignature !== signature) {
        throw new https_1.HttpsError('permission-denied', 'Payment signature verification failed.');
    }
    // The signature alone doesn't bind the payment to this caller — without this
    // check, someone could replay another user's genuine orderId/paymentId/signature
    // triple (e.g. observed over the network) to unlock their own account for free.
    const instance = new razorpay_1.default({
        key_id: razorpayKeyId.value(),
        key_secret: razorpayKeySecret.value(),
    });
    const order = await instance.orders.fetch(orderId);
    if (order.notes?.uid !== request.auth.uid || order.notes?.product !== 'pro_unlock') {
        throw new https_1.HttpsError('permission-denied', 'This order does not belong to you.');
    }
    if (order.amount !== PRO_UNLOCK_AMOUNT_PAISE || order.currency !== PRO_UNLOCK_CURRENCY) {
        throw new https_1.HttpsError('failed-precondition', 'Unexpected order amount.');
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
            uid: request.auth.uid,
            orderId,
            amount: order.amount,
            currency: order.currency,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(db.doc(`users/${request.auth.uid}`), { proUnlocked: true, proUnlockedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    return { ok: true };
});
exports.deleteAccount = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
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
    }
    catch (err) {
        if (err.code !== 'auth/user-not-found')
            throw err;
    }
    return { ok: true };
});
// Secrets set by piping a file on Windows can carry a UTF-8 BOM or trailing
// newline, which fetch rejects as an invalid header value.
function cleanSecret(value) {
    return value.replace(/^﻿/, '').trim();
}
const GEMINI_MODEL = 'gemini-flash-latest';
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_TURNS = 10;
function buildCoachSystemPrompt(ctx) {
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
exports.askMoneyCoach = (0, https_1.onCall)({ secrets: [geminiApiKey] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    const userDoc = await admin.firestore().doc(`users/${request.auth.uid}`).get();
    if (!userDoc.data()?.proUnlocked) {
        throw new https_1.HttpsError('permission-denied', 'Money Coach is a Pro feature.');
    }
    const { message, context, history } = (request.data ?? {});
    if (!message || typeof message !== 'string' || !message.trim()) {
        throw new https_1.HttpsError('invalid-argument', 'Message is required.');
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        throw new https_1.HttpsError('invalid-argument', 'Message is too long.');
    }
    if (!context) {
        throw new https_1.HttpsError('invalid-argument', 'Financial context is required.');
    }
    const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
    const contents = [
        ...recentHistory.map((m) => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(m.text).slice(0, MAX_MESSAGE_LENGTH) }],
        })),
        { role: 'user', parts: [{ text: message.trim() }] },
    ];
    const callGemini = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
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
        throw new https_1.HttpsError('internal', 'Money Coach is unavailable right now. Please try again.');
    }
    const data = (await response.json());
    const reply = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    if (!reply) {
        throw new https_1.HttpsError('internal', 'Money Coach could not generate a reply.');
    }
    return { reply };
});
//# sourceMappingURL=index.js.map