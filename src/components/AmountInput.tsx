import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface AmountInputProps {
  label: string;
  display: string;
  valueColor?: string;
  min?: number;
  value: number;
  onChange: (v: number) => void;
}

// Boxed like the signup form fields, but larger — it's the headline number the
// rest of the screen is a share of.
export default function AmountInput({ label, display, valueColor = colors.ink, min = 0, value, onChange }: AmountInputProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) {
      onChange(Math.max(min, parsed));
    }
  };

  return (
    <View>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.fieldLabel, marginBottom: 6 }}>{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: editing ? colors.green : colors.border,
          borderRadius: 14,
          backgroundColor: colors.card,
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 6,
        }}
      >
        <Text style={{ fontFamily: fonts.serifSemiBold, fontSize: 26, color: colors.inkMuted }}>₹</Text>
        <TextInput
          // The ₹ prefix is drawn above, so drop the one the formatters add.
          value={editing ? text : display.replace(/^₹\s*/, '')}
          onFocus={() => {
            setText(String(value));
            setEditing(true);
          }}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="decimal-pad"
          selectTextOnFocus
          style={{ flex: 1, fontFamily: fonts.serifSemiBold, fontSize: 26, color: valueColor, padding: 0 }}
        />
      </View>
    </View>
  );
}
