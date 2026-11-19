/**
 * static/js/modules/firebase-config.js
 * Firebase app initialization — single source of truth for the whole frontend.
 * Import from this module wherever Firebase services are needed.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getDatabase }    from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyA26YRZ5Ot2XdpKtgUydsgsmvMfeNE5QAA",
  authDomain:        "smart-traffic-a4a4a.firebaseapp.com",
  projectId:         "smart-traffic-a4a4a",
  storageBucket:     "smart-traffic-a4a4a.firebasestorage.app",
  messagingSenderId: "160908946037",
  appId:             "1:160908946037:web:f80f1162497141003ca63c",
  measurementId:     "G-N4V9GXPHHB",
  databaseURL:       "https://smart-traffic-a4a4a-default-rtdb.firebaseio.com",
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db   = getDatabase(firebaseApp);
export default firebaseApp;

