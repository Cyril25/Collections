// ============================================================
// auth.js — Le vigile de collections.ofildudoubs.fr
// ============================================================
// Adapté de celui du hub admin, dont il partage la collection
// « membres » : MEME projet Firebase, MEME annuaire, MEMES slugs de
// droits. Ce site ne gère donc aucun droit lui-même — il lit la fiche
// de la personne connectée et obéit.
//
// Sur chaque page :
//   1. init Firebase
//   2. pas connecté           → redirection vers login
//   3. connecté               → lecture de sa fiche dans « membres »
//   4. pas membre / inactif   → déconnexion immédiate
//   5. membre                 → en-tête filtrée par ses droits, garde
//                               de la page, puis affichage
//
// ⚠ CE QUE CE FICHIER NE FAIT PAS : cacher des pages. Le site est
// statique et le dépôt public — n'importe qui peut télécharger
// « comptes.html ». Ce code masque des liens et vide des écrans, ce qui
// est du confort d'interface. Ce qui protège vraiment, ce sont les
// règles Firestore : sans droit, la page s'affiche mais ne contient
// aucune donnée.
//
// DIFFÉRENCES ASSUMÉES AVEC LE HUB :
//   - pas de page Membres ici : les accès se donnent dans le hub, à un
//     seul endroit. Ce site ne fait que consommer l'annuaire.
//   - l'impersonation se déclenche depuis un sélecteur de l'en-tête,
//     puisqu'il n'y a pas de page Membres pour l'amorcer.
//   - site à plat : pas de data-racine, tout est à la racine.
// ============================================================

var HUB_CONFIG_OK = (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey.indexOf('A_REMPLACER') === -1);

// État global, rempli par le vigile puis lu par les pages.
window.HUB = {
    user: null,          // compte Firebase connecté
    membre: null,        // sa fiche réelle
    effectif: null,      // la fiche « vue » (= membre, sauf impersonation)
    impersonation: ''    // email impersonné, '' sinon
};

// ------------------------------------------------------------
// 1. Initialisation Firebase
// ------------------------------------------------------------
if (typeof firebase === 'undefined') {
    console.error('ERREUR : le SDK Firebase n\'est pas chargé avant auth.js.');
} else if (!HUB_CONFIG_OK) {
    console.warn('Firebase non configuré — voir config.js.');
} else if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}

// ------------------------------------------------------------
// 2. Utilitaires
// ------------------------------------------------------------
function estPageLogin() {
    var page = window.location.pathname.split('/').pop();
    return (page === 'login.html' || page === 'login');
}

function pageCourante() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

function normaliserEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function escapeHtml(texte) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(texte == null ? '' : texte));
    return div.innerHTML;
}

// Échappement pour un attribut, en local : escapeAttr() vit dans
// hub-utils.js, chargé APRÈS ce fichier et absent de login.html. En
// dépendre ici serait un piège pour la prochaine page ajoutée.
function escapeValeurAttribut(texte) {
    return String(texte == null ? '' : texte)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);
    if (type === 'error') {
        toast.onclick = function() { toast.remove(); };
    } else {
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
    }
}

// ------------------------------------------------------------
// 3. Droits
// ------------------------------------------------------------
// Rôle RÉEL : ce que Firestore autorisera effectivement. L'impersonation
// ne le change jamais — elle ne modifie que l'affichage.
function estSuperadminReel() {
    if (!HUB.user) return false;
    if (normaliserEmail(HUB.user.email) === normaliserEmail(SUPERADMIN_EMAIL)) return true;
    return !!(HUB.membre && HUB.membre.role === 'superadmin');
}

// Rôle VU à l'écran : c'est lui qui pilote le menu et les gardes, pour
// que l'impersonation montre vraiment ce que l'autre personne voit.
function estSuperadmin() {
    return !!(HUB.effectif && HUB.effectif.role === 'superadmin');
}

function aAcces(slug) {
    if (!HUB.effectif) return false;
    if (HUB.effectif.role === 'superadmin') return true;
    var liste = HUB.effectif.projets || [];
    return liste.indexOf(slug) !== -1;
}

function projetsVisibles() {
    return PROJETS.filter(function(p) { return aAcces(p.slug); });
}

