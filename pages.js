// ============================================================
// pages.js — Registre des pages de collections.ofildudoubs.fr
// ============================================================
// Sert uniquement a construire le menu et a savoir quel lien est actif.
// CE N'EST PAS UN REGISTRE DE DROITS.
//
// L'acces se donne AU NIVEAU DU SITE, pas page par page : une seule case
// a cocher sur la fiche membre du hub, « Collections » dans
// membres.sites. Qui entre ici voit donc toutes les pages — et n'y voit
// que ses propres donnees, puisque les deux collections Firestore sont
// cloisonnees par proprietaire.
//
// Ce fichier s'appelait projets.js et exposait un tableau PROJETS filtre
// par droits. C'etait une erreur de modele : « projet » designe une page
// du hub adossee a une collection Firestore, ce que ces pages ne sont
// pas. Renomme pour que le nom ne promette plus ce qu'il ne tient pas.
//
// Ajouter une page : l'entree ci-dessous, et c'est tout. Sa collection
// Firestore, si elle en a une, se declare dans firestore.rules (depot
// Admin) sous la meme condition aAccesSite('collections').
// ============================================================

var PAGES = [
    {
        cle: 'achats',
        nom: 'Achats',
        icone: 'fa-solid fa-cart-shopping',
        url: 'index.html',
        description: 'Commandes passees, colis attendus, montant depense, exemplaires en trop.'
    },
    {
        cle: 'comptes',
        nom: 'Comptes',
        icone: 'fa-solid fa-key',
        url: 'comptes.html',
        description: 'Vos fournisseurs et vos identifiants.'
    }
];

function getPage(cle) {
    for (var i = 0; i < PAGES.length; i++) {
        if (PAGES[i].cle === cle) return PAGES[i];
    }
    return null;
}
