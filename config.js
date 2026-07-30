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

// --- 2. Le proprietaire --------------------------------------
// Superadmin par son adresse, quoi qu'il arrive a la collection membres.
// C'est le filet anti-verrouillage : sans lui, supprimer sa propre fiche
// par erreur fermerait la base definitivement.
// DOIT etre identique a proprietaire() dans firestore.rules (depot Admin)
// et a SUPERADMIN_EMAIL du hub.
var SUPERADMIN_EMAIL = 'cyril.samson41@gmail.com';

// Il n'y a plus de liste d'emails ici. Les acces vivent dans la
// collection Firestore « membres » — LA MEME que celle du hub admin —
// et se donnent depuis la page Membres du hub. Ce site ne fait que lire
// cet annuaire et obeir : aucun droit ne se cree ici.

// --- 3. Identite du site -------------------------------------
var SITE_TITLE = 'Collections';
var SITE_ICON  = 'fa-solid fa-boxes-stacked';

// --- 4. Navigation -------------------------------------------
// Le menu n'est plus une liste fixe : il sort de projets.js, filtre par
// les droits de la personne connectee.
