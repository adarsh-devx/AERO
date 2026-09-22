import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
}

/**
 * Search text input with clear button and submit action.
 * Pure presentational — no state or provider logic.
 */
export function SearchInput({ value, onChangeText, onSubmit }: SearchInputProps) {
  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search songs, artists…"
        placeholderTextColor="#6b7280"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search query input"
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search text"
          hitSlop={8}
        >
          <Text style={styles.clear}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
  },
  clear: {
    fontSize: 16,
    color: '#9ca3af',
    paddingHorizontal: 6,
  },
});
