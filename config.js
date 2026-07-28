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
    apiKey:            "A_REMPLACER",
    authDomain:        "A_REMPLACER.firebaseapp.com",
    projectId:         "A_REMPLACER",
    storageBucket:     "A_REMPLACER.appspot.com",
    messagingSenderId: "A_REMPLACER",
    appId:             "A_REMPLACER"
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
