import { useState } from 'react';
import Slider from '@react-native-community/slider';
import { Text, TextInput, View } from 'react-native';
import { inr } from '../lib/finance';
import { colors } from '../theme/colors';

interface PercentSliderRowProps {
  label: string;
  // The amount this row is a share of (salary, annual income…).
  base: number;
  // Stored in ₹ — the slider and typed value are percentages of `base`.
  value: number;
  maxAmount: number;
  onChange: (v: number) => void;
  format?: (n: number) => string;
}

export default function PercentSliderRow({ label, base, value, maxAmount, onChange, format = inr }: PercentSliderRowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const pct = base > 0 ? (value / base) * 100 : 0;
  const maxPct = base > 0 ? (maxAmount / base) * 100 : 0;

  // The slider runs continuously (its max is rarely a whole percent) and is
  // snapped to whole percents here, capped so rounding up can't pass maxAmount.
  const setPct = (p: number) => {
    const whole = Math.max(0, Math.round(p));
    onChange(Math.min(maxAmount, Math.round((base * whole) / 100)));
  };

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) setPct(Math.min(maxPct, parsed));
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.label }}>{label}</Text>
        <TextInput
          value={editing ? text : `${Math.round(pct)}% · ${format(value)}`}
          onFocus={() => {
            setText(String(Math.round(pct)));
            setEditing(true);
          }}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="decimal-pad"
          selectTextOnFocus
          editable={base > 0}
          style={{ fontWeight: '700', color: colors.ink, fontSize: 15, textAlign: 'right', minWidth: 120, padding: 0 }}
        />
      </View>
      <Slider
        minimumValue={0}
        maximumValue={Math.max(maxPct, 1)}
        step={0}
        value={pct}
        onValueChange={setPct}
        disabled={base <= 0}
        minimumTrackTintColor={colors.green}
        maximumTrackTintColor="#e5dcc7"
        thumbTintColor={colors.green}
        style={{ width: '100%', marginTop: 11, height: 22 }}
      />
    </View>
  );
}
