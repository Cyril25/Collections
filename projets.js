// ============================================================
// projets.js — Registre des pages de collections.ofildudoubs.fr
// ============================================================
// Source unique du menu et de la garde des pages. Les SLUGS SONT LES
// MEMES que dans membres.projets du hub admin et que dans les blocs
// match de firestore.rules : « achats » et « fournisseurs ».
//
// C'est ce qui permet a ce site de ne gerer AUCUN droit lui-meme. Les
// acces se donnent une seule fois, sur la page Membres du hub ; ici on
// se contente de lire la fiche de la personne connectee et d'obeir.
//
// ⚠ Ajouter une page ici ne cree aucun droit : il faut
//   1. l'entree ci-dessous,
//   2. un bloc match dans firestore.rules (depot Admin),
//   3. une entree dans PROJETS de projets.js (depot Admin), sans quoi
//      la case a cocher n'existe pas et personne ne peut recevoir l'acces.
// ============================================================

var PROJETS = [
    {
        slug: 'achats',
        nom: 'Achats',
        icone: 'fa-solid fa-cart-shopping',
        url: 'index.html',
        description: 'Commandes passees, colis attendus, montant depense, exemplaires en trop.'
    },
    {
        slug: 'fournisseurs',
        nom: 'Comptes',
        icone: 'fa-solid fa-key',
        url: 'comptes.html',
        // Dit noir sur blanc dans le registre : c'est ici qu'on decide de
        // cocher la case, autant que la consequence soit ecrite au meme
        // endroit que le droit.
        description: 'Fournisseurs et identifiants. ⚠ Ce droit donne acces a TOUS les mots de passe.'
    }
];

function getProjet(slug) {
    for (var i = 0; i < PROJETS.length; i++) {
        if (PROJETS[i].slug === slug) return PROJETS[i];
    }
    return null;
}
