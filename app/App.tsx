import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SettingsScreen from './src/screens/SettingsScreen';
import IntentionScreen from './src/screens/IntentionScreen';
import { RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName='Settings'>
          <Stack.Screen
            name='Settings'
            component={SettingsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name='Intention'
            component={IntentionScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              gestureEnabled: false, // Prevent swiping away in blocker mode
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
