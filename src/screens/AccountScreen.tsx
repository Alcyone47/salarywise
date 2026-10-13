import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { inr } from '../lib/finance';
import { DELETE_ACCOUNT_URL, PRIVACY_POLICY_URL } from '../lib/links';
import { useSalaryWiseContext } from '../lib/SalaryWiseContext';
import BackHeader from '../components/BackHeader';
import ScreenTransition from '../components/ScreenTransition';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface StaticRowProps {
  label: string;
  value: string;
}

function StaticRow({ label, value }: StaticRowProps) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.label }}>{label}</Text>
      <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15 }}>{value}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const navigation = useNavigation<any>();
  const { state, actions } = useSalaryWiseContext();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await actions.signOut();
      navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    } finally {
      setSigningOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await actions.deleteAccount();
      navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
    } catch (err) {
      setDeleteError((err as { message?: string })?.message || "Couldn't delete your account. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ flexGrow: 1 }}>
      <ScreenTransition style={{ padding: 24, paddingTop: 8, paddingBottom: 40 }}>
        <BackHeader title="Account" onBack={() => navigation.goBack()} />

        <View style={{ marginTop: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 18 }}>
          <Text style={{ fontFamily: fonts.serifSemiBold, fontSize: 18, color: colors.ink }}>{state.name || 'Your account'}</Text>
          <Text style={{ fontSize: 13, color: colors.inkMuted, marginTop: 3 }}>{state.email}</Text>
        </View>

        <Text style={{ marginTop: 26, marginBottom: 4, fontSize: 12, fontWeight: '700', color: colors.inkMuted, letterSpacing: 0.5 }}>
          YOUR NUMBERS
        </Text>
        <View style={{ marginTop: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 18 }}>
          <StaticRow label="Take-home salary" value={inr(state.salary)} />
          <StaticRow label="Rent / home EMI" value={inr(state.rent)} />
          <StaticRow label="Other loan EMIs" value={inr(state.emi)} />
          <StaticRow label="Living expenses" value={inr(state.expenses)} />
          <StaticRow label="Monthly investing (SIP)" value={inr(state.sip)} />
        </View>

        <Pressable
          onPress={() => navigation.navigate('Allocate')}
          style={{ width: '100%', marginTop: 16, backgroundColor: colors.green, borderRadius: 16, padding: 16, alignItems: 'center' }}
        >
          <Text style={{ color: colors.cream, fontSize: 15, fontWeight: '700' }}>Edit numbers →</Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          style={{ width: '100%', marginTop: 34, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, alignItems: 'center', opacity: signingOut ? 0.7 : 1 }}
        >
          {signingOut ? <ActivityIndicator color={colors.redOrange} /> : <Text style={{ color: colors.redOrange, fontSize: 15, fontWeight: '700' }}>Sign out</Text>}
        </Pressable>

        {!confirmingDelete ? (
          <Pressable
            onPress={() => setConfirmingDelete(true)}
            style={{ width: '100%', marginTop: 14, padding: 12, alignItems: 'center' }}
          >
            <Text style={{ color: colors.inkMuted, fontSize: 13, fontWeight: '600' }}>Delete account</Text>
          </Pressable>
        ) : (
          <View style={{ marginTop: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.redOrange, borderRadius: 16, padding: 18 }}>
            <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>
              This permanently deletes your account and all your data — salary numbers, expenses, and Pro status. This can't be undone.
            </Text>
            {deleteError ? (
              <Text style={{ color: colors.redOrange, fontSize: 13, marginTop: 10 }}>{deleteError}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={{ flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, alignItems: 'center' }}
              >
                <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleDeleteAccount}
                disabled={deleting}
                style={{ flex: 1, backgroundColor: colors.redOrange, borderRadius: 14, padding: 14, alignItems: 'center', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? <ActivityIndicator color={colors.cream} /> : <Text style={{ color: colors.cream, fontSize: 14, fontWeight: '700' }}>Delete permanently</Text>}
              </Pressable>
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 6 }}>
          <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} style={{ padding: 8 }}>
            <Text style={{ color: colors.inkMuted, fontSize: 13, fontWeight: '600' }}>Privacy policy</Text>
          </Pressable>
          <Text style={{ color: colors.inkMuted, fontSize: 13 }}>·</Text>
          <Pressable onPress={() => Linking.openURL(DELETE_ACCOUNT_URL)} style={{ padding: 8 }}>
            <Text style={{ color: colors.inkMuted, fontSize: 13, fontWeight: '600' }}>Data deletion</Text>
          </Pressable>
        </View>
      </ScreenTransition>
    </ScrollView>
  );
}
