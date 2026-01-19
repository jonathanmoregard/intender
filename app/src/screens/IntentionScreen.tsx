import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { appStorage } from '../lib/storage';
import { fuzzyMatch, fuzzyPartialMatch } from '../lib/fuzzy-matching';

type IntentionScreenRouteProp = RouteProp<RootStackParamList, 'Intention'>;

export default function IntentionScreen() {
  const navigation = useNavigation();
  const route = useRoute<IntentionScreenRouteProp>();
  const { intentionId, targetName } = route.params;

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'grey' | 'green' | 'red'>('grey');

  const { intentions, fuzzyMatching } = appStorage.get();
  const intention = intentions.find(i => i.id === intentionId);
  const expectedPhrase = intention?.phrase || '';

  // Animations
  const borderOpacity = useSharedValue(0);
  const borderColor = useSharedValue('#E5E7EB');

  const containerStyle = useAnimatedStyle(() => {
    return {
      borderColor: borderColor.value,
      borderWidth: 1,
    };
  });

  useEffect(() => {
    if (!input) {
      setStatus('grey');
      borderColor.value = withTiming('#E5E7EB'); // gray-200
      return;
    }

    const maxDistance = 2;
    const isPartial = fuzzyMatching
      ? fuzzyPartialMatch(input, expectedPhrase, maxDistance)
      : expectedPhrase.startsWith(input);

    const isComplete = fuzzyMatching
      ? fuzzyMatch(input, expectedPhrase, maxDistance)
      : input === expectedPhrase;

    if (isComplete) {
      setStatus('green');
      borderColor.value = withTiming('#10B981'); // green-500
    } else if (isPartial) {
      setStatus('green'); // Still green while partial matching
      borderColor.value = withTiming('#10B981');
    } else {
      setStatus('red');
      borderColor.value = withTiming('#EF4444'); // red-500
    }
  }, [input, expectedPhrase, fuzzyMatching]);

  const handleContinue = () => {
    // In a real blocking scenario, this would unblock the app/URL.
    // For Phase 1 (Foundation), we just go back.
    navigation.goBack();
  };

  const isCompleteMatch = useMemo(() => {
    const maxDistance = 2;
    return fuzzyMatching
      ? fuzzyMatch(input, expectedPhrase, maxDistance)
      : input === expectedPhrase;
  }, [input, expectedPhrase, fuzzyMatching]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          <Text style={styles.headline}>
            Before entering <Text style={styles.targetName}>{targetName}</Text>,
          </Text>
          <Text style={styles.subheadline}>type your intention:</Text>

          <View style={styles.phraseDisplay}>
            <Text style={styles.phraseText}>{expectedPhrase}</Text>
          </View>

          <Animated.View style={[styles.inputContainer, containerStyle]}>
            <TextInput
              style={[
                styles.input,
                status === 'red' && styles.inputRed,
                status === 'green' && styles.inputGreen,
              ]}
              value={input}
              onChangeText={setInput}
              placeholder='Write your intention'
              placeholderTextColor='#9CA3AF'
              multiline
              autoFocus
              autoCapitalize='sentences'
            />
          </Animated.View>

          {status === 'red' && (
            <Text style={styles.helperText}>
              That doesn't match your intention. Try again.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.button, !isCompleteMatch && styles.buttonDisabled]}
            disabled={!isCompleteMatch}
            onPress={handleContinue}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F6F2', // cream
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  headline: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1F2937', // gray-800
    textAlign: 'center',
    marginBottom: 8,
  },
  targetName: {
    fontWeight: '700',
  },
  subheadline: {
    fontSize: 18,
    color: '#6B7280', // gray-500
    marginBottom: 32,
    textAlign: 'center',
  },
  phraseDisplay: {
    backgroundColor: '#FAF5EA', // secondary-lighter
    padding: 24,
    borderRadius: 12,
    width: '100%',
    borderLeftWidth: 4,
    borderLeftColor: '#E2D5B4', // secondary-light
    marginBottom: 24,
  },
  phraseText: {
    fontSize: 18,
    fontStyle: 'italic',
    color: '#4B5563', // gray-600
    textAlign: 'center',
    lineHeight: 28,
  },
  inputContainer: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  input: {
    padding: 16,
    fontSize: 16,
    color: '#1F2937',
    minHeight: 60,
  },
  inputRed: {
    backgroundColor: '#FEF2F2', // red-50
    color: '#DC2626', // red-600
  },
  inputGreen: {
    backgroundColor: '#ECFDF5', // green-50
    color: '#059669', // green-600
  },
  helperText: {
    fontSize: 14,
    color: '#EF4444', // red-500
    marginBottom: 16,
    marginTop: 8,
  },
  button: {
    backgroundColor: '#10B981', // primary
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonDisabled: {
    backgroundColor: '#D1D5DB', // gray-300
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
});