window.estSuperadminReel = estSuperadminReel;
window.estSuperadmin = estSuperadmin;
window.aAcces = aAcces;
window.projetsVisibles = projetsVisibles;

// ------------------------------------------------------------
// 4. Impersonation
// ------------------------------------------------------------
// Volontairement en sessionStorage : ça meurt avec l'onglet, on ne
// risque pas de « rester » quelqu'un d'autre pendant des jours.
//
// ⚠ C'est un aperçu d'interface, PAS un bac à sable. Les requêtes
// partent toujours avec le jeton du superadmin : Firestore continue de
// tout autoriser. On voit ce que l'autre verrait, on ne subit pas ses
// restrictions — donc ça ne sert pas à tester les règles. Pour ça,
// utiliser le Rules Playground de la console Firebase.
//
// À noter : le sessionStorage est cloisonné par origine. Impersonner
// quelqu'un sur admin.ofildudoubs.fr ne le fait PAS ici, et
// réciproquement. C'est pour ça que ce site a son propre sélecteur.
function demarrerImpersonation(email) {
    if (!estSuperadminReel()) return;
    sessionStorage.setItem('hubImpersonation', normaliserEmail(email));
    window.location.href = 'index.html';
}

function arreterImpersonation() {
    sessionStorage.removeItem('hubImpersonation');
    window.location.reload();
}

function changerVue(email) {
    if (!email) {
        arreterImpersonation();
        return;
    }
    demarrerImpersonation(email);
}

window.demarrerImpersonation = demarrerImpersonation;
window.arreterImpersonation = arreterImpersonation;
window.changerVue = changerVue;

function injecterBandeauImpersonation() {
    if (!HUB.impersonation) return;
    var barre = document.createElement('div');
    barre.className = 'impersonation-bar';
    barre.innerHTML =
        '<span><i class="fa-solid fa-mask"></i> Vue de <strong>' + escapeHtml(HUB.impersonation) + '</strong>'
        + ' — affichage seulement, vos droits réels restent inchangés</span>'
        + '<button type="button" onclick="arreterImpersonation()">Revenir à moi</button>';
    document.body.insertBefore(barre, document.body.firstChild);
}

// Le sélecteur se remplit APRÈS l'en-tête : la liste des membres demande
// une lecture Firestore, et l'en-tête ne doit pas l'attendre pour
// s'afficher. Réservé au superadmin réel — les règles refuseraient de
// toute façon la lecture de l'annuaire à quelqu'un d'autre.
function remplirSelecteurVue() {
    var select = document.getElementById('hub-vue');
    if (!select || !estSuperadminReel()) return;

    firebase.firestore().collection('membres').get().then(function(snapshot) {
        var moi = normaliserEmail(HUB.user.email);
        var options = ['<option value="">Ma vue</option>'];
        snapshot.forEach(function(doc) {
            if (doc.id === moi) return;
            var fiche = doc.data();
            var droits = (fiche.role === 'superadmin')
                ? 'tout'
                : nombreDeDroits(fiche) + ' accès';
            options.push('<option value="' + escapeValeurAttribut(doc.id) + '"'
                + (doc.id === HUB.impersonation ? ' selected' : '') + '>'
                + escapeHtml((fiche.nom || doc.id) + ' — ' + droits) + '</option>');
        });
        // Personne d'autre dans l'annuaire : un sélecteur à une seule
        // entrée n'apprend rien, on le retire.
        if (options.length === 1) {
            select.style.display = 'none';
            return;
        }
        select.innerHTML = options.join('');
        select.style.display = '';
    }).catch(function(erreur) {
        console.warn('Liste des membres illisible :', erreur.message);
        select.style.display = 'none';
    });
}

// Compte les droits qui concernent CE site, pas ceux du hub : c'est la
// seule information utile ici.
function nombreDeDroits(fiche) {
    var liste = fiche.projets || [];
    var total = 0;
    PROJETS.forEach(function(p) {
        if (liste.indexOf(p.slug) !== -1) total++;
    });
    return total;
}

