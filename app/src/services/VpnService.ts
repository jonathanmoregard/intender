import { NativeModules } from 'react-native';

const { IntenderModule } = NativeModules;

interface IntenderModuleType {
  startVpn(): Promise<string>;
  stopVpn(): Promise<string>;
}

export const VpnService = IntenderModule as IntenderModuleType;
