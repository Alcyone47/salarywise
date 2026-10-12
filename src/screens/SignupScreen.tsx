import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSalaryWiseContext } from '../lib/SalaryWiseContext';
import { getAuth } from '@react-native-firebase/auth';
import { signOutUser, signUpWithEmail } from '../lib/firebaseAuth';
import { unlockVault } from '../lib/vault';
import ScreenTransition from '../components/ScreenTransition';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

const fieldLabelStyle = { fontSize: 12, fontWeight: '600' as const, color: colors.fieldLabel, marginBottom: 6 };
const inputStyle = {
  width: '100%' as const,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 14,
  padding: 14,
  fontSize: 15,
  color: colors.ink,
  backgroundColor: colors.card,
};

export default function SignupScreen() {
  const navigation = useNavigation<any>();
  const { state, actions } = useSalaryWiseContext();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateAccount = async () => {
    if (!/^\S+@\S+\.\S+$/.test(state.email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (state.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      await signUpWithEmail(state.email, state.password);
      const uid = getAuth().currentUser?.uid;
      if (uid) {
        try {
          // Creates the account's data key and seals it with this password.
          await unlockVault(uid, state.password);
        } catch {
          await signOutUser().catch(() => {});
          throw new Error("Your account was created, but setup didn't finish. Please log in to continue.");
        }
      }
      navigation.navigate('Disclaimer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ flexGrow: 1 }}>
      <ScreenTransition style={{ padding: 26, paddingTop: 14, paddingBottom: 40 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            backgroundColor: colors.green,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image source={require('../../assets/android-icon-foreground.png')} style={{ width: 34, height: 34 }} resizeMode="contain" />
        </View>
        <Text style={{ fontFamily: fonts.serifSemiBold, fontSize: 32, color: colors.ink, marginTop: 22, lineHeight: 35, letterSpacing: -0.3 }}>
          Money, made{'\n'}manageable.
        </Text>
        <Text style={{ fontSize: 14, color: colors.inkMuted, marginTop: 10, lineHeight: 21 }}>
          Budgeting, tax, loans and investing for salaried India — in one calm place.
        </Text>
        <View style={{ gap: 12, marginTop: 30 }}>
          <View>
            <Text style={fieldLabelStyle}>Full name</Text>
            <TextInput style={inputStyle} value={state.name} onChangeText={actions.setName} placeholder="Rahul Sharma" />
          </View>
          <View>
            <Text style={fieldLabelStyle}>Email</Text>
            <TextInput style={inputStyle} value={state.email} onChangeText={actions.setEmail} placeholder="rahul@email.com" autoCapitalize="none" keyboardType="email-address" />
          </View>
          <View>
            <Text style={fieldLabelStyle}>Password</Text>
            <TextInput style={inputStyle} value={state.password} onChangeText={actions.setPassword} placeholder="At least 6 characters" secureTextEntry autoCapitalize="none" />
          </View>
        </View>
        {error && (
          <View style={{ backgroundColor: colors.amberPale, borderWidth: 1, borderColor: colors.amberBorder, borderRadius: 12, padding: 12, marginTop: 16 }}>
            <Text style={{ fontSize: 12, color: colors.amberText, lineHeight: 17 }}>{error}</Text>
          </View>
        )}
        <Pressable
          onPress={handleCreateAccount}
          disabled={sending}
          style={{ width: '100%', marginTop: 26, backgroundColor: colors.green, borderRadius: 16, padding: 16, alignItems: 'center', opacity: sending ? 0.7 : 1 }}
        >
          {sending ? <ActivityIndicator color={colors.cream} /> : <Text style={{ color: colors.cream, fontSize: 15, fontWeight: '700' }}>Create account</Text>}
        </Pressable>
        <Text style={{ textAlign: 'center', fontSize: 12.5, color: colors.tanLight, marginTop: 16 }}>
          Already have an account?{' '}
          <Text style={{ color: colors.greenLight, fontWeight: '700' }} onPress={() => navigation.navigate('Login')}>
            Log in
          </Text>
        </Text>
      </ScreenTransition>
    </ScrollView>
  );
}
