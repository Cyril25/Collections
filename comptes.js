// ============================================================
// comptes.js — Fournisseurs et comptes
// ============================================================
// Collection Firestore « fournisseurs ». UN SEUL TIROIR pour deux
// choses, discriminees par un champ « type » :
//
//   type: 'fournisseur'  nom, cle, site, notes
//   type: 'compte'       fournisseurId, libelle, email, identifiant,
//                        motDePasse, principal, notes
//
// Pourquoi pas une sous-collection « fournisseurs/{id}/comptes » : il
// faudrait un ecouteur par fournisseur, ou une requete collectionGroup
// avec son index — pour une poignee de documents. Ici un seul
// onSnapshot alimente toute la page, et la recherche voit d'un coup les
// noms de fournisseurs ET les adresses email.
//
// ⚠ LES MOTS DE PASSE SONT STOCKES EN CLAIR. Ce fichier ne les met
// jamais dans le HTML genere ni dans un attribut : ils sont injectes
// par textContent au moment ou on les revele, et re-masques seuls au
// bout de DELAI_MASQUAGE_MS. Voir le README pour ce que ca protege
// (le regard par-dessus l'epaule, les captures d'ecran) et surtout ce
// que ca ne protege pas (l'acces au compte Google).
// ============================================================

var TYPE_FOURNISSEUR = 'fournisseur';
var TYPE_COMPTE      = 'compte';

// Un mot de passe revele et oublie a l'ecran finit par etre vu. Trente
// secondes suffisent a le lire ou le recopier.
var DELAI_MASQUAGE_MS = 30000;

var MASQUE = '••••••••';

// ------------------------------------------------------------
// 1. État de la page
// ------------------------------------------------------------
var db = null;
var fournisseurs = [];
var comptes = [];
var mdpVisibles = {};
var minuteries = {};
var fournisseurEnEdition = null;
var compteEnEdition = null;
var fournisseurDuCompte = null;
var suppressionEnCours = null;
var premierChargement = true;

// ------------------------------------------------------------
// 2. Démarrage
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    ecouterFournisseurs();
}

function ecouterFournisseurs() {
    db.collection('fournisseurs').onSnapshot(function(snapshot) {
        fournisseurs = [];
        comptes = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            if (data.type === TYPE_COMPTE) comptes.push(data);
            else fournisseurs.push(data);
        });
        premierChargement = false;
        render();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        var liste = document.getElementById('fournisseurs-list');
        if (liste) {
            liste.innerHTML = '<div class="error-block">' +
                '<i class="fa-solid fa-circle-exclamation"></i>' +
                '<strong>Impossible de lire les fournisseurs.</strong><br>' +
                '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur.message) + '</span><br>' +
                '<span style="color:var(--color-text-muted)">Si le message parle de permissions : le bloc ' +
                '<code>match /fournisseurs</code> n\'est pas publié dans les règles Firestore.</span>' +
                '</div>';
        }
    });
}

// ------------------------------------------------------------
// 3. Utilitaires
// ------------------------------------------------------------
function trouverFournisseur(id) {
    for (var i = 0; i < fournisseurs.length; i++) {
        if (fournisseurs[i].id === id) return fournisseurs[i];
    }
    return null;
}

function trouverCompte(id) {
    for (var i = 0; i < comptes.length; i++) {
        if (comptes[i].id === id) return comptes[i];
    }
    return null;
}

// Le compte principal d'abord, puis par libellé : l'ordre dans lequel on
// les cherche des yeux.
function comptesDe(fournisseurId) {
    return comptes.filter(function(compte) {
        return compte.fournisseurId === fournisseurId;
    }).sort(function(a, b) {
        if (!!b.principal !== !!a.principal) return b.principal ? 1 : -1;
        return (a.libelle || a.email || '').localeCompare(b.libelle || b.email || '', 'fr');
    });
}

