import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { appStorage } from '../lib/storage';
import { RawIntention, makeRawIntention, isEmpty } from '../lib/intention';
import { VpnService } from '../services/VpnService';

type SettingsScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Settings'
>;

export default function SettingsScreen() {
  const navigation = useNavigation<SettingsScreenNavigationProp>();
  const [intentions, setIntentions] = useState<RawIntention[]>([]);
  const [fuzzyMatching, setFuzzyMatching] = useState(true);

  // New intention inputs
  const [newUrl, setNewUrl] = useState('');
  const [newPhrase, setNewPhrase] = useState('');

  const loadSettings = useCallback(() => {
    const data = appStorage.get();
    setIntentions(data.intentions);
    setFuzzyMatching(data.fuzzyMatching);
  }, []);

  useEffect(() => {
    loadSettings();

    // Add listener for focus to reload settings when coming back
    const unsubscribe = navigation.addListener('focus', loadSettings);
    return unsubscribe;
  }, [navigation, loadSettings]);

  const saveSettings = (
    newIntentions = intentions,
    newFuzzy = fuzzyMatching
  ) => {
    appStorage.set({
      intentions: newIntentions,
      fuzzyMatching: newFuzzy,
    });
    setIntentions(newIntentions);
    setFuzzyMatching(newFuzzy);
  };

  const handleAddIntention = () => {
    if (!newUrl.trim() || !newPhrase.trim()) {
      Alert.alert(
        'Error',
        'Please enter both a URL/App name and an intention phrase.'
      );
      return;
    }

    const newIntention = makeRawIntention(newUrl, newPhrase);
    const updatedIntentions = [...intentions, newIntention];
    saveSettings(updatedIntentions);

    setNewUrl('');
    setNewPhrase('');
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete Intention', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const updated = intentions.filter(i => i.id !== id);
          saveSettings(updated);
        },
      },
    ]);
  };

  const handleTest = (intention: RawIntention) => {
    navigation.navigate('Intention', {
      intentionId: intention.id as string, // Cast UUID to string for nav params
      targetName: intention.url,
    });
  };

  const handleStartVpn = async () => {
    try {
      const result = await VpnService.startVpn();
      Alert.alert('VPN Started', result);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  const handleStopVpn = async () => {
    try {
      const result = await VpnService.stopVpn();
      Alert.alert('VPN Stopped', result);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  const renderItem = ({ item }: { item: RawIntention }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.url}</Text>
        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={() => handleTest(item)}
            style={styles.testBtn}
          >
            <Text style={styles.testBtnText}>Test</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(item.id as string)}
            style={styles.deleteBtn}
          >
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.cardPhrase}>"{item.phrase}"</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Intender</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity style={styles.vpnBtn} onPress={handleStartVpn}>
              <Text style={styles.vpnBtnText}>Start VPN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.vpnBtn, styles.vpnBtnStop]}
              onPress={handleStopVpn}
            >
              <Text style={styles.vpnBtnText}>Stop</Text>
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          data={intentions}
          keyExtractor={item => item.id as string}
          renderItem={renderItem}
          ListHeaderComponent={
            <View style={styles.addSection}>
              <Text style={styles.sectionTitle}>Add New Intention</Text>
              <TextInput
                style={styles.input}
                placeholder='App Name or URL (e.g. Instagram)'
                value={newUrl}
                onChangeText={setNewUrl}
              />
              <TextInput
                style={styles.input}
                placeholder='Intention (e.g. I want to post a photo)'
                value={newPhrase}
                onChangeText={setNewPhrase}
              />
              <TouchableOpacity
                style={styles.addBtn}
                onPress={handleAddIntention}
              >
                <Text style={styles.addBtnText}>Add Intention</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchLabel: {
    marginRight: 8,
    color: '#4B5563',
  },
  listContent: {
    paddingBottom: 40,
  },
  addSection: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  addBtn: {
    backgroundColor: '#10B981',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  testBtn: {
    marginRight: 12,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  testBtnText: {
    color: '#4F46E5',
    fontWeight: '500',
    fontSize: 14,
  },
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: {
    color: '#EF4444',
    fontSize: 18,
    fontWeight: 'bold',
  },
  cardPhrase: {
    fontSize: 16,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  headerButtons: {
    flexDirection: 'row',
  },
  vpnBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  vpnBtnStop: {
    backgroundColor: '#EF4444',
  },
  vpnBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 12,
  },
});
