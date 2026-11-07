import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** Call only in response to an explicit user action, never at app startup. */
export async function enableNotifications(projectId: string): Promise<
  | { status: 'registered'; token: string }
  | { status: 'denied' | 'unavailable' | 'misconfigured' }
> {
  if (Platform.OS === 'web') return { status: 'unavailable' };
  if (!projectId.trim()) return { status: 'misconfigured' };

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { status: 'denied' };
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: 'registered', token: token.data };
  } catch {
    // No push token is available on unsupported devices or without an EAS setup.
    return { status: 'unavailable' };
  }
}
