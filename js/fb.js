// Firebase 연결(이 파일은 고치지 않아도 됩니다).
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  writeBatch, serverTimestamp, arrayUnion, arrayRemove, deleteField, Bytes, Timestamp,
  terminate, clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const configured = !String(firebaseConfig.apiKey || '').startsWith('여기에');

export const app = initializeApp(configured ? firebaseConfig : { apiKey: 'x', projectId: 'not-configured', appId: 'x' });
export const auth = getAuth(app);

// 네트워크가 잠시 끊겨도 쓴 내용이 기기에 남아 있다가 다시 연결되면 저장됩니다.
// (기기 저장소를 쓸 수 없는 브라우저에서는 SDK가 알아서 메모리 저장으로 바꿉니다.)
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// 기기에 남은 Firestore 임시 저장본을 지운다(나가기).
export async function clearLocalData() {
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { /* 다른 탭이 열려 있으면 지우지 못할 수 있음 */ }
}

export {
  signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  writeBatch, serverTimestamp, arrayUnion, arrayRemove, deleteField, Bytes, Timestamp
};
