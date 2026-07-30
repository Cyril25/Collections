// ============================================================
// test-acces.js — Droit d'entrée et impersonation
// ============================================================
// Charge auth.js et pages.js dans un DOM minimal simule.
//
// Lancer :  node tests/test-acces.js
//
// L'ACCES SE DONNE AU NIVEAU DU SITE, pas page par page : une seule case
// « Collections » dans membres.sites. Ce fichier protege trois choses :
//
// 1. LA COHERENCE DU SLUG entre trois fichiers de deux depots — SITE_SLUG
//    ici, le registre sites.js du hub, et aAccesSite() dans
//    firestore.rules. Un slug qui diverge donne un site ouvert a personne,
//    ou pire, ouvert a tous.
//
// 2. LE REFUS D'ENTREE. Un membre du hub sans la case Collections doit
//    etre renvoye au login avec l'explication, pas laisse devant un ecran
//    vide qu'il prendra pour une panne.
//
// 3. L'IMPERSONATION NE DONNE AUCUN DROIT REEL. estSuperadminReel() ne
//    doit jamais suivre la fiche impersonnee, sinon on pourrait se
//    « promouvoir » en regardant a travers les yeux d'un superadmin.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const ADMIN = path.join(RACINE, '..', 'Admin');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', textContent: '', className: '', style: {},
    attributs: {},
    getAttribute(nom) { return this.attributs[nom] || null; },
    setAttribute(nom, valeur) { this.attributs[nom] = valeur; },
    focus() {}, remove() {}, appendChild() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
}
const corps = fakeEl('body');
corps.insertBefore = function () {};
corps.firstChild = null;

let redirections = [];
let deconnexions = 0;

const document = {
  body: corps,
  addEventListener() {},
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  // escapeHtml() passe par createElement + createTextNode : un appendChild
  // inerte ferait rendre '' partout, et les tests d'affichage passeraient
  // sur du vide.
  createElement() {
    const el = fakeEl('cree');
    let texte = '';
    el.appendChild = (noeud) => { texte += noeud.data === undefined ? '' : noeud.data; };
    Object.defineProperty(el, 'innerHTML', {
      get() { return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      set(v) { texte = String(v); },
    });
    return el;
  },
  createTextNode(t) { return { data: String(t) }; },
};

const sessionStorage = {
  donnees: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.donnees, k) ? this.donnees[k] : null; },
  setItem(k, v) { this.donnees[k] = String(v); },
  removeItem(k) { delete this.donnees[k]; },
};

const emplacement = {
  pathname: '/index.html',
  search: '',
  get href() { return this._href || ''; },
  set href(v) { this._href = v; redirections.push(v); },
  reload() {},
};

const firebase = {
  apps: [{}],
  initializeApp() {},
  auth: () => ({
    onAuthStateChanged() {},
    signOut: () => { deconnexions++; return Promise.resolve(); },
  }),
  firestore: () => ({
    collection: () => ({
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
      get: () => Promise.resolve({ forEach() {} }),
    }),
  }),
};

const sandbox = {
  document, console, JSON, Date, Math, Number, String, Object, Array, Promise,
  setTimeout, clearTimeout, sessionStorage, firebase, URLSearchParams,
  location: emplacement,
};
vm.createContext(sandbox);
// Dans un navigateur, « window » EST l'objet global : « window.HUB = x »
// cree aussi le global HUB, dont auth.js se sert partout ensuite. Sans
// cette auto-reference le vm garderait les deux separes et le fichier
// planterait a la premiere lecture de HUB — alors qu'il marche en vrai.
sandbox.window = sandbox;

