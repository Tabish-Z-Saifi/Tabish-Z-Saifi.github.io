/* Firebase bootstrap. Everything else imports { auth, db, configReady } from here. */
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const configReady = !/PASTE/.test(firebaseConfig.apiKey || '');

export let app = null, auth = null, db = null;

if (configReady) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Persistent local cache = full offline support: reads served locally,
  // writes queued and synced when back online. Multi-tab safe.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
}