// ------------------------------------------------------------
// 5. En-tête
// ------------------------------------------------------------
function injecterHeader() {
    var cible = document.getElementById('header-placeholder');
    if (!cible) return;

    var projetCourant = (document.body && document.body.getAttribute('data-projet')) || '';

    var liens = projetsVisibles().map(function(p) {
        var actif = (p.slug === projetCourant) ? ' class="active"' : '';
        return '<a href="' + p.url + '"' + actif + '><i class="' + p.icone + '"></i> ' + escapeHtml(p.nom) + '</a>';
    }).join('');

    var nom = (HUB.effectif && HUB.effectif.nom) ? HUB.effectif.nom : (HUB.user ? HUB.user.email : '');

    // Le sélecteur de vue n'existe que pour le superadmin réel, et reste
    // masqué jusqu'à ce que la liste des membres arrive.
    var selecteur = estSuperadminReel()
        ? '<select class="hub-vue" id="hub-vue" style="display:none" onchange="changerVue(this.value)" '
          + 'title="Afficher le site tel que le voit cette personne"></select>'
        : '';

    cible.innerHTML =
        '<header class="hub-header">' +
            '<a class="hub-brand" href="index.html"><i class="' + SITE_ICON + '"></i> <span>' + escapeHtml(SITE_TITLE) + '</span></a>' +
            '<nav class="hub-nav">' + liens + '</nav>' +
            '<div class="hub-user">' +
                selecteur +
                '<span class="hub-user-email">' + escapeHtml(nom) + '</span>' +
                '<button type="button" class="hub-logout" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>' +
            '</div>' +
        '</header>';

    remplirSelecteurVue();
}

// ------------------------------------------------------------
// 6. Lecture de la fiche membre
// ------------------------------------------------------------
function lireMembre(email) {
    return firebase.firestore().collection('membres').doc(normaliserEmail(email)).get()
        .then(function(doc) {
            if (!doc.exists) return null;
            var data = doc.data();
            data.email = doc.id;
            return data;
        });
}

// Le propriétaire doit pouvoir entrer même si sa fiche n'existe pas
// encore. On lui en fabrique une en mémoire ; c'est la page Membres du
// hub qui proposera de la créer pour de bon.
function ficheDeSecours(email) {
    return { email: normaliserEmail(email), nom: 'Propriétaire', role: 'superadmin', projets: [], actif: true, _virtuelle: true };
}

// ------------------------------------------------------------
// 7. Le vigile
// ------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function() {
    if (typeof firebase === 'undefined') return;

    if (!HUB_CONFIG_OK) {
        if (estPageLogin()) {
            var avertissement = document.getElementById('config-warning');
            if (avertissement) avertissement.style.display = 'block';
            var bouton = document.getElementById('btn-google-login');
            if (bouton) bouton.disabled = true;
        } else {
            window.location.href = 'login.html';
        }
        return;
    }

    firebase.auth().onAuthStateChanged(function(user) {
        var surLogin = estPageLogin();

        if (!user) {
            if (!surLogin) {
                window.location.href = 'login.html';
                return;
            }
            afficherErreurLogin();
            return;
        }

        HUB.user = user;
        var estProprietaire = (normaliserEmail(user.email) === normaliserEmail(SUPERADMIN_EMAIL));

        lireMembre(user.email)
            .then(function(fiche) {
                if (!fiche && estProprietaire) fiche = ficheDeSecours(user.email);

                // Ni fiche, ni propriétaire → dehors.
                if (!fiche) {
                    console.warn('Accès refusé : ' + user.email + ' n\'est pas membre.');
                    return refuser('unauthorized');
                }
                if (fiche.actif === false && !estProprietaire) {
                    console.warn('Accès refusé : compte désactivé (' + user.email + ').');
                    return refuser('disabled');
                }

                HUB.membre = fiche;

                // Impersonation : réservée au superadmin réel.
                var impersonne = sessionStorage.getItem('hubImpersonation') || '';
                if (impersonne && estSuperadminReel() && impersonne !== normaliserEmail(user.email)) {
                    return lireMembre(impersonne).then(function(autre) {
                        if (autre) {
                            HUB.impersonation = impersonne;
                            HUB.effectif = autre;
                        } else {
                            sessionStorage.removeItem('hubImpersonation');
                            HUB.effectif = fiche;
                        }
                        demarrerPage(surLogin);
                    });
                }
                sessionStorage.removeItem('hubImpersonation');
                HUB.effectif = fiche;
                demarrerPage(surLogin);
            })
            .catch(function(erreur) {
                console.error('Lecture de la fiche membre impossible :', erreur);
                afficherErreurTechnique(erreur);
            });
    });
});

