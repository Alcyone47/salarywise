import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { askCoach, type CoachAskContext } from './coach';
import { addExpense as addExpenseRemote, deleteExpense as deleteExpenseRemote, subscribeExpenses, type ExpenseEntry } from './expenses';
import { computeScore } from './finance';
import { deleteAccount as deleteAccountRemote, signOutUser } from './firebaseAuth';
import { cancelScheduledRemoteSave, loadRemoteState, scheduleRemoteSave, subscribeProStatus } from './firestoreSync';
import { purchasePro as purchaseProFlow } from './payments';
import { clearState, loadState, saveState } from './storage';
import { initialState, type AppState, type CityTier } from './types';
import { clearVault, loadVaultFromDevice, lockVault, subscribeVault } from './vault';

export function useSalaryWise() {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  // Web has no @react-native-firebase auth implementation (see below), so there's
  // no async auth check to wait for there — treat auth as already resolved.
  const [authChecked, setAuthChecked] = useState(Platform.OS === 'web');
  const [emailVerified, setEmailVerified] = useState(false);
  // Whether the one-shot remote profile load for the current uid (or the lack of
  // one) has resolved — lets AppShell hold the splash screen until it knows
  // whether a signed-in user has actually finished onboarding.
  const [remoteLoaded, setRemoteLoaded] = useState(Platform.OS === 'web');
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  // uid whose data key is unlocked in memory — remote reads/writes wait on it.
  const [vaultUid, setVaultUid] = useState<string | null>(null);
  // uid whose remote profile has finished loading — saves before that point
  // would overwrite the encrypted profile with local/default state.
  const remoteReadyUidRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const monthlyExpenseTotal = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    return expenses.filter((e) => e.date.startsWith(thisMonth)).reduce((sum, e) => sum + e.amount, 0);
  }, [expenses]);
  const monthlyExpenseTotalRef = useRef(monthlyExpenseTotal);
  monthlyExpenseTotalRef.current = monthlyExpenseTotal;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeVault(setVaultUid), []);

  // Used when this device can't open the user's encrypted data: a session
  // carried over from before encryption shipped (no data key yet), or a key
  // that was replaced by a password reset on another device. Logging in with
  // the password unlocks (or migrates) the data again.
  const forceReLogin = useCallback(async () => {
    lockVault();
    try {
      await signOutUser();
    } catch {
      // best-effort — the auth listener still ends up signed out on next launch
    }
    await clearState();
    setState(initialState);
    Alert.alert('Please log in again', 'For your security, log in again to unlock your encrypted data.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadState().then((saved) => {
      if (cancelled) return;
      if (saved) setState((cur) => ({ ...cur, ...saved }));
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // @react-native-firebase has no web implementation — it initializes natively
    // from google-services.json/GoogleService-Info.plist at build time, which the
    // web bundle has no equivalent of. Skip auth/Firestore sync entirely on web.
    if (Platform.OS === 'web') return;
    let coldStart = true;
    return onAuthStateChanged(getAuth(), async (user) => {
      // A persisted session has no password to hand, so the data key must come
      // from this device. Later callbacks are Login/Signup, which unlock the
      // vault themselves once sign-in resolves.
      if (coldStart) {
        coldStart = false;
        if (user && !(await loadVaultFromDevice(user.uid))) {
          await forceReLogin();
          setUid(null);
          setEmailVerified(false);
          setAuthChecked(true);
          return;
        }
      }
      setUid(user?.uid ?? null);
      setEmailVerified(user?.emailVerified ?? false);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    remoteReadyUidRef.current = null;
    if (!uid) {
      setRemoteLoaded(true);
      return;
    }
    // Login/Signup unlock the vault only after Firebase sign-in resolves (which
    // already fired this effect) — wait for it before reading encrypted data.
    if (vaultUid !== uid) return;
    setRemoteLoaded(false);
    let cancelled = false;
    loadRemoteState(uid).then((remote) => {
      if (cancelled) return;
      if (remote) {
        setState((cur) => ({ ...cur, ...remote }));
      } else {
        // No doc yet — first-time signup. Seed it with whatever state we have so
        // far (onboarded stays false until the Score screen's "Enter SalaryWise"
        // completes, so this seed write alone must never be read as "finished
        // onboarding" — see the `onboarded` checks in Login/VerifyEmail/AppShell).
        scheduleRemoteSave(uid, stateRef.current);
      }
      remoteReadyUidRef.current = uid;
      setRemoteLoaded(true);
    }, () => {
      if (cancelled) return;
      setRemoteLoaded(true);
      forceReLogin();
    });
    return () => {
      cancelled = true;
    };
  }, [uid, vaultUid, forceReLogin]);

  useEffect(() => {
    if (!uid) return;
    return subscribeProStatus(uid, (proUnlocked) => {
      setState((cur) => (cur.proUnlocked === proUnlocked ? cur : { ...cur, proUnlocked }));
    });
  }, [uid]);

  useEffect(() => {
    if (!uid || vaultUid !== uid) {
      setExpenses([]);
      return;
    }
    return subscribeExpenses(uid, setExpenses);
  }, [uid, vaultUid]);

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveState(stateRef.current);
      if (uid && remoteReadyUidRef.current === uid) scheduleRemoteSave(uid, stateRef.current);
    }, 400);
    return () => cancelScheduledRemoteSave();
  }, [state, hydrated, uid]);

  useEffect(
    () => () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    },
    []
  );

  const startScore = useCallback(() => {
    const s = stateRef.current;
    const effectiveExpenses = monthlyExpenseTotalRef.current > 0 ? monthlyExpenseTotalRef.current : s.expenses;
    const target = computeScore(s.salary, s.rent, s.emi, effectiveExpenses, s.sip).total;
    setState((cur) => ({ ...cur, animScore: 0 }));
    if (intervalRef.current) clearInterval(intervalRef.current);
    let n = 0;
    intervalRef.current = setInterval(() => {
      n += Math.max(1, Math.round(target / 28));
      if (n >= target) {
        n = target;
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
      setState((cur) => ({ ...cur, animScore: n }));
    }, 32);
  }, []);

  const sendChat = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const s = stateRef.current;
    if (!s.proUnlocked) return;
    const history = s.chat;

    setState((cur) => ({
      ...cur,
      chat: [...cur.chat, { role: 'user', text: t }],
      chatInput: '',
      coachTyping: true,
    }));

    (async () => {
      const effectiveExpenses = monthlyExpenseTotalRef.current > 0 ? monthlyExpenseTotalRef.current : s.expenses;
      const context: CoachAskContext = {
        salary: s.salary,
        rent: s.rent,
        emi: s.emi,
        expenses: effectiveExpenses,
        sip: s.sip,
        sipAmt: s.sipAmt,
        sipR: s.sipR,
        sipY: s.sipY,
        taxIncome: s.taxIncome,
        tax80c: s.tax80c,
        taxHra: s.taxHra,
        affIncome: s.affIncome,
        affDown: s.affDown,
        affRate: s.affRate,
        affTenure: s.affTenure,
        scoreTotal: computeScore(s.salary, s.rent, s.emi, effectiveExpenses, s.sip).total,
      };
      let reply: string;
      try {
        reply = await askCoach(t, context, history);
      } catch (err) {
        reply = err instanceof Error ? err.message : "Couldn't reach your Money Coach. Please try again.";
      }
      setState((cur) => ({
        ...cur,
        chat: [...cur.chat, { role: 'coach', text: reply }],
        coachTyping: false,
      }));
    })();
  }, []);

  const set = <K extends keyof AppState>(key: K) => (value: AppState[K]) =>
    setState((cur) => ({ ...cur, [key]: value }));

  const purchasePro = useCallback(async () => {
    const s = stateRef.current;
    await purchaseProFlow(s.name, s.email);
    // The Cloud Function already wrote proUnlocked to Firestore via the Admin
    // SDK — this just reflects it locally without waiting on the next sync.
    setState((cur) => ({ ...cur, proUnlocked: true }));
  }, []);

  const addExpense = useCallback(
    (entry: Omit<ExpenseEntry, 'id'>) => {
      if (!uid) return Promise.resolve();
      return addExpenseRemote(uid, entry);
    },
    [uid]
  );

  const deleteExpense = useCallback(
    (id: string) => {
      if (!uid) return Promise.resolve();
      return deleteExpenseRemote(uid, id);
    },
    [uid]
  );

  const signOut = useCallback(async () => {
    await signOutUser();
    // Keeps the device copy of the data key so a later password reset can
    // still be recovered on this device — see unlockVault.
    lockVault();
    await clearState();
    setState(initialState);
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountRemote();
    if (uid) await clearVault(uid);
    await clearState();
    setState(initialState);
  }, [uid]);

  const actions = {
    startScore,
    setName: set('name'),
    setEmail: set('email'),
    setPassword: set('password'),
    setAge: set('age'),
    setCityTier: (v: CityTier) => set('cityTier')(v),
    depMinus: () => setState((cur) => ({ ...cur, dependents: Math.max(0, cur.dependents - 1) })),
    depPlus: () => setState((cur) => ({ ...cur, dependents: Math.min(9, cur.dependents + 1) })),
    setSalary: set('salary'),
    setRent: set('rent'),
    setEmi: set('emi'),
    setExpenses: set('expenses'),
    setSip: set('sip'),
    setEmiP: set('emiP'),
    setEmiR: set('emiR'),
    setEmiN: set('emiN'),
    setSipAmt: set('sipAmt'),
    setSipR: set('sipR'),
    setSipY: set('sipY'),
    setAffIncome: set('affIncome'),
    setAffDown: set('affDown'),
    setAffRate: set('affRate'),
    setAffTenure: set('affTenure'),
    setTaxIncome: set('taxIncome'),
    setTax80c: set('tax80c'),
    setTaxHra: set('taxHra'),
    setChatInput: set('chatInput'),
    setOnboarded: set('onboarded'),
    sendChat,
    purchasePro,
    addExpense,
    deleteExpense,
    signOut,
    deleteAccount,
  };

  return { state, actions, hydrated, expenses, monthlyExpenseTotal, uid, authChecked, emailVerified, remoteLoaded };
}

export type SalaryWiseActions = ReturnType<typeof useSalaryWise>['actions'];
