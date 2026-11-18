import {
  Pressable,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
export const colors = {
  background: "#202422",
  ink: "#f4f6f4",
  muted: "#b1b9b3",
  accent: "#8cdbad",
  border: "#3b433e",
  soft: "#2a302c",
  error: "#ffaaaa",
  sidebar: "#191e1b",
  secondary: "#303733",
  accentSoft: "#2d4538",
  onAccent: "#10261a",
};
export function Brand() {
  return (
    <Image
      // Metro bundles local assets through static require.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require("../../assets/alorun_full_logo.png")}
      accessibilityLabel="Alorun"
      resizeMode="contain"
      style={{
        width: 104,
        height: 70,
        alignSelf: "flex-start",
        borderRadius: 12,
      }}
    />
  );
}
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: colors.ink }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {error instanceof Error
        ? error.message
        : "Something went wrong. Please retry."}
    </Text>
  ) : null;
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: 24,
    gap: 18,
    paddingBottom: 64,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  title: { fontSize: 32, fontWeight: "700", color: colors.ink },
  heading: { fontSize: 23, fontWeight: "600", color: colors.ink },
  body: { fontSize: 16, lineHeight: 24, color: colors.ink },
  muted: { fontSize: 15, lineHeight: 22, color: colors.muted },
  section: {
    gap: 14,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  button: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  secondary: { backgroundColor: colors.secondary },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.onAccent,
    textAlign: "center",
  },
  field: { gap: 7, flexGrow: 1 },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.soft,
  },
  error: { color: colors.error, fontSize: 15, lineHeight: 22 },
  inset: {
    gap: 14,
    backgroundColor: colors.soft,
    padding: 18,
    borderRadius: 14,
  },
});
