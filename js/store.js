/* Data layer: all Firestore + Auth operations. UI code never touches Firestore directly. */
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot,
  writeBatch, serverTimestamp, Timestamp, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const DEFAULT_FUNCTIONS = ['Mehendi', 'Haldi', 'Barat', 'Niqqah', 'Reception'];

/* Random id: 20 chars for docs, short uppercase for invite codes */
export function rid(len = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(buf, b => chars[b % chars.length]).join('');
}
const stamp = by => ({ uid: by.uid, name: by.name, at: serverTimestamp() });

/* ---------------- Auth ---------------- */
export const watchAuth = cb => onAuthStateChanged(auth, cb);
export const signUp = (email, pw) => createUserWithEmailAndPassword(auth, email, pw);
export const signIn = (email, pw) => signInWithEmailAndPassword(auth, email, pw);
export const signInGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
export const resetPassword = email => sendPasswordResetEmail(auth, email);

/* ---------------- User pointer (which account am I in?) ---------------- */
export async function getUserPointer(uid) {
  const s = await getDoc(doc(db, 'users', uid));
  return s.exists() ? s.data() : null;
}
export const clearUserPointer = uid => deleteDoc(doc(db, 'users', uid));

/* ---------------- Account lifecycle ---------------- */
export async function createAccount(user, accountName, profileName) {
  const accountId = rid();
  // Order matters for security rules: account doc → member doc → pointer.
  await setDoc(doc(db, 'accounts', accountId), {
    name: accountName,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    functions: DEFAULT_FUNCTIONS.map(n => ({ id: rid(8), name: n }))
  });
  await setDoc(doc(db, 'accounts', accountId, 'members', user.uid), {
    name: profileName, email: user.email || '', joinedAt: serverTimestamp()
  });
  await setDoc(doc(db, 'users', user.uid), { accountId, name: profileName });
  return accountId;
}

export async function joinAccount(user, code, profileName) {
  const invSnap = await getDoc(doc(db, 'invites', code));
  if (!invSnap.exists()) throw new Error('That invite code does not exist. Check for typos.');
  const inv = invSnap.data();
  if (inv.usedBy) throw new Error('That invite code was already used. Ask for a new one.');
  if (inv.expiresAt && inv.expiresAt.toMillis() < Date.now()) throw new Error('That invite code has expired (codes last 24h). Ask for a new one.');
  await setDoc(doc(db, 'accounts', inv.accountId, 'members', user.uid), {
    name: profileName, email: user.email || '', joinedAt: serverTimestamp(), inviteCode: code
  });
  await updateDoc(doc(db, 'invites', code), { usedBy: user.uid, usedAt: serverTimestamp() });
  await setDoc(doc(db, 'users', user.uid), { accountId: inv.accountId, name: profileName });
  return inv.accountId;
}

/* ---------------- Live listeners ---------------- */
export const listenAccount = (accountId, cb, err) =>
  onSnapshot(doc(db, 'accounts', accountId),
    s => cb(s.exists() ? { id: s.id, ...s.data() } : null), err);

export const listenGuests = (accountId, cb, err) =>
  onSnapshot(collection(db, 'accounts', accountId, 'guests'),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), err);

export const listenMembers = (accountId, cb) =>
  onSnapshot(collection(db, 'accounts', accountId, 'members'),
    s => cb(s.docs.map(d => ({ uid: d.id, ...d.data() }))));

export const listenInviteSettings = (accountId, cb) =>
  onSnapshot(doc(db, 'accounts', accountId, 'settings', 'invite'),
    s => cb(s.exists() ? s.data() : null));

/* ---------------- Guests CRUD ---------------- */
export function addGuest(accountId, data, by) {
  const s = stamp(by);
  return setDoc(doc(db, 'accounts', accountId, 'guests', rid()),
    { ...data, createdBy: s, updatedBy: s });
}
export function updateGuest(accountId, id, data, by) {
  return updateDoc(doc(db, 'accounts', accountId, 'guests', id),
    { ...data, updatedBy: stamp(by) });
}
export const deleteGuest = (accountId, id) =>
  deleteDoc(doc(db, 'accounts', accountId, 'guests', id));

/* ---------------- Functions list ---------------- */
export const saveFunctions = (accountId, functions) =>
  updateDoc(doc(db, 'accounts', accountId), { functions });

/* Remove a deleted function id from every guest that has it (chunked batches). */
export async function removeFunctionFromGuests(accountId, fnId, guestIds) {
  for (let i = 0; i < guestIds.length; i += 400) {
    const batch = writeBatch(db);
    guestIds.slice(i, i + 400).forEach(gid =>
      batch.update(doc(db, 'accounts', accountId, 'guests', gid), { functions: arrayRemove(fnId) }));
    await batch.commit();
  }
}

/* ---------------- Invites & members ---------------- */
export async function createInvite(accountId, uid) {
  const code = rid(8).toUpperCase();
  await setDoc(doc(db, 'invites', code), {
    accountId, createdBy: uid, createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000),
    usedBy: null
  });
  return code;
}
export const removeMember = (accountId, uid) =>
  deleteDoc(doc(db, 'accounts', accountId, 'members', uid));

/* ---------------- Invitation card (image + message) ---------------- */
export const saveInviteSettings = (accountId, data) =>
  setDoc(doc(db, 'accounts', accountId, 'settings', 'invite'), data, { merge: true });

/* ---------------- Bulk ops ---------------- */
export async function importGuests(accountId, guests, by) {
  for (let i = 0; i < guests.length; i += 400) {
    const batch = writeBatch(db);
    guests.slice(i, i + 400).forEach(g => {
      const s = stamp(by);
      batch.set(doc(db, 'accounts', accountId, 'guests', rid()),
        { ...g, createdBy: s, updatedBy: s });
    });
    await batch.commit();
  }
}
export async function deleteAllGuests(accountId, ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach(id => batch.delete(doc(db, 'accounts', accountId, 'guests', id)));
    await batch.commit();
  }
}