// Un « javascript: » ou un « data: » collé dans le champ Site deviendrait
// un lien exécutable au clic : on n'accepte que http(s), et on complète
// les saisies du type « monnaiedeparis.fr », qui sinon partiraient en
// lien relatif vers une page du site.
function urlSure(valeur) {
    var texte = String(valeur == null ? '' : valeur).trim();
    if (!texte) return '';
    if (/^https?:\/\//i.test(texte)) return texte;
    if (/^[a-z][a-z0-9+.-]*:/i.test(texte)) return '';
    return 'https://' + texte;
}

function libelleUrl(url) {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

// L'adresse en lignes prêtes à afficher ou à coller dans un formulaire
// de livraison. Chaque morceau est facultatif : une adresse à moitié
// remplie doit rendre ce qu'on en connaît, pas une ligne vide ni un
// « undefined » au milieu.
function adresseFormatee(compte) {
    var lignes = [];
    if (compte.destinataire) lignes.push(compte.destinataire);
    if (compte.rue) lignes.push(compte.rue);
    var villeComplete = [compte.codePostal, compte.ville]
        .filter(function(morceau) { return !!morceau; }).join(' ');
    if (villeComplete) lignes.push(villeComplete);
    return lignes;
}

function cleNom(texte) {
    return String(texte == null ? '' : texte)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function clearSearch() {
    var input = document.getElementById('search-input');
    if (input) input.value = '';
    render();
}

function termeRecherche() {
    var input = document.getElementById('search-input');
    var terme = input ? input.value.trim().toLowerCase() : '';
    var boutonClear = document.getElementById('search-clear');
    if (boutonClear) boutonClear.style.display = terme ? '' : 'none';
    return terme;
}

// Un fournisseur reste visible si l'un de ses comptes correspond : on
// cherche « free.fr » pour retrouver chez qui on a utilisé cette adresse.
// Le mot de passe n'entre PAS dans la recherche — le taper pour le
// retrouver n'a pas de sens, et ça éviterait de le confirmer par
// tâtonnement.
function correspond(fournisseur, terme) {
    if (!terme) return true;
    var texte = (fournisseur.nom || '') + ' ' + (fournisseur.site || '') + ' ' + (fournisseur.notes || '');
    comptesDe(fournisseur.id).forEach(function(compte) {
        texte += ' ' + (compte.libelle || '') + ' ' + (compte.email || '')
              + ' ' + (compte.identifiant || '') + ' ' + (compte.notes || '')
              + ' ' + (compte.telephone || '') + ' ' + (compte.modePaiement || '')
              + ' ' + adresseFormatee(compte).join(' ');
    });
    return texte.toLowerCase().indexOf(terme) !== -1;
}

// ------------------------------------------------------------
// 4. Rendu
// ------------------------------------------------------------
function render() {
    var liste = document.getElementById('fournisseurs-list');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!liste) return;

    var terme = termeRecherche();
    var visibles = fournisseurs.filter(function(f) { return correspond(f, terme); })
        .sort(function(a, b) { return (a.nom || '').localeCompare(b.nom || '', 'fr'); });

    if (compteur) {
        compteur.textContent = visibles.length + ' fournisseur' + (visibles.length > 1 ? 's' : '')
            + ' — ' + comptes.length + ' compte' + (comptes.length > 1 ? 's' : '');
    }

    if (visibles.length === 0) {
        liste.innerHTML = '';
        if (vide) {
            vide.style.display = premierChargement ? 'none' : 'block';
            var message = document.getElementById('empty-message');
            if (message) message.textContent = fournisseurs.length
                ? 'Aucun fournisseur ne correspond à cette recherche.'
                : 'Aucun fournisseur pour l\'instant. Commencez par en créer un, puis ajoutez-y ses comptes.';
        }
        return;
    }
    if (vide) vide.style.display = 'none';

    liste.innerHTML = visibles.map(renderFournisseur).join('');
    // Les mots de passe déjà révélés le restent après un rafraîchissement
    // Firestore — mais ils ne passent jamais par innerHTML : on les
    // réinjecte ici par textContent.
    Object.keys(mdpVisibles).forEach(function(id) {
        if (mdpVisibles[id]) appliquerMdp(id, true);
    });
}

function renderFournisseur(fournisseur) {
    var idAttr = jsAttr(fournisseur.id);
    var url = urlSure(fournisseur.site);
    var lignes = comptesDe(fournisseur.id);

    var lienSite = url
        ? '<a class="fournisseur-site" href="' + escapeAttr(url) + '" target="_blank" rel="noopener noreferrer" '
          + 'onclick="event.stopPropagation()" title="Ouvrir ' + escapeAttr(url) + '">'
          + '<i class="fa-solid fa-arrow-up-right-from-square"></i> ' + escapeHtml(libelleUrl(url)) + '</a>'
        : '';

    return '<section class="fournisseur">'
        + '<header class="fournisseur-entete">'
        +   '<div class="fournisseur-titre">'
        +     '<h2>' + escapeHtml(fournisseur.nom || '(sans nom)') + '</h2>'
        +     lienSite
        +   '</div>'
        +   '<div class="fournisseur-actions">'
        +     '<button type="button" class="icon-btn" title="Modifier le fournisseur" '
        +       'onclick="ouvrirModaleFournisseur(\'' + idAttr + '\')"><i class="fa-solid fa-pen"></i></button>'
        +     '<button type="button" class="btn-ajout-compte" '
        +       'onclick="ouvrirModaleCompte(\'' + idAttr + '\', null)">'
        +       '<i class="fa-solid fa-plus"></i> Compte</button>'
        +   '</div>'
        + '</header>'
        + (fournisseur.notes ? '<p class="fournisseur-notes">' + escapeHtml(fournisseur.notes) + '</p>' : '')
        + (lignes.length
            ? '<div class="comptes">' + lignes.map(renderCompte).join('') + '</div>'
            : '<p class="fournisseur-vide">Aucun compte enregistré pour ce fournisseur.</p>')
        + '</section>';
}

function renderCompte(compte) {
    var idAttr = jsAttr(compte.id);
    var idHtml = escapeAttr(compte.id);

    // Pas de libellé, pas de ligne : un « Compte » générique n'apprend
    // rien et vole la place de l'email, qui identifie déjà le compte.
    var entete = (compte.principal
            ? '<span class="badge badge-principal"><i class="fa-solid fa-star"></i>principal</span>'
            : '')
        + (compte.libelle ? '<span class="compte-libelle">' + escapeHtml(compte.libelle) + '</span>' : '');

    var ligneEmail = compte.email
        ? '<div class="compte-ligne">'
        +   '<i class="fa-solid fa-envelope compte-icone" title="Email"></i>'
        +   '<span class="compte-valeur">' + escapeHtml(compte.email) + '</span>'
        +   '<button type="button" class="icon-btn" title="Copier l\'adresse" '
        +     'onclick="copierEmail(\'' + idAttr + '\')"><i class="fa-solid fa-copy"></i></button>'
        + '</div>'
        : '';

    var ligneIdentifiant = compte.identifiant
        ? '<div class="compte-ligne">'
        +   '<i class="fa-solid fa-user compte-icone" title="Identifiant"></i>'
        +   '<span class="compte-valeur">' + escapeHtml(compte.identifiant) + '</span>'
        + '</div>'
        : '';

    var ligneTelephone = compte.telephone
        ? '<div class="compte-ligne">'
        +   '<i class="fa-solid fa-phone compte-icone" title="Téléphone"></i>'
        +   '<span class="compte-valeur">' + escapeHtml(compte.telephone) + '</span>'
        +   '<button type="button" class="icon-btn" title="Copier le téléphone" '
        +     'onclick="copierTelephone(\'' + idAttr + '\')"><i class="fa-solid fa-copy"></i></button>'
        + '</div>'
        : '';

    var lignePaiement = compte.modePaiement
        ? '<div class="compte-ligne">'
        +   '<i class="fa-solid fa-credit-card compte-icone" title="Moyen de paiement"></i>'
        +   '<span class="compte-valeur">' + escapeHtml(compte.modePaiement) + '</span>'
        + '</div>'
        : '';

    // L'adresse se copie d'un bloc : c'est comme ça qu'elle se colle dans
    // un formulaire de livraison, pas champ par champ.
    var lignesAdresse = adresseFormatee(compte);
    var ligneAdresse = lignesAdresse.length
        ? '<div class="compte-ligne compte-ligne--adresse">'
        +   '<i class="fa-solid fa-location-dot compte-icone" title="Adresse de livraison"></i>'
        +   '<span class="compte-valeur">' + lignesAdresse.map(escapeHtml).join('<br>') + '</span>'
        +   '<button type="button" class="icon-btn" title="Copier l\'adresse complète" '
        +     'onclick="copierAdresse(\'' + idAttr + '\')"><i class="fa-solid fa-copy"></i></button>'
        + '</div>'
        : '';

    // Le mot de passe n'est PAS rendu ici : le HTML ne contient que des
    // points. Sa valeur arrive par textContent au clic sur l'œil, et
    // repart d'elle-même après DELAI_MASQUAGE_MS.
    var ligneMdp = compte.motDePasse
        ? '<div class="compte-ligne">'
        +   '<i class="fa-solid fa-lock compte-icone" title="Mot de passe"></i>'
        +   '<span class="compte-valeur compte-mdp" id="mdp-' + idHtml + '">' + MASQUE + '</span>'
        +   '<button type="button" class="icon-btn" title="Afficher / masquer" '
        +     'onclick="basculerMdp(\'' + idAttr + '\')">'
        +     '<i class="fa-solid fa-eye" id="oeil-' + idHtml + '"></i></button>'
        +   '<button type="button" class="icon-btn" title="Copier le mot de passe sans l\'afficher" '
        +     'onclick="copierMdp(\'' + idAttr + '\')"><i class="fa-solid fa-copy"></i></button>'
        + '</div>'
        : '<div class="compte-ligne compte-ligne--absent">'
        +   '<i class="fa-solid fa-lock-open compte-icone"></i>'
        +   '<span class="compte-valeur">Pas de mot de passe enregistré</span>'
        + '</div>';

    return '<article class="compte">'
        + '<div class="compte-entete">'
        +   '<div>' + entete + '</div>'
        +   '<button type="button" class="icon-btn" title="Modifier ce compte" '
        +     'onclick="ouvrirModaleCompte(\'' + jsAttr(compte.fournisseurId) + '\', \'' + idAttr + '\')">'
        +     '<i class="fa-solid fa-pen"></i></button>'
        + '</div>'
        + ligneEmail + ligneIdentifiant + ligneMdp + ligneTelephone + lignePaiement + ligneAdresse
        + (compte.notes ? '<p class="compte-notes">' + escapeHtml(compte.notes) + '</p>' : '')
        + '</article>';
}

// ------------------------------------------------------------
// 5. Révéler / masquer / copier
// ------------------------------------------------------------
function appliquerMdp(id, visible) {
    var champ = document.getElementById('mdp-' + id);
    var oeil = document.getElementById('oeil-' + id);
    if (!champ) return;
    var compte = trouverCompte(id);
    // textContent et non innerHTML : le mot de passe n'est pas du HTML,
    // et un « <b> » dans un mot de passe ne doit ni disparaître ni être
    // interprété.
    champ.textContent = visible ? (compte && compte.motDePasse ? compte.motDePasse : '—') : MASQUE;
    champ.className = 'compte-valeur compte-mdp' + (visible ? ' compte-mdp--visible' : '');
    if (oeil) oeil.className = 'fa-solid fa-eye' + (visible ? '-slash' : '');
}

function basculerMdp(id) {
    var visible = !mdpVisibles[id];
    mdpVisibles[id] = visible;
    appliquerMdp(id, visible);

    if (minuteries[id]) {
        clearTimeout(minuteries[id]);
        delete minuteries[id];
    }
    if (visible) {
        minuteries[id] = setTimeout(function() {
            mdpVisibles[id] = false;
            delete minuteries[id];
            appliquerMdp(id, false);
        }, DELAI_MASQUAGE_MS);
    }
}

// Copier plutôt qu'afficher : c'est le geste courant (coller dans le
// formulaire du fournisseur), et rien n'apparaît à l'écran.
function copierValeur(texte, quoi) {
    if (!texte) {
        showToast('Rien à copier.', 'error');
        return;
    }
    if (!navigator.clipboard) {
        showToast('Copie impossible : le navigateur ne le permet pas ici.', 'error');
        return;
    }
    navigator.clipboard.writeText(texte).then(function() {
        showToast(quoi + ' copié dans le presse-papier.', 'success');
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Copie refusée par le navigateur.', 'error');
    });
}

function copierMdp(id) {
    var compte = trouverCompte(id);
    copierValeur(compte && compte.motDePasse, 'Mot de passe');
}

function copierEmail(id) {
    var compte = trouverCompte(id);
    copierValeur(compte && compte.email, 'Adresse');
}

function copierTelephone(id) {
    var compte = trouverCompte(id);
    copierValeur(compte && compte.telephone, 'Téléphone');
}

function copierAdresse(id) {
    var compte = trouverCompte(id);
    copierValeur(compte ? adresseFormatee(compte).join('\n') : '', 'Adresse postale');
}

// ------------------------------------------------------------
// 6. Modale fournisseur
// ------------------------------------------------------------
function ouvrirModaleFournisseur(id) {
    fournisseurEnEdition = id || null;
    var fournisseur = id ? trouverFournisseur(id) : null;

    document.getElementById('titre-fournisseur').textContent = fournisseur ? 'Modifier le fournisseur' : 'Nouveau fournisseur';
    document.getElementById('ff-nom').value   = fournisseur ? (fournisseur.nom || '') : '';
    document.getElementById('ff-site').value  = fournisseur ? (fournisseur.site || '') : '';
    document.getElementById('ff-notes').value = fournisseur ? (fournisseur.notes || '') : '';

    var meta = document.getElementById('ff-meta');
    if (fournisseur) {
        var nb = comptesDe(fournisseur.id).length;
        meta.textContent = 'Créé le ' + formatDateFr(fournisseur.createdAt)
            + ' — ' + nb + ' compte' + (nb > 1 ? 's' : '');
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    document.getElementById('ff-supprimer').style.display = fournisseur ? '' : 'none';
    document.getElementById('modal-fournisseur').style.display = 'flex';
    document.getElementById('ff-nom').focus();
}

function fermerModaleFournisseur() {
    document.getElementById('modal-fournisseur').style.display = 'none';
    fournisseurEnEdition = null;
}

function sauverFournisseur() {
    var nom = document.getElementById('ff-nom').value.trim();
    if (!nom) {
        showToast('Le nom du fournisseur est obligatoire.', 'error');
        document.getElementById('ff-nom').focus();
        return;
    }

    var saisieSite = document.getElementById('ff-site').value.trim();
    var site = urlSure(saisieSite);
    if (saisieSite && !site) {
        showToast('Ce lien n\'est pas une adresse http(s) valide.', 'error');
        return;
    }

    var donnees = {
        type:      TYPE_FOURNISSEUR,
        nom:       nom,
        cle:       cleNom(nom),
        site:      site,
        notes:     document.getElementById('ff-notes').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    var operation;
    if (fournisseurEnEdition) {
        operation = db.collection('fournisseurs').doc(fournisseurEnEdition).update(donnees);
    } else {
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        operation = db.collection('fournisseurs').add(donnees);
    }

    operation.then(function() {
        showToast(fournisseurEnEdition ? 'Fournisseur mis à jour.' : 'Fournisseur ajouté.', 'success');
        fermerModaleFournisseur();
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Enregistrement impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 7. Modale compte
// ------------------------------------------------------------
// Les moyens de paiement se suggèrent depuis ceux déjà saisis : rien à
// maintenir en dur, et « carte BNP » s'écrit pareil partout dès la
// deuxième fois. Même mécanique que les collections et vendeurs de la
// page Achats.
function remplirPaiements() {
    var cible = document.getElementById('paiement-list');
    if (!cible) return;
    var vus = {};
    comptes.forEach(function(compte) {
        var valeur = (compte.modePaiement || '').trim();
        if (valeur) vus[valeur] = true;
    });
    cible.innerHTML = Object.keys(vus).sort().map(function(valeur) {
        return '<option value="' + escapeAttr(valeur) + '"></option>';
    }).join('');
}

function ouvrirModaleCompte(fournisseurId, compteId) {
    fournisseurDuCompte = fournisseurId;
    compteEnEdition = compteId || null;
    var compte = compteId ? trouverCompte(compteId) : null;
    var fournisseur = trouverFournisseur(fournisseurId);

    document.getElementById('titre-compte').textContent = compte ? 'Modifier le compte' : 'Nouveau compte';
    document.getElementById('fc-fournisseur').textContent = fournisseur
        ? 'Chez ' + (fournisseur.nom || '(sans nom)') : '';

    remplirPaiements();
    document.getElementById('fc-libelle').value     = compte ? (compte.libelle || '') : '';
    document.getElementById('fc-email').value       = compte ? (compte.email || '') : '';
    document.getElementById('fc-identifiant').value = compte ? (compte.identifiant || '') : '';
    document.getElementById('fc-mdp').value         = compte ? (compte.motDePasse || '') : '';
    document.getElementById('fc-notes').value       = compte ? (compte.notes || '') : '';
    document.getElementById('fc-telephone').value   = compte ? (compte.telephone || '') : '';
    document.getElementById('fc-paiement').value    = compte ? (compte.modePaiement || '') : '';
    document.getElementById('fc-destinataire').value = compte ? (compte.destinataire || '') : '';
    document.getElementById('fc-rue').value         = compte ? (compte.rue || '') : '';
    document.getElementById('fc-cp').value          = compte ? (compte.codePostal || '') : '';
    document.getElementById('fc-ville').value       = compte ? (compte.ville || '') : '';
    // Le tout premier compte d'un fournisseur est le principal par défaut :
    // c'est vrai neuf fois sur dix et ça évite une case à cocher oubliée.
    document.getElementById('fc-principal').checked = compte
        ? !!compte.principal
        : comptesDe(fournisseurId).length === 0;

    var meta = document.getElementById('fc-meta');
    if (compte) {
        meta.textContent = 'Créé le ' + formatDateFr(compte.createdAt)
            + (compte.updatedAt ? ' — modifié le ' + formatDateFr(compte.updatedAt) : '');
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    document.getElementById('fc-supprimer').style.display = compte ? '' : 'none';
    document.getElementById('modal-compte').style.display = 'flex';
    document.getElementById('fc-libelle').focus();
}

function fermerModaleCompte() {
    document.getElementById('modal-compte').style.display = 'none';
    // Ne pas laisser le mot de passe dans le champ d'un formulaire caché.
    document.getElementById('fc-mdp').value = '';
    compteEnEdition = null;
    fournisseurDuCompte = null;
}

function sauverCompte() {
    if (!fournisseurDuCompte) return;

    var email = document.getElementById('fc-email').value.trim();
    if (!email) {
        showToast('L\'email du compte est obligatoire.', 'error');
        document.getElementById('fc-email').focus();
        return;
    }

    var principal = document.getElementById('fc-principal').checked;
    var donnees = {
        type:          TYPE_COMPTE,
        fournisseurId: fournisseurDuCompte,
        libelle:       document.getElementById('fc-libelle').value.trim(),
        email:         email,
        identifiant:   document.getElementById('fc-identifiant').value.trim(),
        motDePasse:    document.getElementById('fc-mdp').value,
        notes:         document.getElementById('fc-notes').value.trim(),
        telephone:     document.getElementById('fc-telephone').value.trim(),
        modePaiement:  document.getElementById('fc-paiement').value.trim(),
        destinataire:  document.getElementById('fc-destinataire').value.trim(),
        rue:           document.getElementById('fc-rue').value.trim(),
        codePostal:    document.getElementById('fc-cp').value.trim(),
        ville:         document.getElementById('fc-ville').value.trim(),
        principal:     principal,
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    };

    // « Principal » est unique par fournisseur : cocher le nouveau
    // décoche l'ancien, sinon deux comptes se disent principaux et
    // l'étoile ne veut plus rien dire.
    var lot = db.batch();
    var reference;
    if (compteEnEdition) {
        reference = db.collection('fournisseurs').doc(compteEnEdition);
        lot.update(reference, donnees);
    } else {
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        reference = db.collection('fournisseurs').doc();
        lot.set(reference, donnees);
    }
    if (principal) {
        comptesDe(fournisseurDuCompte).forEach(function(autre) {
            if (autre.id === reference.id || !autre.principal) return;
            lot.update(db.collection('fournisseurs').doc(autre.id), { principal: false });
        });
    }

    lot.commit().then(function() {
        showToast(compteEnEdition ? 'Compte mis à jour.' : 'Compte ajouté.', 'success');
        fermerModaleCompte();
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Enregistrement impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 8. Suppression
// ------------------------------------------------------------
function ouvrirSuppressionFournisseur() {
    if (!fournisseurEnEdition) return;
    var fournisseur = trouverFournisseur(fournisseurEnEdition);
    var nb = comptesDe(fournisseurEnEdition).length;
    suppressionEnCours = { quoi: TYPE_FOURNISSEUR, id: fournisseurEnEdition };

    document.getElementById('suppression-titre').textContent =
        'Supprimer ' + (fournisseur ? fournisseur.nom : 'ce fournisseur') + ' ?';
    document.getElementById('suppression-detail').textContent = nb
        ? 'Ses ' + nb + ' compte' + (nb > 1 ? 's seront supprimés' : ' sera supprimé')
          + ' avec lui, mots de passe compris. Suppression définitive.'
        : 'Suppression définitive.';
    document.getElementById('modal-suppression').style.display = 'flex';
}

function ouvrirSuppressionCompte() {
    if (!compteEnEdition) return;
    var compte = trouverCompte(compteEnEdition);
    suppressionEnCours = { quoi: TYPE_COMPTE, id: compteEnEdition };

    document.getElementById('suppression-titre').textContent = 'Supprimer ce compte ?';
    document.getElementById('suppression-detail').textContent =
        (compte && compte.email ? compte.email + ' — s' : 'S') + 'uppression définitive, mot de passe compris.';
    document.getElementById('modal-suppression').style.display = 'flex';
}

function fermerSuppression() {
    document.getElementById('modal-suppression').style.display = 'none';
    suppressionEnCours = null;
}

function confirmerSuppression() {
    if (!suppressionEnCours) return;
    var cible = suppressionEnCours;

    var operation;
    if (cible.quoi === TYPE_FOURNISSEUR) {
        // Supprimer le fournisseur seul laisserait ses comptes orphelins :
        // invisibles à l'écran, bien présents en base, mots de passe inclus.
        var lot = db.batch();
        lot.delete(db.collection('fournisseurs').doc(cible.id));
        comptesDe(cible.id).forEach(function(compte) {
            lot.delete(db.collection('fournisseurs').doc(compte.id));
        });
        operation = lot.commit();
    } else {
        operation = db.collection('fournisseurs').doc(cible.id).delete();
    }

    operation.then(function() {
        showToast(cible.quoi === TYPE_FOURNISSEUR ? 'Fournisseur supprimé.' : 'Compte supprimé.', 'success');
        fermerSuppression();
        fermerModaleCompte();
        fermerModaleFournisseur();
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Suppression impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 9. Export JSON
// ------------------------------------------------------------
// Même filet que sur la page Achats : Firestore en plan gratuit n'offre
// aucune sauvegarde. ⚠ Ce fichier contient les mots de passe EN CLAIR et
// atterrit dans le dossier Téléchargements, hors de toute règle Firestore.
// Le toast le rappelle — c'est le moment où on peut encore décider de le
// ranger ailleurs.
function exporterJson() {
    if (!fournisseurs.length && !comptes.length) {
        showToast('Rien à exporter.', 'error');
        return;
    }

    var contenu = {
        exporte_le: new Date().toISOString(),
        source: window.location.hostname + ' — collection Firestore « fournisseurs »',
        avertissement: 'Ce fichier contient des mots de passe en clair.',
        fournisseurs: fournisseurs.slice().sort(function(a, b) {
            return (a.nom || '').localeCompare(b.nom || '', 'fr');
        }).map(function(fournisseur) {
            return {
                id:    fournisseur.id,
                nom:   fournisseur.nom || '',
                site:  fournisseur.site || '',
                notes: fournisseur.notes || '',
                comptes: comptesDe(fournisseur.id).map(function(compte) {
                    return {
                        id:          compte.id,
                        libelle:     compte.libelle || '',
                        email:       compte.email || '',
                        identifiant: compte.identifiant || '',
                        motDePasse:   compte.motDePasse || '',
                        telephone:    compte.telephone || '',
                        modePaiement: compte.modePaiement || '',
                        destinataire: compte.destinataire || '',
                        rue:          compte.rue || '',
                        codePostal:   compte.codePostal || '',
                        ville:        compte.ville || '',
                        principal:    !!compte.principal,
                        notes:        compte.notes || ''
                    };
                })
            };
        })
    };

    var blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var lien = document.createElement('a');
    lien.href = url;
    lien.download = 'comptes-collections-' + new Date().toISOString().slice(0, 10) + '.json';
    lien.click();
    URL.revokeObjectURL(url);

    showToast('Export téléchargé — il contient les mots de passe en clair.', 'info');
}

// ------------------------------------------------------------
// 10. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    if (document.getElementById('modal-suppression').style.display === 'flex') {
        fermerSuppression();
    } else if (document.getElementById('modal-compte').style.display === 'flex') {
        fermerModaleCompte();
    } else if (document.getElementById('modal-fournisseur').style.display === 'flex') {
        fermerModaleFournisseur();
    }
});
