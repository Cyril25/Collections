// ============================================================
// test-acces.js — Droits, garde des pages et impersonation
// ============================================================
// Charge auth.js et projets.js dans un DOM minimal simule.
//
// Lancer :  node tests/test-acces.js
//
// Ce que ce fichier protege en priorite :
//
// 1. LA BOUCLE DE REDIRECTION. L'accueil de ce site EST une page a
//    droits (« achats »), contrairement au hub. Rediriger aveuglement
//    vers index.html quand la garde echoue enverrait quelqu'un sans
//    droit « achats » sur une page qui le renvoie sur elle-meme, en
//    boucle infinie. Rien n'echouerait : l'onglet tournerait.
//
// 2. LA COHERENCE DES SLUGS entre projets.js, les regles Firestore du
//    depot Admin et le registre du hub. Un slug qui diverge donne une
//    case a cocher qui n'ouvre rien, ou une page inaccessible a tous.
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
corps.enfants = [];
corps.insertBefore = function (noeud) { corps.enfants.push(noeud); };
corps.firstChild = null;

let redirections = [];
let rechargements = 0;

const document = {
  body: corps,
  ecouteurs: {},
  addEventListener(nom, fn) { document.ecouteurs[nom] = fn; },
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  // escapeHtml() d'auth.js passe par createElement + createTextNode :
  // rendre appendChild inerte ferait silencieusement rendre '' partout,
  // et les tests d'affichage passeraient sur du vide.
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

// sessionStorage simule : c'est la que vit l'impersonation.
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
  reload() { rechargements++; },
};

const firebase = {
  apps: [{}],
  initializeApp() {},
  auth: () => ({ onAuthStateChanged() {}, signOut: () => Promise.resolve() }),
  firestore: () => ({ collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: false }) }), get: () => Promise.resolve({ forEach() {} }) }) }),
};

const sandbox = {
  document, console, JSON, Date, Math, Number, String, Object, Array, Promise,
  setTimeout, clearTimeout, sessionStorage, firebase,
  URLSearchParams,
  location: emplacement,
};
vm.createContext(sandbox);
// Dans un navigateur, « window » EST l'objet global : « window.HUB = x »
// cree donc aussi le global HUB, dont auth.js se sert partout ensuite.
// Sans cette auto-reference, le vm garderait les deux separes et le
// fichier planterait a la premiere lecture de HUB — alors qu'il marche
// tres bien en vrai.
sandbox.window = sandbox;

