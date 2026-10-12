import { useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { inr } from '../lib/finance';
import { useSalaryWiseContext } from '../lib/SalaryWiseContext';
import { useRescaleOnBaseChange } from '../lib/useRescaleOnBaseChange';
import AmountInput from '../components/AmountInput';
import DonutChart, { type DonutSegment } from '../components/DonutChart';
import ScreenTransition from '../components/ScreenTransition';
import PercentSliderRow from '../components/PercentSliderRow';
import StepDots from '../components/StepDots';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

const ALLOC_BLUE = '#2a78d6';
const ALLOC_ORANGE = '#eb6834';
const ALLOC_AQUA = '#1baf7a';
const ALLOC_MAGENTA = '#e87ba4';

interface LegendRowProps {
  color: string;
  label: string;
  value: string;
}

function LegendRow({ color, label, value }: LegendRowProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: colors.tan, flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>{value}</Text>
    </View>
  );
}

interface AllocatedValues {
  rent: number;
  emi: number;
  expenses: number;
  sip: number;
  left: number;
}

export default function IncomeScreen() {
  const navigation = useNavigation<any>();
  const { state, actions } = useSalaryWiseContext();
  const { salary, rent, emi, expenses, sip } = state;

  // Rent/EMI/Living/SIP are shares of salary — a new salary keeps each
  // percentage and moves the ₹ amounts with it. Shares sum to ≤100%, so the
  // pie can't exceed salary after rescaling.
  useRescaleOnBaseChange(salary, [
    { value: rent, set: actions.setRent },
    { value: emi, set: actions.setEmi },
    { value: expenses, set: actions.setExpenses },
    { value: sip, set: actions.setSip },
  ]);

  const headroom = Math.max(0, salary - (rent + emi + expenses + sip));
  const rentMax = rent + headroom;
  const emiMax = emi + headroom;
  const expensesMax = expenses + headroom;
  const sipMax = sip + headroom;

  const left = salary - (rent + emi + expenses + sip);

  const real: AllocatedValues = { rent, emi, expenses, sip, left: Math.max(0, left) };
  const [displayed, setDisplayed] = useState<AllocatedValues>(real);
  const displayedRef = useRef<AllocatedValues>(real);
  const fromRef = useRef<AllocatedValues>(real);
  const targetRef = useRef<AllocatedValues>(real);
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const next = real;
    const t = targetRef.current;
    if (next.rent === t.rent && next.emi === t.emi && next.expenses === t.expenses && next.sip === t.sip && next.left === t.left) {
      return;
    }

    fromRef.current = displayedRef.current;
    targetRef.current = next;
    progress.stopAnimation();
    progress.setValue(0);

    const id = progress.addListener(({ value: v }) => {
      const from = fromRef.current;
      const to = targetRef.current;
      const interp: AllocatedValues = {
        rent: from.rent + (to.rent - from.rent) * v,
        emi: from.emi + (to.emi - from.emi) * v,
        expenses: from.expenses + (to.expenses - from.expenses) * v,
        sip: from.sip + (to.sip - from.sip) * v,
        left: from.left + (to.left - from.left) * v,
      };
      displayedRef.current = interp;
      setDisplayed(interp);
    });

    Animated.timing(progress, { toValue: 1, duration: 260, useNativeDriver: false }).start(() => progress.removeListener(id));
    return () => progress.removeListener(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rent, emi, expenses, sip, left]);

  const segments: DonutSegment[] = [
    { label: 'Rent', value: displayed.rent, color: ALLOC_BLUE },
    { label: 'EMI', value: displayed.emi, color: ALLOC_ORANGE },
    { label: 'Living', value: displayed.expenses, color: ALLOC_AQUA },
    { label: 'SIP', value: displayed.sip, color: ALLOC_MAGENTA },
    { label: 'Left over', value: displayed.left, color: colors.tan },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ flexGrow: 1 }}>
      <ScreenTransition style={{ padding: 26, paddingTop: 14, paddingBottom: 40 }}>
        <StepDots active={1} />
        <Text style={{ fontFamily: fonts.serifSemiBold, fontSize: 28, color: colors.ink, marginTop: 18 }}>Your monthly money</Text>
        <Text style={{ fontSize: 14, color: colors.inkMuted, marginTop: 6 }}>
          Your salary is the whole pie — rent, EMIs, expenses and SIP are slices of it. Rough numbers are fine, you can edit later.
        </Text>

        <View style={{ marginTop: 22 }}>
          <AmountInput label="Take-home salary" display={inr(salary)} valueColor={colors.green} min={1000} value={salary} onChange={actions.setSalary} />
        </View>

        <View style={{ marginTop: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.borderCard, borderRadius: 20, padding: 18, alignItems: 'center' }}>
          <DonutChart segments={segments} size={160} strokeWidth={24} centerValue={inr(salary)} centerLabel="take-home" />
          <View style={{ width: '100%', marginTop: 16 }}>
            <LegendRow color={ALLOC_BLUE} label="Rent" value={inr(rent)} />
            <LegendRow color={ALLOC_ORANGE} label="EMI" value={inr(emi)} />
            <LegendRow color={ALLOC_AQUA} label="Living" value={inr(expenses)} />
            <LegendRow color={ALLOC_MAGENTA} label="SIP" value={inr(sip)} />
            <LegendRow color={colors.tan} label="Left over" value={inr(Math.max(0, left))} />
          </View>
        </View>

        <View style={{ marginTop: 20, gap: 20 }}>
          <PercentSliderRow label="Rent / home EMI" base={salary} value={rent} maxAmount={rentMax} onChange={actions.setRent} />
          <PercentSliderRow label="Other loan EMIs" base={salary} value={emi} maxAmount={emiMax} onChange={actions.setEmi} />
          <PercentSliderRow label="Living expenses" base={salary} value={expenses} maxAmount={expensesMax} onChange={actions.setExpenses} />
          <PercentSliderRow label="Monthly investing (SIP)" base={salary} value={sip} maxAmount={sipMax} onChange={actions.setSip} />
        </View>

        <Pressable
          onPress={() => navigation.navigate('Score')}
          style={{ width: '100%', marginTop: 32, backgroundColor: colors.amber, borderRadius: 16, padding: 16, alignItems: 'center' }}
        >
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '800' }}>Reveal my Financial Health Score ✦</Text>
        </Pressable>
      </ScreenTransition>
    </ScrollView>
  );
}