function refuser(motif) {
    return firebase.auth().signOut().then(function() {
        window.location.href = 'login.html?error=' + motif;
    });
}

function demarrerPage(surLogin) {
    if (surLogin) {
        window.location.href = 'index.html';
        return;
    }

    // Garde de la page. Contrairement au hub, l'accueil de ce site EST
    // une page à droits (« achats ») : rediriger aveuglément vers
    // index.html bouclerait à l'infini pour qui n'y a pas accès. On
    // renvoie donc vers la première page permise, et s'il n'y en a
    // aucune, on l'explique au lieu de rediriger.
    var projet = (document.body && document.body.getAttribute('data-projet')) || '';
    if (projet && !aAcces(projet)) {
        var repli = projetsVisibles()[0];
        if (repli && repli.url !== pageCourante()) {
            window.location.href = repli.url;
            return;
        }
        injecterBandeauImpersonation();
        injecterHeader();
        afficherRefus(projet);
        return;
    }

    injecterBandeauImpersonation();
    injecterHeader();
    var contenu = document.getElementById('app-content');
    if (contenu) contenu.style.display = 'block';
    if (typeof onHubReady === 'function') onHubReady(HUB);
}

// Aucun accès sur ce site : on le dit, avec de quoi agir. Une page
// blanche laisserait croire à une panne.
function afficherRefus(projet) {
    var contenu = document.getElementById('app-content');
    if (!contenu) return;
    var def = (typeof getProjet === 'function') ? getProjet(projet) : null;
    var qui = HUB.impersonation
        ? escapeHtml(HUB.impersonation) + ' n\'a pas'
        : 'Vous n\'avez pas';
    contenu.style.display = 'block';
    contenu.innerHTML = '<div class="empty-state">'
        + '<i class="fa-solid fa-lock"></i>'
        + '<p><strong>' + qui + ' accès à cette page.</strong><br>'
        + escapeHtml(def ? def.nom : projet) + ' demande un droit qui se donne depuis la page '
        + 'Membres du hub.</p>'
        + (estSuperadminReel()
            ? '<p style="margin-top:20px"><a href="https://admin.ofildudoubs.fr/membres.html">Gérer les accès</a></p>'
            : '')
        + '</div>';
}

function afficherErreurTechnique(erreur) {
    var contenu = document.getElementById('app-content');
    if (!contenu) return;
    contenu.style.display = 'block';
    contenu.innerHTML = '<div class="error-block">'
        + '<i class="fa-solid fa-circle-exclamation"></i>'
        + '<strong>Connexion au serveur impossible.</strong><br>'
        + '<span style="color:var(--color-text-muted)">' + escapeHtml(erreur && erreur.message) + '</span>'
        + '</div>';
}

function afficherErreurLogin() {
    var params = new URLSearchParams(window.location.search);
    var motif = params.get('error');
    if (!motif) return;
    var bloc = document.getElementById('login-error');
    if (!bloc) return;
    bloc.textContent = (motif === 'disabled')
        ? 'Ce compte a été désactivé.'
        : 'Ce compte Google n\'a pas accès à ce site.';
    bloc.style.display = 'block';
}

// ------------------------------------------------------------
// 8. Connexion / déconnexion
// ------------------------------------------------------------
function loginWithGoogle() {
    if (typeof firebase === 'undefined' || !HUB_CONFIG_OK) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(function(erreur) {
        console.error(erreur);
        var bloc = document.getElementById('login-error');
        if (bloc) {
            bloc.textContent = 'Erreur de connexion : ' + erreur.message;
            bloc.style.display = 'block';
        }
    });
}

function logout() {
    if (typeof firebase === 'undefined') return;
    sessionStorage.removeItem('hubImpersonation');
    firebase.auth().signOut().then(function() {
        window.location.href = 'login.html';
    });
}
