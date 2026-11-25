import type { CapacitorConfig } from '@capacitor/cli'

const serverUrl = process.env.MOLING_SERVER_URL || 'http://192.168.10.203:3100'

const config: CapacitorConfig = {
  appId: 'com.moling.writing',
  appName: '墨灵写作',
  webDir: 'www',
  server: {
    url: serverUrl,
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
