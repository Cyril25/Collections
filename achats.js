// ============================================================
// achats.js — Suivi des achats de collection
// ============================================================
// Collection Firestore « achats ». Un document = UNE LIGNE D'ACHAT,
// pas un objet de collection : « 3 exemplaires du n°42 payés 4 € pièce
// chez Untel le 12 mars ». C'est le grain qui permet de répondre aux
// quatre questions de départ sans inventer d'inventaire :
//
//   ce que j'ai commandé   → les lignes
//   ce que j'attends       → les lignes non reçues (statut)
//   combien j'ai acheté    → la somme des lignes
//   ce que j'ai en double  → les lignes reçues, regroupées par article
//
// Le quatrième point est DÉDUIT, pas saisi : deux lignes reçues portant
// le même article donnent un doublon. Un inventaire séparé viendra plus
// tard ; il se construira à partir de ces mêmes lignes.
//
// Écoute temps réel (onSnapshot) : une ligne saisie sur le téléphone
// pendant une brocante apparaît sur le PC sans rechargement.
// ============================================================

// ------------------------------------------------------------
// 1. Référentiels
// ------------------------------------------------------------
var STATUTS = [
    { value: 'commande', label: 'Commandé', color: '#EF6C00' },
    { value: 'expedie',  label: 'Expédié',  color: '#1976D2' },
    { value: 'recu',     label: 'Reçu',     color: '#2E7D32' },
    { value: 'probleme', label: 'Problème', color: '#CC4444' },
    { value: 'annule',   label: 'Annulé',   color: '#757575' }
];

// Ce qui n'est pas encore entre mes mains et n'a pas été abandonné.
// « probleme » en fait partie : un litige reste un colis attendu.
var STATUTS_ATTENDUS = ['commande', 'expedie', 'probleme'];

// Au-delà, un colis toujours pas arrivé mérite une relance. Seuil large
// exprès : l'occasion vient souvent de l'étranger ou de particuliers.
var SEUIL_RETARD_JOURS = 30;

function getStatutDef(value) {
    for (var i = 0; i < STATUTS.length; i++) {
        if (STATUTS[i].value === value) return STATUTS[i];
    }
    return { value: value, label: value || '?', color: '#757575' };
}

function getStatutIndex(statut) {
    for (var i = 0; i < STATUTS.length; i++) {
        if (STATUTS[i].value === statut) return i;
    }
    return STATUTS.length;
}

// ------------------------------------------------------------
// 2. État de la page
// ------------------------------------------------------------
var db = null;
var achats = [];
var filtreStatut = 'attendus';
var filtreCollection = 'toutes';
var tri = { cle: 'dateCommande', sens: -1 };
var idEnEdition = null;
var premierChargement = true;

// ------------------------------------------------------------
// 3. Démarrage (appelé par auth.js une fois l'accès validé)
// ------------------------------------------------------------
function onHubReady() {
    db = firebase.firestore();
    remplirSelectStatut();
    ecouterAchats();
}

function remplirSelectStatut() {
    var select = document.getElementById('f-statut');
    if (!select) return;
    select.innerHTML = STATUTS.map(function(s) {
        return '<option value="' + s.value + '">' + escapeHtml(s.label) + '</option>';
    }).join('');
}

function ecouterAchats() {
    db.collection('achats').onSnapshot(function(snapshot) {
        achats = [];
        snapshot.forEach(function(doc) {
            var data = doc.data();
            data.id = doc.id;
            achats.push(data);
        });
        premierChargement = false;
        render();
    }, function(erreur) {
        console.error('Erreur Firestore :', erreur);
        var liste = document.getElementById('achats-list');
        if (liste) {
            liste.innerHTML = '<div class="error-block">' +
                '<i class="fa-solid fa-circle-exclamation"></i>' +
                '<strong>Impossible de lire les achats.</strong><br>' +
                '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur.message) + '</span><br>' +
                '<span style="color:var(--color-text-muted)">Si le message parle de permissions : le bloc ' +
                '<code>match /achats</code> n\'est pas publié dans les règles Firestore.</span>' +
                '</div>';
        }
    });
}

// ------------------------------------------------------------
// 4. Utilitaires de calcul
// ------------------------------------------------------------
// escapeAttr, jsAttr, toDate et formatDateFr viennent de hub-utils.js ;
// escapeHtml et showToast de auth.js.

// Les montants sont saisis en texte libre : « 12,50 » est ce que tape
// un francophone, et <input type="number"> le rejette silencieusement
// (value devient ''), ce qui enregistrerait 0 sans prévenir.
function nombre(texte) {
    if (texte == null) return 0;
    var valeur = parseFloat(String(texte).replace(/\s/g, '').replace(',', '.'));
    return isNaN(valeur) ? 0 : valeur;
}

function formatEuro(montant) {
    return (Number(montant) || 0).toLocaleString('fr-FR', {
        style: 'currency', currency: 'EUR', maximumFractionDigits: 2
    });
}

function totalLigne(achat) {
    return (Number(achat.quantite) || 0) * (Number(achat.prixUnitaire) || 0)
         + (Number(achat.fraisPort) || 0);
}

