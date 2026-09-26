# SalaryWise

A personal-finance companion for salaried professionals in India. SalaryWise turns your monthly salary, rent, EMIs, expenses and SIPs into a financial health score, and gives you calculators and an AI Money Coach to plan the rest.

Built with Expo (SDK 57) and React Native, backed by Firebase (Auth, Firestore, Cloud Functions) with Razorpay for the one-time Pro unlock.

## Features

- **Onboarding & financial health score** — enter your profile (age, city tier, dependents) and monthly income/outgoings to get a score out of 100, broken down into savings (40), debt burden (30) and investing (30), with tips on where to gain points.
- **Dashboard** — overview of your money at a glance, including a salary allocation donut chart.
- **Budget & Allocate** — see and plan how your salary is split across rent, EMIs, expenses, investments and savings.
- **Expense tracker** — log itemized expenses (Food, Transport, Shopping, Bills, Other), synced to your account.
- **Calculators**
  - EMI calculator (principal, rate, tenure)
  - SIP calculator (monthly amount, expected return, years)
  - Home affordability ("How much house can I afford?")
- **Pro features** (one-time ₹299 unlock)
  - **Tax planner** — compare the old vs new income-tax regime with 80C and HRA deductions.
  - **Money Coach** — an AI chat assistant (Google Gemini) that answers budgeting, tax, loan and investing questions using your own numbers as context.
- **Account** — email/password sign-up with email verification, password reset, sign-out and full account deletion.

Amounts are formatted in Indian notation (₹1,23,456 · ₹12 L · ₹1.5 Cr).

## Tech stack

| Layer | Tools |
| --- | --- |
| App | Expo SDK 57, React Native 0.86, React 19, TypeScript |
| Navigation | React Navigation 7 (native stack + bottom tabs) |
| UI | react-native-svg (charts), @react-native-community/slider, Fraunces & Instrument Sans fonts |
| Auth & data | @react-native-firebase (Auth, Firestore, Functions), AsyncStorage for local persistence |
| Backend | Firebase Cloud Functions v2 (Node 20, region `asia-south1`) |
| Payments | Razorpay (`react-native-razorpay` + server-side order creation and signature verification) |
| AI | Google Gemini API, called only from Cloud Functions |

## Project structure

```
.
├── App.tsx, index.ts          # App entry
├── app.json, app.config.js    # Expo config (config.js injects Firebase files from env on EAS)
├── eas.json                   # EAS Build profiles
├── src/
│   ├── AppShell.tsx           # Fonts, splash, providers
│   ├── components/            # Reusable UI (DonutChart, SliderRow, AmountInput, ...)
│   ├── lib/
│   │   ├── finance.ts         # Score, EMI, SIP, affordability and tax calculations
│   │   ├── useSalaryWise.ts   # App state + actions
│   │   ├── SalaryWiseContext.tsx
│   │   ├── storage.ts         # Local persistence (AsyncStorage)
│   │   ├── firestoreSync.ts   # Remote state sync + Pro status subscription
│   │   ├── firebaseAuth.ts    # Sign up / in / out, verification, deletion
│   │   ├── expenses.ts        # Expense log in Firestore
│   │   ├── payments.ts        # Razorpay checkout flow
│   │   └── coach.ts           # Money Coach client
│   ├── navigation/            # Root, onboarding stack, main tabs
│   ├── screens/               # One file per screen
│   └── theme/                 # Colors and fonts
├── functions/                 # Firebase Cloud Functions (TypeScript)
│   └── src/index.ts           # Razorpay orders/verification, Money Coach, account deletion
├── firestore.rules            # Security rules
├── firebase.json              # Firestore, Hosting and Functions config
└── public/                    # Hosted privacy policy and account-deletion pages
```

## Getting started

### Prerequisites

- Node.js 20+
- A Firebase project with **Email/Password Auth**, **Firestore** and **Cloud Functions** (Blaze plan) enabled
- Android Studio and/or Xcode for native builds
- [EAS CLI](https://docs.expo.dev/build/setup/) for cloud builds (optional)

> The app uses React Native Firebase and Razorpay, which are native modules — it **does not run in Expo Go**. Use a development build.

### 1. Install dependencies

```bash
npm install
npm --prefix functions install
```

### 2. Add Firebase config files

Download these from your Firebase project settings and place them in the project root (they are git-ignored):

- `google-services.json` (Android, package `com.erudata.salarywise`)
- `GoogleService-Info.plist` (iOS, bundle ID `com.salarywise.app`)

For EAS builds, upload them as file secrets named `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST`; `app.config.js` picks them up automatically.

### 3. Run the app

```bash
npm run android   # build and run a dev client on Android
npm run ios       # build and run a dev client on iOS
npm start         # start Metro for an installed dev client
```

Type-check with:

```bash
npm run typecheck
```

## Backend setup

### Secrets

The Cloud Functions read these secrets from Google Secret Manager:

```bash
npx firebase functions:secrets:set RAZORPAY_KEY_ID
npx firebase functions:secrets:set RAZORPAY_KEY_SECRET
npx firebase functions:secrets:set GEMINI_API_KEY
```

### Deploy

```bash
npx firebase deploy --only functions          # Cloud Functions
npx firebase deploy --only firestore          # Rules and indexes
npx firebase deploy --only hosting            # Privacy policy / delete-account pages
```

### Cloud Functions

| Function | Purpose |
| --- | --- |
| `createRazorpayOrder` | Creates a ₹299 Pro-unlock order for the signed-in user |
| `verifyRazorpayPayment` | Verifies the payment signature, checks the order belongs to the caller, and sets `proUnlocked` |
| `askMoneyCoach` | Pro-only; sends the user's question and financial context to Gemini |
| `deleteAccount` | Deletes the user's Firestore data and Auth account |

The client must call functions in the same region they are deployed to (`asia-south1`, set in `functions/src/index.ts` and mirrored in `src/lib/payments.ts` / `src/lib/coach.ts`).

### Security model

- Users can only read and write their own `users/{uid}` document and `expenses` subcollection.
- `proUnlocked` / `proUnlockedAt` can **only** be set by the `verifyRazorpayPayment` function — Firestore rules block clients from granting themselves Pro.
- `payments/{paymentId}` records are server-only and are retained for accounting even after account deletion.
- Passwords are never persisted locally or to Firestore.

## Building for release

EAS Build profiles are defined in `eas.json`:

```bash
eas build --profile development --platform android   # dev client
eas build --profile preview --platform android       # internal testing
eas build --profile production --platform android    # Play Store (AAB)
eas build --profile apk --platform android           # standalone APK
```

Production builds auto-increment the version code and use local Android signing credentials (`credentials.json`, git-ignored).

## Disclaimer

SalaryWise provides estimates for educational purposes only and is not financial, tax or investment advice. Tax calculations are simplified and may not reflect every rule.

## License

See [LICENSE](LICENSE).
