import { useNavigation } from '@react-navigation/native';
import { ScrollView, Text, View } from 'react-native';
import { affCalc, inr, short } from '../lib/finance';
import { useSalaryWiseContext } from '../lib/SalaryWiseContext';
import AmountInput from '../components/AmountInput';
import BackHeader from '../components/BackHeader';
import ScreenTransition from '../components/ScreenTransition';
import SliderRow from '../components/SliderRow';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

export default function AffordScreen() {
  const navigation = useNavigation<any>();
  const { state, actions } = useSalaryWiseContext();
  const { affIncome, affDown, affRate, affTenure } = state;
  const a = affCalc(affIncome, affDown, affRate, affTenure);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ flexGrow: 1 }}>
      <ScreenTransition style={{ padding: 24, paddingTop: 8, paddingBottom: 40 }}>
        <BackHeader title="Home Affordability" onBack={() => navigation.goBack()} />

        <View style={{ backgroundColor: colors.green, borderRadius: 24, padding: 22, marginTop: 18, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: colors.greenFaint, fontWeight: '600', letterSpacing: 1 }}>YOU CAN LOOK AT HOMES UP TO</Text>
          <Text style={{ fontFamily: fonts.serifSemiBold, fontSize: 44, color: colors.cream, marginTop: 4 }}>{short(a.price)}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.14)' }}>
            <View>
              <Text style={{ fontSize: 11, color: colors.greenFaint }}>Max loan</Text>
              <Text style={{ fontWeight: '700', marginTop: 2, color: colors.cream }}>{short(a.loan)}</Text>
            </View>
            <View>
              <Text style={{ fontSize: 11, color: colors.greenFaint }}>Comfortable EMI</Text>
              <Text style={{ fontWeight: '700', marginTop: 2, color: colors.amber }}>{inr(a.emi)}</Text>
            </View>
          </View>
        </View>

        <View style={{ gap: 22, marginTop: 24 }}>
          <AmountInput label="Monthly income" display={inr(affIncome)} valueColor={colors.green} value={affIncome} onChange={actions.setAffIncome} />
          <SliderRow label="Down payment saved" display={short(affDown)} min={0} max={10000000} step={100000} value={affDown} onChange={actions.setAffDown} />
          <SliderRow label="Interest rate" display={`${affRate}%`} min={6} max={14} step={0.1} value={affRate} onChange={actions.setAffRate} />
          <SliderRow label="Tenure" display={`${affTenure} years`} min={5} max={30} step={1} value={affTenure} onChange={actions.setAffTenure} />
        </View>

        <Text style={{ fontSize: 11.5, color: colors.tanLight, marginTop: 16, lineHeight: 17 }}>Assumes EMIs stay under 40% of income. Indicative only — not financial advice.</Text>
      </ScreenTransition>
    </ScrollView>
  );
}
