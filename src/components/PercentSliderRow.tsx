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
  // Where the track ends. Keep it stable — if it moves while another row is
  // dragged, this row's thumb jumps even though its value didn't change.
  maxAmount: number;
  // How far the thumb may actually go (e.g. what the other rows leave free).
  limit?: number;
  onChange: (v: number) => void;
  format?: (n: number) => string;
}

export default function PercentSliderRow({ label, base, value, maxAmount, limit, onChange, format = inr }: PercentSliderRowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // Value the slider held when the drag started. While set, it's what the
  // slider gets as `value`, so React doesn't push a re-rounded value back to
  // the native thumb under the user's finger (which made it jitter).
  const [dragStart, setDragStart] = useState<number | null>(null);

  const cap = Math.min(maxAmount, limit ?? Infinity);
  const pct = base > 0 ? (value / base) * 100 : 0;
  const trackMaxPct = Math.max(1, Math.ceil(base > 0 ? (maxAmount / base) * 100 : 0));
  // Never below the current value, or the slider would snap it down on render.
  // Without a `limit` the track end is the cap (setPct clamps the last step).
  const upperLimitPct = limit === undefined ? undefined : Math.max(Math.round(pct), Math.floor(base > 0 ? (cap / base) * 100 : 0));

  const setPct = (p: number) => {
    const whole = Math.max(0, Math.round(p));
    onChange(Math.min(cap, Math.round((base * whole) / 100)));
  };

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) setPct(parsed);
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
        maximumValue={trackMaxPct}
        upperLimit={upperLimitPct}
        step={1}
        value={dragStart ?? Math.round(pct)}
        onSlidingStart={setDragStart}
        onValueChange={setPct}
        onSlidingComplete={(p) => {
          setPct(p);
          setDragStart(null);
        }}
        disabled={base <= 0}
        minimumTrackTintColor={colors.green}
        maximumTrackTintColor="#e5dcc7"
        thumbTintColor={colors.green}
        style={{ width: '100%', marginTop: 11, height: 22 }}
      />
    </View>
  );
}
