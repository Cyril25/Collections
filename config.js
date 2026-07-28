// ============================================================
// config.js — collections.ofildudoubs.fr
// ============================================================
// Meme projet Firebase que le hub admin (repo Admin) :
// une seule console, une seule liste de domaines autorises.
// Copier ici le MEME objet FIREBASE_CONFIG que dans le hub.
//
// Ces valeurs sont publiques par nature : la securite reelle
// vient des regles Firestore, pas de ces cles.
// ============================================================

// --- 1. Configuration Firebase (identique au hub admin) ------
var FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAmzfqfxzqRPwjYtqcMIpx7YoA7WFcztAM",
    authDomain:        "ofildudoubs-hub.firebaseapp.com",
    projectId:         "ofildudoubs-hub",
    storageBucket:     "ofildudoubs-hub.firebasestorage.app",
    messagingSenderId: "974628508687",
    appId:             "1:974628508687:web:87dfcb92aa5e0eaec97f7a"
    // measurementId omis : Analytics n'est pas charge sur ce site.
};

// --- 2. Qui a le droit d'entrer ------------------------------
var ALLOWED_EMAILS = ['cyril.samson41@gmail.com'];

// --- 3. Identite du site -------------------------------------
var SITE_TITLE = 'Collections';
var SITE_ICON  = 'fa-solid fa-boxes-stacked';

// --- 4. Navigation -------------------------------------------
var NAV_LINKS = [
    { href: 'index.html', icon: 'fa-solid fa-house', label: 'Accueil' }
];
