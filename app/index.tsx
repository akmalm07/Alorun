import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello, world!</Text>
      <Text style={styles.subtitle}>Welcome to Alorun.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f8fc',
  },
  title: { fontSize: 32, fontWeight: '700', color: '#252a40' },
  subtitle: { marginTop: 12, fontSize: 18, color: '#5c637b' },
});