vm.runInContext(fs.readFileSync(path.join(RACINE, 'config.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'pages.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8'), sandbox);

const HUB = sandbox.HUB;
const PROPRIO = sandbox.SUPERADMIN_EMAIL;

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) { console.log('  ok   ' + nom); }
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

function situation(email, fiche, vue) {
  HUB.user = { email };
  HUB.membre = fiche;
  HUB.effectif = vue || fiche;
  HUB.impersonation = vue && vue !== fiche ? vue.email : '';
}

const ficheProprio = { email: PROPRIO, nom: 'Cyril', role: 'superadmin', projets: [], sites: [] };
const ficheAvecSite = { email: 'marie@gmail.com', nom: 'Marie', role: 'membre', projets: ['idees'], sites: ['collections', 'ofildudoubs'] };
const ficheSansSite = { email: 'paul@gmail.com', nom: 'Paul', role: 'membre', projets: ['idees', 'exterieur'], sites: ['ofildudoubs'] };
// Fiche d'avant l'existence du tableau `sites` : le champ manque tout
// court. Elle ne doit pas ouvrir l'acces par accident.
const ficheAncienne = { email: 'vieux@gmail.com', nom: 'Vieux', role: 'membre', projets: ['idees'] };

// --- 1. Le droit d'entrer ----------------------------------------
console.log('\n1. Le droit d\'entrer');
situation(PROPRIO, ficheProprio);
verifie('Le proprietaire entre, meme sans la case cochee', sandbox.aAccesSite());

situation('marie@gmail.com', ficheAvecSite);
verifie('Un membre avec la case Collections entre', sandbox.aAccesSite());
verifie('...et n\'est pas superadmin', !sandbox.estSuperadmin() && !sandbox.estSuperadminReel());

// LE cas qui compte pour un annuaire partage : des droits sur le hub ne
// doivent rien ouvrir ici.
situation('paul@gmail.com', ficheSansSite);
verifie('Un membre du hub sans la case Collections n\'entre pas', !sandbox.aAccesSite());
verifie('...meme avec deux projets du hub', !sandbox.aAccesSite());

situation('vieux@gmail.com', ficheAncienne);
verifie('Une fiche sans tableau « sites » n\'ouvre rien', !sandbox.aAccesSite());

// La fonction accepte une fiche explicite : c'est necessaire pour tester
// l'acces AVANT d'avoir rempli HUB.membre.
verifie('La fiche peut etre passee en argument',
  sandbox.aAccesSite(ficheAvecSite) === true && sandbox.aAccesSite(ficheSansSite) === false);

// --- 2. Les pages, toutes ouvertes -------------------------------
console.log('\n2. Les pages');
// L'acces etant global, le menu ne se filtre plus. C'est justement ce qui
// supprime tout risque de boucle : plus de renvoi vers l'accueil pour
// cause de droit manquant, alors que l'accueil est lui-meme une page de
// donnees.
situation('marie@gmail.com', ficheAvecSite);
redirections = [];
corps.setAttribute('data-page', 'comptes');
elements['app-content'] = fakeEl('app-content');
sandbox.demarrerPage(false);
verifie('Toute page s\'affiche sans redirection',
  redirections.length === 0 && elements['app-content'].style.display === 'block',
  JSON.stringify(redirections));

redirections = [];
corps.setAttribute('data-page', 'achats');
elements['app-content'] = fakeEl('app-content');
sandbox.demarrerPage(false);
verifie('L\'accueil aussi', redirections.length === 0);

verifie('Le menu propose les deux pages', sandbox.PAGES.length === 2);
verifie('Le menu marque la page active',
  elements['header-placeholder'].innerHTML.indexOf('class="active"') !== -1,
  'aucun lien actif');

// --- 3. Impersonation --------------------------------------------
console.log('\n3. Impersonation');
situation(PROPRIO, ficheProprio, ficheAvecSite);
verifie('Sous impersonation, le role VU n\'est plus superadmin', !sandbox.estSuperadmin());
// Le garde-fou : les requetes partent avec le jeton du proprietaire, son
// role reel ne doit jamais suivre l'apparence.
verifie('...mais le role REEL reste superadmin', sandbox.estSuperadminReel());
verifie('...et l\'acces suit la fiche regardee', sandbox.aAccesSite());

situation(PROPRIO, ficheProprio, ficheSansSite);
verifie('Impersonner quelqu\'un sans acces le montre', !sandbox.aAccesSite());

situation('marie@gmail.com', ficheAvecSite);
sessionStorage.donnees = {};
sandbox.demarrerImpersonation('paul@gmail.com');
verifie('Un membre ne peut pas declencher d\'impersonation',
  sessionStorage.getItem('hubImpersonation') === null);

situation(PROPRIO, ficheProprio);
sandbox.demarrerImpersonation('marie@gmail.com');
verifie('Le proprietaire, si', sessionStorage.getItem('hubImpersonation') === 'marie@gmail.com');
sandbox.arreterImpersonation();
verifie('Revenir a soi efface la trace', sessionStorage.getItem('hubImpersonation') === null);

// --- 4. Le refus est explique ------------------------------------
console.log('\n4. Le refus');
// « nosite » se distingue de « unauthorized » : la personne EST membre, il
// ne lui manque que la case. Sans cette distinction, elle croit son compte
// inconnu et redemande une inscription.
emplacement.search = '?error=nosite';
elements['login-error'] = fakeEl('login-error');
sandbox.afficherErreurLogin();
verifie('Le refus de site nomme la case a cocher',
  /Collections/.test(elements['login-error'].textContent)
  && /Membres/.test(elements['login-error'].textContent),
  elements['login-error'].textContent);
verifie('...et dit que le compte est bien membre',
  /membre/.test(elements['login-error'].textContent));

emplacement.search = '?error=disabled';
sandbox.afficherErreurLogin();
verifie('Un compte desactive a son propre message',
  /désactivé/.test(elements['login-error'].textContent), elements['login-error'].textContent);

emplacement.search = '?error=unauthorized';
sandbox.afficherErreurLogin();
verifie('Un non-membre garde le message generique',
  /n'a pas accès à ce site/.test(elements['login-error'].textContent), elements['login-error'].textContent);
emplacement.search = '';

// --- 5. Coherence avec le hub et les regles ----------------------
console.log('\n5. Coherence avec le hub admin');
const regles = fs.readFileSync(path.join(ADMIN, 'firestore.rules'), 'utf8');
const sitesHub = fs.readFileSync(path.join(ADMIN, 'sites.js'), 'utf8');
const projetsHub = fs.readFileSync(path.join(ADMIN, 'projets.js'), 'utf8');
const configHub = fs.readFileSync(path.join(ADMIN, 'config.js'), 'utf8');

// Le slug doit etre le meme dans trois fichiers de deux depots.
verifie('Le slug du site existe dans le registre du hub',
  new RegExp("slug: '" + sandbox.SITE_SLUG + "'").test(sitesHub), sandbox.SITE_SLUG);
verifie('Les regles gardent les collections par aAccesSite(<ce slug>)',
  new RegExp("aAccesSite\\('" + sandbox.SITE_SLUG + "'\\)").test(regles));
verifie('La fonction aAccesSite existe dans les regles',
  /function aAccesSite\(site\)/.test(regles));
// Elle doit lire membres.sites, et non membres.projets.
verifie('...et lit bien le tableau « sites » de la fiche',
  /site in docMembre\(\)\.get\('sites', \[\]\)/.test(regles),
  'aAccesSite ne lit pas membres.sites de facon defensive');

// L'ancien modele ne doit plus traîner : ni droit par page dans les
// regles, ni entree dans le registre des projets du hub.
['achats', 'fournisseurs'].forEach((ancien) => {
  verifie('Les regles n\'utilisent plus aAcces(\'' + ancien + '\')',
    !new RegExp("aAcces\\('" + ancien + "'\\)").test(regles));
  verifie('« ' + ancien + ' » n\'est plus un projet du hub',
    !new RegExp("slug: '" + ancien + "'").test(projetsHub));
});
verifie('Le registre des projets du hub ne contient plus rien d\'externe',
  projetsHub.indexOf('externe: true') === -1);

// Les deux collections du site restent declarees, et cloisonnees.
['achats', 'fournisseurs'].forEach((collection) => {
  const bloc = (regles.split('match /' + collection + '/')[1] || '').split('match /')[0];
  verifie('La collection « ' + collection + ' » a son bloc',
    bloc.length > 0);
  verifie('...garde par le droit du site',
    new RegExp("aAccesSite\\('" + sandbox.SITE_SLUG + "'\\)").test(bloc));
  verifie('...et cloisonnee par proprietaire',
    /resource\.data\.proprietaire == idAppelant\(\)/.test(bloc));
});

verifie('Le proprietaire est le meme ici, dans le hub et dans les regles',
  configHub.indexOf("'" + PROPRIO + "'") !== -1 && regles.indexOf("'" + PROPRIO + "'") !== -1,
  PROPRIO);

// --- 6. Etat des fichiers du site --------------------------------
console.log('\n6. Etat des fichiers');
const authJs = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
verifie('ALLOWED_EMAILS a disparu de la config',
  fs.readFileSync(path.join(RACINE, 'config.js'), 'utf8').indexOf('ALLOWED_EMAILS') === -1);
verifie('...et du vigile', authJs.indexOf('ALLOWED_EMAILS') === -1);
// Le vieux modele par page laissait un aAcces() et un projetsVisibles() :
// les laisser traîner ferait croire a un filtrage qui n'existe plus.
verifie('Le vigile n\'a plus de droit par page',
  authJs.indexOf('function aAcces(') === -1 && authJs.indexOf('projetsVisibles') === -1);
verifie('projets.js a bien ete renomme en pages.js',
  !fs.existsSync(path.join(RACINE, 'projets.js')) && fs.existsSync(path.join(RACINE, 'pages.js')));

['login.html', 'index.html', 'comptes.html'].forEach((page) => {
  const html = fs.readFileSync(path.join(RACINE, page), 'utf8');
  verifie(page + ' charge le SDK Firestore', /firebase-firestore\.js/.test(html));
  verifie(page + ' charge pages.js', /src="pages\.js"/.test(html));
  verifie(page + ' ne charge plus projets.js', !/src="projets\.js"/.test(html));
});

// data-page ne sert plus qu'a souligner le bon lien, mais s'il manque le
// menu n'a plus d'element actif — defaut discret, autant le voir ici.
sandbox.PAGES.forEach((p) => {
  const html = fs.readFileSync(path.join(RACINE, p.url), 'utf8');
  verifie(p.url + ' declare data-page="' + p.cle + '"',
    new RegExp('data-page="' + p.cle + '"').test(html));
  verifie(p.url + ' n\'a plus de data-projet', !/data-projet=/.test(html));
});

// --- Bilan -------------------------------------------------------
console.log('\n' + (echecs === 0 ? 'Tout passe.' : echecs + ' echec(s).'));
process.exit(echecs === 0 ? 0 : 1);