function joursDepuis(valeur) {
    var date = toDate(valeur);
    if (!date) return null;
    return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function estAttendu(achat) {
    return STATUTS_ATTENDUS.indexOf(achat.statut) !== -1;
}

// Une commande annulée ne se doit plus. Le reste est dû tant que la case
// n'est pas cochée — y compris ce qui n'est pas encore arrivé : sur eBay
// ou Delcampe on paie à la commande, l'attente ne dispense pas de régler.
function estAPayer(achat) {
    return achat.statut !== 'annule' && !achat.paye;
}

// Le retard ne s'applique pas à « probleme » : le litige est déjà signalé,
// inutile de le doubler d'une alerte de relance.
function estEnRetard(achat) {
    if (achat.statut !== 'commande' && achat.statut !== 'expedie') return false;
    var jours = joursDepuis(achat.dateCommande);
    return jours !== null && jours > SEUIL_RETARD_JOURS;
}

// Clé de regroupement des doublons. Deux lignes saisies à des mois
// d'écart ne seront jamais écrites à l'identique : on compare sur une
// forme normalisée (sans accents, sans casse, sans ponctuation), sinon
// « Tintin - Objectif Lune » et « tintin objectif lune » comptent pour
// deux articles différents et aucun doublon ne sort jamais.
function cleArticle(texte) {
    return String(texte == null ? '' : texte)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function cleDe(achat) {
    return achat.cle || cleArticle(achat.article);
}

// ------------------------------------------------------------
// 5. Doublons
// ------------------------------------------------------------
// Regroupement sur la clé SEULE, pas sur (collection + clé) : une
// collection mal orthographiée sur une des deux lignes ferait disparaître
// le doublon, ce qui est exactement le cas qu'on cherche à rattraper.
function calculerDoublons() {
    var parCle = {};

    achats.forEach(function(achat) {
        if (achat.statut !== 'recu') return;
        var cle = cleDe(achat);
        if (!cle) return;
        if (!parCle[cle]) {
            parCle[cle] = {
                cle: cle, libelle: achat.article || '', collection: achat.collection || '',
                exemplaires: 0, valeur: 0, lignes: []
            };
        }
        var groupe = parCle[cle];
        var quantite = Number(achat.quantite) || 0;
        groupe.exemplaires += quantite;
        // Prix d'achat hors port : le port est perdu, il ne se revend pas.
        groupe.valeur += quantite * (Number(achat.prixUnitaire) || 0);
        groupe.lignes.push(achat);
        if (!groupe.collection && achat.collection) groupe.collection = achat.collection;
    });

    var doublons = [];
    Object.keys(parCle).forEach(function(cle) {
        var groupe = parCle[cle];
        if (groupe.exemplaires <= 1) return;
        groupe.surplus = groupe.exemplaires - 1;
        groupe.prixMoyen = groupe.valeur / groupe.exemplaires;
        groupe.valeurSurplus = groupe.prixMoyen * groupe.surplus;
        doublons.push(groupe);
    });

    doublons.sort(function(a, b) { return b.valeurSurplus - a.valeurSurplus; });
    return doublons;
}

// Ensemble des clés déjà reçues — sert à signaler « tu en as déjà un »
// sur une ligne encore en route, avant qu'elle ne devienne un doublon.
function clesEnCollection() {
    var presentes = {};
    achats.forEach(function(achat) {
        if (achat.statut !== 'recu') return;
        var cle = cleDe(achat);
        if (cle) presentes[cle] = (presentes[cle] || 0) + (Number(achat.quantite) || 0);
    });
    return presentes;
}

// ------------------------------------------------------------
// 6. Bandeau de chiffres
// ------------------------------------------------------------
function renderStats() {
    var cible = document.getElementById('stats');
    if (!cible) return;

    var depense = 0, engage = 0, valeurRecue = 0, aPayer = 0;
    var nbAttendus = 0, nbRetard = 0, nbLignes = 0, nbExemplaires = 0, nbAPayer = 0;

    achats.forEach(function(achat) {
        if (achat.statut === 'annule') return;
        var total = totalLigne(achat);
        depense += total;
        nbLignes++;
        if (!achat.paye) {
            aPayer += total;
            nbAPayer++;
        }
        if (estAttendu(achat)) {
            engage += total;
            nbAttendus++;
            if (estEnRetard(achat)) nbRetard++;
        }
        if (achat.statut === 'recu') {
            valeurRecue += total;
            nbExemplaires += (Number(achat.quantite) || 0);
        }
    });

    var doublons = calculerDoublons();
    var surplus = 0, valeurSurplus = 0;
    doublons.forEach(function(groupe) {
        surplus += groupe.surplus;
        valeurSurplus += groupe.valeurSurplus;
    });

    cible.innerHTML =
        tuile('Dépensé', formatEuro(depense), nbLignes + ' ligne' + (nbLignes > 1 ? 's' : '') + ' — annulées exclues', '') +
        tuile('À payer', formatEuro(aPayer),
            nbAPayer ? nbAPayer + ' ligne' + (nbAPayer > 1 ? 's' : '') + ' non réglée' + (nbAPayer > 1 ? 's' : '') : 'tout est réglé',
            nbAPayer ? 'stat--impaye' : 'stat--ok') +
        tuile('En attente', String(nbAttendus), formatEuro(engage) + ' engagés', nbAttendus ? 'stat--attente' : '') +
        tuile('En retard', String(nbRetard), 'commandé il y a plus de ' + SEUIL_RETARD_JOURS + ' j', nbRetard ? 'stat--alerte' : '') +
        tuile('Reçu', String(nbExemplaires), formatEuro(valeurRecue) + ' — ' + nbExemplaires + ' exemplaire' + (nbExemplaires > 1 ? 's' : ''), 'stat--ok') +
        tuile('En double', String(surplus), surplus ? '~' + formatEuro(valeurSurplus) + ' revendables' : 'aucun exemplaire en trop', surplus ? 'stat--revendre' : '');
}

function tuile(libelle, valeur, detail, modificateur) {
    return '<div class="stat ' + modificateur + '">' +
        '<div class="stat-label">' + escapeHtml(libelle) + '</div>' +
        '<div class="stat-valeur">' + escapeHtml(valeur) + '</div>' +
        '<div class="stat-detail">' + escapeHtml(detail) + '</div>' +
        '</div>';
}

// ------------------------------------------------------------
// 7. Filtres
// ------------------------------------------------------------
function renderFiltres() {
    var comptes = {};
    var nbAttendus = 0, nbRetard = 0, nbRevendre = 0, nbAPayer = 0;
    achats.forEach(function(achat) {
        comptes[achat.statut] = (comptes[achat.statut] || 0) + 1;
        if (estAttendu(achat)) nbAttendus++;
        if (estEnRetard(achat)) nbRetard++;
        if (achat.aRevendre) nbRevendre++;
        if (estAPayer(achat)) nbAPayer++;
    });

    var wrapStatut = document.getElementById('statut-filter');
    if (wrapStatut) {
        var html = boutonFiltre('statut', 'attendus', 'À recevoir', nbAttendus);
        html += boutonFiltre('statut', 'retard', 'En retard', nbRetard);
        html += boutonFiltre('statut', 'apayer', 'À payer', nbAPayer);
        STATUTS.forEach(function(s) {
            html += boutonFiltre('statut', s.value, s.label, comptes[s.value] || 0);
        });
        html += boutonFiltre('statut', 'doublons', 'Doublons', calculerDoublons().length);
        html += boutonFiltre('statut', 'revendre', 'À revendre', nbRevendre);
        html += boutonFiltre('statut', 'tous', 'Tout', achats.length);
        wrapStatut.innerHTML = html;
    }

    var wrapCollection = document.getElementById('collection-filter');
    if (wrapCollection) {
        var parCollection = {};
        achats.forEach(function(achat) {
            var nom = achat.collection || 'Sans collection';
            parCollection[nom] = (parCollection[nom] || 0) + 1;
        });
        var noms = Object.keys(parCollection).sort();
        if (noms.length < 2) {
            wrapCollection.innerHTML = '';
            filtreCollection = 'toutes';
            return;
        }
        var htmlC = boutonFiltre('collection', 'toutes', 'Toutes les collections', achats.length);
        noms.forEach(function(nom) {
            htmlC += boutonFiltre('collection', nom, nom, parCollection[nom]);
        });
        wrapCollection.innerHTML = htmlC;
    }
}

function boutonFiltre(type, valeur, libelle, compte) {
    var courant = (type === 'statut') ? filtreStatut : filtreCollection;
    var actif = (courant === valeur) ? ' active' : '';
    var fn = (type === 'statut') ? 'filtrerParStatut' : 'filtrerParCollection';
    return '<button type="button" class="filter-btn' + actif + '" onclick="' + fn + '(\'' + jsAttr(valeur) + '\')">'
        + escapeHtml(libelle) + ' (' + compte + ')</button>';
}

function filtrerParStatut(valeur) {
    filtreStatut = valeur;
    render();
}

function filtrerParCollection(valeur) {
    filtreCollection = valeur;
    render();
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

function getAchatsFiltres(terme) {
    return achats.filter(function(achat) {
        if (filtreStatut === 'attendus') {
            if (!estAttendu(achat)) return false;
        } else if (filtreStatut === 'retard') {
            if (!estEnRetard(achat)) return false;
        } else if (filtreStatut === 'revendre') {
            if (!achat.aRevendre) return false;
        } else if (filtreStatut === 'apayer') {
            if (!estAPayer(achat)) return false;
        } else if (filtreStatut !== 'tous') {
            if (achat.statut !== filtreStatut) return false;
        }
        if (filtreCollection !== 'toutes') {
            if ((achat.collection || 'Sans collection') !== filtreCollection) return false;
        }
        if (!terme) return true;
        var texte = ((achat.article || '') + ' ' + (achat.collection || '') + ' '
                   + (achat.vendeur || '') + ' ' + (achat.notes || '') + ' '
                   + (achat.suivi || '') + ' ' + (achat.modePaiement || '')).toLowerCase();
        return texte.indexOf(terme) !== -1;
    });
}

// ------------------------------------------------------------
// 8. Tri
// ------------------------------------------------------------
function valeurDeTri(achat, cle) {
    switch (cle) {
        case 'statut':       return getStatutIndex(achat.statut);
        case 'article':      return (achat.article || '').toLowerCase();
        case 'collection':   return (achat.collection || '').toLowerCase();
        case 'quantite':     return Number(achat.quantite) || 0;
        case 'total':        return totalLigne(achat);
        case 'vendeur':      return (achat.vendeur || '').toLowerCase();
        case 'dateCommande': var d = toDate(achat.dateCommande); return d ? d.getTime() : 0;
        default:             return 0;
    }
}

function trierPar(cle) {
    if (tri.cle === cle) {
        tri.sens = -tri.sens;
    } else {
        tri.cle = cle;
        // Dates et montants : le plus récent / le plus gros d'abord.
        tri.sens = (cle === 'dateCommande' || cle === 'total' || cle === 'quantite') ? -1 : 1;
    }
    render();
}

function celluleEntete(cle, libelleHtml, titre) {
    var fleche = '';
    if (tri.cle === cle) {
        fleche = ' <i class="fa-solid fa-caret-' + (tri.sens === 1 ? 'up' : 'down') + '"></i>';
    }
    return '<th class="th-sort" onclick="trierPar(\'' + cle + '\')" title="Trier par ' + escapeAttr(titre) + '">'
        + libelleHtml + fleche + '</th>';
}

// ------------------------------------------------------------
// 9. Rendu
// ------------------------------------------------------------
function render() {
    renderStats();
    renderFiltres();
    if (filtreStatut === 'doublons') {
        renderTableDoublons();
    } else {
        renderTableAchats();
    }
}

function renderTableAchats() {
    var liste = document.getElementById('achats-list');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!liste) return;

    var terme = termeRecherche();
    var lignes = getAchatsFiltres(terme);

    lignes.sort(function(a, b) {
        var va = valeurDeTri(a, tri.cle);
        var vb = valeurDeTri(b, tri.cle);
        if (va < vb) return -tri.sens;
        if (va > vb) return tri.sens;
        var da = toDate(a.createdAt), db2 = toDate(b.createdAt);
        return (db2 ? db2.getTime() : 0) - (da ? da.getTime() : 0);
    });

    var totalAffiche = 0;
    lignes.forEach(function(achat) {
        if (achat.statut !== 'annule') totalAffiche += totalLigne(achat);
    });

    if (compteur) {
        compteur.textContent = lignes.length + ' ligne' + (lignes.length > 1 ? 's' : '')
            + ' — ' + formatEuro(totalAffiche);
    }

    if (lignes.length === 0) {
        liste.innerHTML = '';
        if (vide) {
            vide.style.display = premierChargement ? 'none' : 'block';
            var message = document.getElementById('empty-message');
            if (message) message.textContent = achats.length
                ? 'Aucune ligne dans ce filtre'
                : 'Rien encore. Ajoutez votre premier achat.';
        }
        return;
    }
    if (vide) vide.style.display = 'none';

    var presentes = clesEnCollection();

    liste.innerHTML = '<table class="data-table"><thead><tr>'
        + celluleEntete('statut', 'Statut', 'statut')
        + '<th>Article</th>'
        + celluleEntete('collection', 'Collection', 'collection')
        + celluleEntete('quantite', 'Qté', 'quantité')
        + celluleEntete('total', 'Total', 'montant de la ligne')
        + celluleEntete('vendeur', 'Vendeur', 'vendeur')
        + celluleEntete('dateCommande', 'Commandé', 'date de commande')
        + '<th></th>'
        + '</tr></thead><tbody>'
        + lignes.map(function(achat) { return renderLigne(achat, presentes); }).join('')
        + '</tbody></table>';
}

function renderLigne(achat, presentes) {
    var statutDef = getStatutDef(achat.statut);
    var terne = (achat.statut === 'annule');
    var idAttr = jsAttr(achat.id);

    var optionsStatut = STATUTS.map(function(s) {
        return '<option value="' + s.value + '"' + (s.value === achat.statut ? ' selected' : '') + '>'
            + escapeHtml(s.label) + '</option>';
    }).join('');

    // --- Badges de l'article ---
    var badges = '';
    if (estEnRetard(achat)) {
        var jours = joursDepuis(achat.dateCommande);
        badges += '<span class="badge badge-retard" title="Commandé il y a ' + jours + ' jours et toujours pas reçu">'
            + '<i class="fa-solid fa-clock"></i>' + jours + ' j — à relancer</span>';
    }
    // Signalé AVANT réception : c'est là qu'on peut encore annuler.
    if (estAttendu(achat)) {
        var dejaPossede = presentes[cleDe(achat)] || 0;
        if (dejaPossede > 0) {
            badges += '<span class="badge badge-deja" title="Vous en avez déjà ' + dejaPossede
                + ' exemplaire(s) reçu(s) — celui-ci fera un doublon">'
                + '<i class="fa-solid fa-triangle-exclamation"></i>déjà ' + dejaPossede + ' en collection</span>';
        }
    }
    if (achat.aRevendre) {
        badges += '<span class="badge badge-revendre"><i class="fa-solid fa-tag"></i>à revendre</span>';
    }

    // --- Cellule montant ---
    var quantite = Number(achat.quantite) || 0;
    var prixUnitaire = Number(achat.prixUnitaire) || 0;
    var port = Number(achat.fraisPort) || 0;
    var detailMontant = quantite + ' × ' + formatEuro(prixUnitaire)
        + (port ? ' + ' + formatEuro(port) + ' de port' : ' — sans frais de port');

    // Le paiement se lit sous le montant plutôt que dans une colonne à
    // lui : c'est la même information, et le tableau a déjà huit colonnes.
    var sousMontant = '';
    if (achat.statut !== 'annule') {
        if (estAPayer(achat)) {
            sousMontant = '<span class="cell-sous cell-sous--impaye">à payer</span>';
            detailMontant += ' — pas encore réglé';
        } else if (achat.modePaiement) {
            sousMontant = '<span class="cell-sous">' + escapeHtml(achat.modePaiement) + '</span>';
            detailMontant += ' — réglé par ' + achat.modePaiement;
        } else {
            detailMontant += ' — réglé';
        }
    }

    // --- Cellule date ---
    var infoDate = 'Commandé le ' + formatDateFr(achat.dateCommande);
    var suffixeDate = '';
    if (achat.statut === 'recu' && achat.dateReception) {
        infoDate += ' — reçu le ' + formatDateFr(achat.dateReception);
        suffixeDate = '<span class="cell-sous">reçu le ' + escapeHtml(formatDateFr(achat.dateReception)) + '</span>';
    } else if (estAttendu(achat)) {
        var age = joursDepuis(achat.dateCommande);
        if (age !== null) suffixeDate = '<span class="cell-sous">il y a ' + age + ' j</span>';
    }

    return '<tr class="' + (terne ? 'ligne--terne' : '') + '" onclick="ouvrirModale(\'' + idAttr + '\')">'
        + '<td class="cell-statut">'
        +   '<select class="statut-select" style="border-color:' + statutDef.color + ';color:' + statutDef.color + '" '
        +   'onclick="event.stopPropagation()" onchange="changerStatut(\'' + idAttr + '\', this.value)" title="Changer le statut">'
        +   optionsStatut + '</select>'
        + '</td>'
        + '<td class="cell-principale">'
        +   '<div class="cell-titre">' + escapeHtml(achat.article || '(sans nom)') + '</div>'
        +   (badges ? '<div class="cell-badges">' + badges + '</div>' : '')
        +   (achat.notes ? '<div class="cell-note">' + escapeHtml(achat.notes) + '</div>' : '')
        + '</td>'
        + '<td>' + (achat.collection ? '<span class="badge badge-collection"><i class="fa-solid fa-layer-group"></i>' + escapeHtml(achat.collection) + '</span>' : '') + '</td>'
        + '<td class="cell-num">' + quantite + '</td>'
        + '<td class="cell-montant" title="' + escapeAttr(detailMontant) + '">'
        +   escapeHtml(formatEuro(totalLigne(achat))) + sousMontant
        + '</td>'
        + '<td class="cell-vendeur">' + escapeHtml(achat.vendeur || '') + '</td>'
        + '<td class="cell-date" title="' + escapeAttr(infoDate) + '">'
        +   escapeHtml(formatDateFr(achat.dateCommande)) + suffixeDate
        + '</td>'
        + '<td class="row-actions-cell">'
        +   boutonPaiement(achat, idAttr)
        +   '<button type="button" class="icon-btn" title="Modifier" onclick="event.stopPropagation();ouvrirModale(\'' + idAttr + '\')">'
        +   '<i class="fa-solid fa-pen"></i></button>'
        + '</td>'
        + '</tr>';
}

// Bascule payé / non payé en un clic depuis le tableau. Sans ça, régler
// une ligne demanderait d'ouvrir la modale, et les achats déjà saisis
// avant l'arrivée du champ resteraient marqués « à payer » par lassitude.
function boutonPaiement(achat, idAttr) {
    if (achat.statut === 'annule') return '';
    var paye = !!achat.paye;
    var titre = paye
        ? 'Réglé' + (achat.modePaiement ? ' par ' + achat.modePaiement : '') + ' — cliquer pour annuler'
        : 'Marquer comme payé';
    return '<button type="button" class="icon-btn' + (paye ? ' icon-btn--paye' : '') + '" '
        + 'title="' + escapeAttr(titre) + '" '
        + 'onclick="event.stopPropagation();basculerPaiement(\'' + idAttr + '\')">'
        + '<i class="fa-solid fa-' + (paye ? 'check' : 'euro-sign') + '"></i></button>';
}

// Vue agrégée : ici une ligne = un ARTICLE possédé en plusieurs
// exemplaires, pas un achat. C'est la seule vue qui change de grain,
// parce que la question « qu'est-ce que je peux revendre ? » se pose
// par article, jamais par ligne de commande.
function renderTableDoublons() {
    var liste = document.getElementById('achats-list');
    var vide = document.getElementById('empty-state');
    var compteur = document.getElementById('result-count');
    if (!liste) return;

    var terme = termeRecherche();
    var doublons = calculerDoublons().filter(function(groupe) {
        if (filtreCollection !== 'toutes' && (groupe.collection || 'Sans collection') !== filtreCollection) return false;
        if (!terme) return true;
        return (groupe.libelle + ' ' + groupe.collection).toLowerCase().indexOf(terme) !== -1;
    });

    var valeurTotale = 0;
    doublons.forEach(function(groupe) { valeurTotale += groupe.valeurSurplus; });

    if (compteur) {
        compteur.textContent = doublons.length + ' article' + (doublons.length > 1 ? 's' : '')
            + ' en plusieurs exemplaires — ~' + formatEuro(valeurTotale) + ' revendables';
    }

    if (doublons.length === 0) {
        liste.innerHTML = '';
        if (vide) {
            vide.style.display = premierChargement ? 'none' : 'block';
            var message = document.getElementById('empty-message');
            if (message) message.textContent = 'Aucun doublon — chaque article reçu est unique.';
        }
        return;
    }
    if (vide) vide.style.display = 'none';

    liste.innerHTML = '<table class="data-table"><thead><tr>'
        + '<th>Article</th><th>Collection</th><th>Exemplaires</th><th>En trop</th>'
        + '<th>Prix moyen payé</th><th>Valeur du surplus</th><th>Achats</th>'
        + '</tr></thead><tbody>'
        + doublons.map(renderLigneDoublon).join('')
        + '</tbody></table>';
}

function renderLigneDoublon(groupe) {
    var detailLignes = groupe.lignes.map(function(achat) {
        return (Number(achat.quantite) || 0) + ' × ' + formatEuro(achat.prixUnitaire)
            + ' — ' + (achat.vendeur || 'vendeur inconnu') + ' — ' + formatDateFr(achat.dateCommande);
    }).join('\n');

    return '<tr onclick="chercherArticle(\'' + jsAttr(groupe.libelle) + '\')" title="Voir les achats de cet article">'
        + '<td class="cell-principale"><div class="cell-titre">' + escapeHtml(groupe.libelle) + '</div></td>'
        + '<td>' + (groupe.collection ? '<span class="badge badge-collection"><i class="fa-solid fa-layer-group"></i>' + escapeHtml(groupe.collection) + '</span>' : '') + '</td>'
        + '<td class="cell-num">' + groupe.exemplaires + '</td>'
        + '<td class="cell-num"><span class="badge badge-revendre">+' + groupe.surplus + '</span></td>'
        + '<td class="cell-montant">' + escapeHtml(formatEuro(groupe.prixMoyen)) + '</td>'
        + '<td class="cell-montant">~' + escapeHtml(formatEuro(groupe.valeurSurplus)) + '</td>'
        + '<td class="cell-info" title="' + escapeAttr(detailLignes) + '">'
        +   groupe.lignes.length + ' achat' + (groupe.lignes.length > 1 ? 's' : '')
        + '</td>'
        + '</tr>';
}

// Depuis la vue doublons, retomber sur les lignes d'achat de l'article.
function chercherArticle(libelle) {
    var input = document.getElementById('search-input');
    if (input) input.value = libelle;
    filtreStatut = 'tous';
    render();
}

// ------------------------------------------------------------
// 10. Dates <input type="date"> ↔ Timestamp Firestore
// ------------------------------------------------------------
// Midi local, et pas minuit : « 2026-07-29 » seul est interprété comme
// minuit UTC, ce qui affiche la veille dans tout fuseau à l'ouest de
// Greenwich. Midi laisse douze heures de marge des deux côtés.
function dateDepuisInput(valeur) {
    if (!valeur) return null;
    var date = new Date(valeur + 'T12:00:00');
    return isNaN(date.getTime()) ? null : firebase.firestore.Timestamp.fromDate(date);
}

function inputDepuisDate(valeur) {
    var date = toDate(valeur);
    if (!date) return '';
    var mois = String(date.getMonth() + 1);
    var jour = String(date.getDate());
    return date.getFullYear()
        + '-' + (mois.length < 2 ? '0' + mois : mois)
        + '-' + (jour.length < 2 ? '0' + jour : jour);
}

function aujourdhuiInput() {
    return inputDepuisDate(new Date());
}

// ------------------------------------------------------------
// 11. Modale
// ------------------------------------------------------------
function trouverAchat(id) {
    for (var i = 0; i < achats.length; i++) {
        if (achats[i].id === id) return achats[i];
    }
    return null;
}

// Les suggestions de collections et de vendeurs sortent des données
// déjà saisies : rien à maintenir en dur, et la liste colle au vrai
// usage dès le troisième achat.
function remplirSuggestions() {
    remplirDatalist('collection-list', 'collection');
    remplirDatalist('vendeur-list', 'vendeur');
    remplirDatalist('paiement-list', 'modePaiement');
}

function remplirDatalist(idDatalist, champ) {
    var cible = document.getElementById(idDatalist);
    if (!cible) return;
    var vus = {};
    achats.forEach(function(achat) {
        var valeur = (achat[champ] || '').trim();
        if (valeur) vus[valeur] = true;
    });
    cible.innerHTML = Object.keys(vus).sort().map(function(valeur) {
        return '<option value="' + escapeAttr(valeur) + '"></option>';
    }).join('');
}

function ouvrirModale(id) {
    idEnEdition = id || null;
    var achat = id ? trouverAchat(id) : null;
    remplirSuggestions();

    document.getElementById('modal-title').textContent = achat ? 'Modifier l\'achat' : 'Nouvel achat';
    document.getElementById('f-article').value      = achat ? (achat.article || '') : '';
    document.getElementById('f-collection').value   = achat ? (achat.collection || '') : '';
    document.getElementById('f-statut').value       = achat ? (achat.statut || 'commande') : 'commande';
    document.getElementById('f-quantite').value     = achat ? (achat.quantite || 1) : 1;
    document.getElementById('f-prix').value         = achat && achat.prixUnitaire ? String(achat.prixUnitaire).replace('.', ',') : '';
    document.getElementById('f-port').value         = achat && achat.fraisPort ? String(achat.fraisPort).replace('.', ',') : '';
    document.getElementById('f-vendeur').value      = achat ? (achat.vendeur || '') : '';
    document.getElementById('f-suivi').value        = achat ? (achat.suivi || '') : '';
    document.getElementById('f-notes').value        = achat ? (achat.notes || '') : '';
    document.getElementById('f-revendre').checked   = achat ? !!achat.aRevendre : false;
    document.getElementById('f-paiement').value     = achat ? (achat.modePaiement || '') : '';
    document.getElementById('f-paye').checked       = achat ? !!achat.paye : false;
    // Un achat se saisit le jour où il est passé, neuf fois sur dix.
    document.getElementById('f-date-commande').value  = achat ? inputDepuisDate(achat.dateCommande) : aujourdhuiInput();
    document.getElementById('f-date-reception').value = achat ? inputDepuisDate(achat.dateReception) : '';

    var meta = document.getElementById('f-meta');
    if (achat) {
        meta.textContent = 'Saisi le ' + formatDateFr(achat.createdAt)
            + (achat.updatedAt ? ' — dernière modification le ' + formatDateFr(achat.updatedAt) : '');
        meta.style.display = 'block';
    } else {
        meta.style.display = 'none';
    }

    document.getElementById('btn-delete').style.display = achat ? '' : 'none';
    document.getElementById('modal-overlay').style.display = 'flex';
    verifierDoublonSaisie();
    document.getElementById('f-article').focus();
}

function fermerModale() {
    document.getElementById('modal-overlay').style.display = 'none';
    idEnEdition = null;
}

// Avertissement pendant la frappe : le moment où l'information sert,
// c'est avant de valider une commande, pas après.
function verifierDoublonSaisie() {
    var bloc = document.getElementById('f-doublon-alerte');
    if (!bloc) return;
    var cle = cleArticle(document.getElementById('f-article').value);
    if (!cle) { bloc.style.display = 'none'; return; }

    var exemplaires = 0, enRoute = 0;
    achats.forEach(function(achat) {
        if (achat.id === idEnEdition) return;
        if (cleDe(achat) !== cle) return;
        if (achat.statut === 'recu') exemplaires += (Number(achat.quantite) || 0);
        else if (estAttendu(achat)) enRoute += (Number(achat.quantite) || 0);
    });

    if (!exemplaires && !enRoute) { bloc.style.display = 'none'; return; }

    var morceaux = [];
    if (exemplaires) morceaux.push(exemplaires + ' exemplaire' + (exemplaires > 1 ? 's' : '') + ' déjà reçu' + (exemplaires > 1 ? 's' : ''));
    if (enRoute) morceaux.push(enRoute + ' déjà en route');
    bloc.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Vous avez ' + escapeHtml(morceaux.join(' et ')) + '.';
    bloc.style.display = 'block';
}

function sauverAchat() {
    var article = document.getElementById('f-article').value.trim();
    if (!article) {
        showToast('Le nom de l\'article est obligatoire.', 'error');
        document.getElementById('f-article').focus();
        return;
    }

    var quantite = parseInt(document.getElementById('f-quantite').value, 10);
    if (!quantite || quantite < 1) quantite = 1;

    var statut = document.getElementById('f-statut').value;
    var dateReception = dateDepuisInput(document.getElementById('f-date-reception').value);
    // Marquer « reçu » sans date de réception est le cas courant : on la
    // déduit du jour même plutôt que de laisser un trou dans l'historique.
    if (statut === 'recu' && !dateReception) {
        dateReception = firebase.firestore.Timestamp.fromDate(new Date());
    }

    var donnees = {
        article:      article,
        cle:          cleArticle(article),
        collection:   document.getElementById('f-collection').value.trim(),
        statut:       statut,
        quantite:     quantite,
        prixUnitaire: nombre(document.getElementById('f-prix').value),
        fraisPort:    nombre(document.getElementById('f-port').value),
        vendeur:      document.getElementById('f-vendeur').value.trim(),
        suivi:        document.getElementById('f-suivi').value.trim(),
        notes:        document.getElementById('f-notes').value.trim(),
        aRevendre:    document.getElementById('f-revendre').checked,
        modePaiement: document.getElementById('f-paiement').value.trim(),
        paye:         document.getElementById('f-paye').checked,
        dateCommande:  dateDepuisInput(document.getElementById('f-date-commande').value),
        dateReception: dateReception,
        updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    };

    var operation;
    if (idEnEdition) {
        operation = db.collection('achats').doc(idEnEdition).update(donnees);
    } else {
        donnees.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        operation = db.collection('achats').add(donnees);
    }

    operation
        .then(function() {
            showToast(idEnEdition ? 'Achat mis à jour.' : 'Achat ajouté.', 'success');
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Enregistrement impossible : ' + erreur.message, 'error');
        });
}

function changerStatut(id, nouveauStatut) {
    var achat = trouverAchat(id);
    var donnees = {
        statut: nouveauStatut,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Passer un colis en « reçu » depuis le tableau, c'est le geste du
    // jour où il arrive : la date se pose toute seule.
    if (nouveauStatut === 'recu' && achat && !achat.dateReception) {
        donnees.dateReception = firebase.firestore.Timestamp.fromDate(new Date());
    }
    db.collection('achats').doc(id).update(donnees).catch(function(erreur) {
        console.error(erreur);
        showToast('Changement de statut impossible : ' + erreur.message, 'error');
    });
}

function basculerPaiement(id) {
    var achat = trouverAchat(id);
    if (!achat) return;
    db.collection('achats').doc(id).update({
        paye: !achat.paye,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function(erreur) {
        console.error(erreur);
        showToast('Changement de paiement impossible : ' + erreur.message, 'error');
    });
}

// ------------------------------------------------------------
// 12. Suppression
// ------------------------------------------------------------
function ouvrirModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'flex';
}

function fermerModaleSuppression() {
    document.getElementById('delete-overlay').style.display = 'none';
}

function confirmerSuppression() {
    if (!idEnEdition) return;
    db.collection('achats').doc(idEnEdition).delete()
        .then(function() {
            showToast('Achat supprimé.', 'success');
            fermerModaleSuppression();
            fermerModale();
        })
        .catch(function(erreur) {
            console.error(erreur);
            showToast('Suppression impossible : ' + erreur.message, 'error');
        });
}

// ------------------------------------------------------------
// 13. Export JSON (le filet de sauvegarde)
// ------------------------------------------------------------
// Firestore sur le plan gratuit n'offre ni sauvegarde automatique ni
// restauration a un instant T. Ce bouton est la seule protection contre
// une suppression malencontreuse : il exporte TOUT, filtres ignores,
// une sauvegarde partielle etant un faux filet.
function exporterJson() {
    if (!achats.length) {
        showToast('Aucun achat à exporter.', 'error');
        return;
    }

    var triees = achats.slice().sort(function(a, b) {
        var da = toDate(a.dateCommande), db2 = toDate(b.dateCommande);
        return (da ? da.getTime() : 0) - (db2 ? db2.getTime() : 0);
    });

    var contenu = {
        exporte_le: new Date().toISOString(),
        source: window.location.hostname + ' — collection Firestore « achats »',
        nombre: triees.length,
        achats: triees.map(function(achat) {
            var iso = function(valeur) { var d = toDate(valeur); return d ? d.toISOString() : null; };
            return {
                id:            achat.id,
                article:       achat.article || '',
                collection:    achat.collection || '',
                statut:        achat.statut || '',
                quantite:      Number(achat.quantite) || 0,
                prixUnitaire:  Number(achat.prixUnitaire) || 0,
                fraisPort:     Number(achat.fraisPort) || 0,
                total:         totalLigne(achat),
                vendeur:       achat.vendeur || '',
                suivi:         achat.suivi || '',
                notes:         achat.notes || '',
                aRevendre:     !!achat.aRevendre,
                paye:          !!achat.paye,
                modePaiement:  achat.modePaiement || '',
                // Horodatages en ISO : un Timestamp Firestore brut ne
                // survit pas a JSON.stringify de facon lisible.
                dateCommande:  iso(achat.dateCommande),
                dateReception: iso(achat.dateReception),
                createdAt:     iso(achat.createdAt),
                updatedAt:     iso(achat.updatedAt)
            };
        })
    };

    var blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var lien = document.createElement('a');
    lien.href = url;
    lien.download = 'achats-collections-' + new Date().toISOString().slice(0, 10) + '.json';
    lien.click();
    URL.revokeObjectURL(url);

    showToast(triees.length + ' ligne' + (triees.length > 1 ? 's' : '') + ' exportée' + (triees.length > 1 ? 's' : '') + '.', 'success');
}

// ------------------------------------------------------------
// 14. Raccourcis clavier
// ------------------------------------------------------------
document.addEventListener('keydown', function(evenement) {
    if (evenement.key !== 'Escape') return;
    if (document.getElementById('delete-overlay').style.display === 'flex') {
        fermerModaleSuppression();
    } else if (document.getElementById('modal-overlay').style.display === 'flex') {
        fermerModale();
    }
});