vm.runInContext(fs.readFileSync(path.join(RACINE, 'config.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'projets.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8'), sandbox);

const HUB = sandbox.HUB;
const PROPRIO = sandbox.SUPERADMIN_EMAIL;

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) { console.log('  ok   ' + nom); }
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

// Place la page dans une situation donnee : qui est connecte, quelle
// fiche il a, et quelle fiche il regarde.
function situation(email, fiche, vue) {
  HUB.user = { email };
  HUB.membre = fiche;
  HUB.effectif = vue || fiche;
  HUB.impersonation = vue && vue !== fiche ? vue.email : '';
}

const ficheProprio = { email: PROPRIO, nom: 'Cyril', role: 'superadmin', projets: [], actif: true };
const ficheAcheteur = { email: 'marie@gmail.com', nom: 'Marie', role: 'membre', projets: ['achats'], actif: true };
const ficheHubSeul = { email: 'paul@gmail.com', nom: 'Paul', role: 'membre', projets: ['exterieur'], actif: true };
const ficheTout = { email: 'lea@gmail.com', nom: 'Lea', role: 'membre', projets: ['achats', 'fournisseurs'], actif: true };

const slugs = (liste) => liste.map((p) => p.slug).join(',');

// --- 1. Droits ---------------------------------------------------
console.log('\n1. Droits');
situation(PROPRIO, ficheProprio);
verifie('Le proprietaire voit les deux pages',
  slugs(sandbox.projetsVisibles()) === 'achats,fournisseurs', slugs(sandbox.projetsVisibles()));
verifie('...et aura acces a une page ajoutee plus tard',
  sandbox.aAcces('page-inventee-demain'));

situation('marie@gmail.com', ficheAcheteur);
verifie('Un membre « achats » ne voit que les achats',
  slugs(sandbox.projetsVisibles()) === 'achats', slugs(sandbox.projetsVisibles()));
verifie('...et n\'a pas les comptes fournisseurs', !sandbox.aAcces('fournisseurs'));
verifie('...et n\'est pas superadmin',
  !sandbox.estSuperadmin() && !sandbox.estSuperadminReel());

// Le cas qui compte pour un annuaire partage : avoir des droits sur le
// hub ne doit rien ouvrir ici.
situation('paul@gmail.com', ficheHubSeul);
verifie('Un membre du hub sans droit ici ne voit aucune page',
  sandbox.projetsVisibles().length === 0, slugs(sandbox.projetsVisibles()));

situation('lea@gmail.com', ficheTout);
verifie('Un membre avec les deux droits voit les deux pages',
  slugs(sandbox.projetsVisibles()) === 'achats,fournisseurs');

// --- 2. Garde des pages, sans boucle -----------------------------
console.log('\n2. Garde des pages');

// demarrerPage() est appele par le vigile ; on le rejoue directement.
function ouvrir(page, projet) {
  redirections = [];
  emplacement.pathname = '/' + page;
  corps.setAttribute('data-projet', projet);
  elements['app-content'] = fakeEl('app-content');
  sandbox.demarrerPage(false);
  return { redirections: redirections.slice(), contenu: elements['app-content'] };
}

situation('marie@gmail.com', ficheAcheteur);
let r = ouvrir('index.html', 'achats');
verifie('La page permise s\'affiche sans redirection',
  r.redirections.length === 0 && r.contenu.style.display === 'block',
  JSON.stringify(r.redirections));

r = ouvrir('comptes.html', 'fournisseurs');
verifie('La page interdite renvoie vers celle qui est permise',
  r.redirections.length === 1 && r.redirections[0] === 'index.html',
  JSON.stringify(r.redirections));

// LE cas de la boucle : aucun droit du tout, et l'accueil est lui-meme
// une page a droits. Rediriger serait un aller-retour sans fin.
situation('paul@gmail.com', ficheHubSeul);
r = ouvrir('index.html', 'achats');
verifie('Sans aucun droit, aucune redirection — donc aucune boucle',
  r.redirections.length === 0, JSON.stringify(r.redirections));
verifie('...et un message explique le refus',
  /accès à cette page/.test(r.contenu.innerHTML), r.contenu.innerHTML.slice(0, 120));

r = ouvrir('comptes.html', 'fournisseurs');
verifie('Meme chose sur l\'autre page, pas de renvoi vers l\'accueil interdit',
  r.redirections.length === 0, JSON.stringify(r.redirections));

// --- 3. Impersonation --------------------------------------------
console.log('\n3. Impersonation');
situation(PROPRIO, ficheProprio, ficheAcheteur);
verifie('Sous impersonation, l\'ecran suit la fiche regardee',
  slugs(sandbox.projetsVisibles()) === 'achats', slugs(sandbox.projetsVisibles()));
verifie('...le role VU n\'est plus superadmin', !sandbox.estSuperadmin());
// Le garde-fou : les requetes partent avec le jeton du proprietaire, son
// role reel ne doit jamais suivre l'apparence.
verifie('...mais le role REEL reste superadmin', sandbox.estSuperadminReel());

situation(PROPRIO, ficheProprio, ficheHubSeul);
r = ouvrir('index.html', 'achats');
verifie('Impersonner quelqu\'un sans droit montre le refus, sans boucler',
  r.redirections.length === 0 && /n'a pas/.test(r.contenu.innerHTML),
  JSON.stringify(r.redirections));
verifie('...et le refus nomme la personne regardee',
  r.contenu.innerHTML.indexOf('paul@gmail.com') !== -1);

// Un membre ordinaire ne peut pas s'inventer une impersonation.
situation('marie@gmail.com', ficheAcheteur);
sessionStorage.donnees = {};
sandbox.demarrerImpersonation('lea@gmail.com');
verifie('Un membre ne peut pas declencher d\'impersonation',
  sessionStorage.getItem('hubImpersonation') === null);

situation(PROPRIO, ficheProprio);
sandbox.demarrerImpersonation('marie@gmail.com');
verifie('Le proprietaire, si', sessionStorage.getItem('hubImpersonation') === 'marie@gmail.com');
sandbox.arreterImpersonation();
verifie('Revenir a soi efface la trace', sessionStorage.getItem('hubImpersonation') === null);

// --- 4. Coherence avec le hub et les regles ----------------------
console.log('\n4. Coherence avec le hub admin');
const regles = fs.readFileSync(path.join(ADMIN, 'firestore.rules'), 'utf8');
const projetsHub = fs.readFileSync(path.join(ADMIN, 'projets.js'), 'utf8');
const configHub = fs.readFileSync(path.join(ADMIN, 'config.js'), 'utf8');

sandbox.PROJETS.forEach((p) => {
  // Sans bloc match, la page s'affiche et ne charge rien.
  verifie('« ' + p.slug + ' » a un bloc match dans les regles du hub',
    new RegExp('match /' + p.slug + '/\\{').test(regles));
  // Sans entree dans le registre du hub, la case a cocher n'existe pas
  // et PERSONNE ne peut recevoir ce droit.
  verifie('« ' + p.slug + ' » est proposable sur la page Membres du hub',
    new RegExp("slug: '" + p.slug + "'").test(projetsHub));
  verifie('« ' + p.slug + ' » pointe une page qui existe ici',
    fs.existsSync(path.join(RACINE, p.url)), p.url);
});

// Trois fichiers doivent nommer la meme adresse : une divergence
// verrouillerait le proprietaire dehors sur l'un des deux sites.
verifie('Le proprietaire est le meme ici, dans le hub et dans les regles',
  configHub.indexOf("'" + PROPRIO + "'") !== -1 && regles.indexOf("'" + PROPRIO + "'") !== -1,
  PROPRIO);

// L'ancienne liste d'emails ne doit plus decider de rien.
verifie('ALLOWED_EMAILS a bien disparu de la config',
  fs.readFileSync(path.join(RACINE, 'config.js'), 'utf8').indexOf('ALLOWED_EMAILS') === -1);
verifie('...et n\'est plus lu par le vigile',
  fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8').indexOf('ALLOWED_EMAILS') === -1);

// Le vigile lit « membres » des le login : sans le SDK Firestore sur
// cette page, la connexion echouerait sans message clair.
['login.html', 'index.html', 'comptes.html'].forEach((page) => {
  const html = fs.readFileSync(path.join(RACINE, page), 'utf8');
  verifie(page + ' charge le SDK Firestore', /firebase-firestore\.js/.test(html));
  verifie(page + ' charge projets.js', /src="projets\.js"/.test(html));
});

// Chaque page protegee doit declarer son projet, sinon la garde ne
// s'applique pas et la page s'ouvre a tout membre.
sandbox.PROJETS.forEach((p) => {
  const html = fs.readFileSync(path.join(RACINE, p.url), 'utf8');
  verifie(p.url + ' declare data-projet="' + p.slug + '"',
    new RegExp('data-projet="' + p.slug + '"').test(html));
});

// --- Bilan -------------------------------------------------------
console.log('\n' + (echecs === 0 ? 'Tout passe.' : echecs + ' echec(s).'));
process.exit(echecs === 0 ? 0 : 1);
