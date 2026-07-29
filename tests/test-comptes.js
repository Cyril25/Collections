// ============================================================
// test-comptes.js — Fournisseurs et comptes
// ============================================================
// Charge comptes.js avec un DOM minimal simule.
//
// Lancer :  node tests/test-comptes.js
//
// Deux choses justifient a elles seules ce fichier :
//
// 1. LE CHAMP « SITE » DEVIENT UN href. Un « javascript:… » colle dedans
//    serait un lien executable au clic, sur une page qui a les mots de
//    passe en memoire. urlSure() est la seule chose entre les deux.
//
// 2. LE MOT DE PASSE NE DOIT JAMAIS ETRE DANS LE HTML GENERE. Le rendu
//    ne pose que des points ; la valeur arrive par textContent au clic.
//    Si une modification futur le remet dans innerHTML, il apparaitrait
//    dans le code source de la page, dans les captures d'ecran et dans
//    le DOM inspecte — sans que rien n'echoue.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', textContent: '', checked: false, className: '', style: {},
    focus() {}, remove() {}, appendChild() {},
  };
}
const telechargements = [];
const document = {
  addEventListener() {},
  getElementById(id) { elements[id] = elements[id] || fakeEl(id); return elements[id]; },
  createElement(tag) {
    if (tag === 'a') {
      const a = { href: '', download: '', click() { telechargements.push({ href: a.href, download: a.download }); } };
      return a;
    }
    let txt = '';
    return {
      appendChild(node) { txt += node.data; },
      get innerHTML() {
        return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  },
  createTextNode(t) { return { data: String(t) }; },
};

const blobs = new Map();
class FakeBlob {
  constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; }
}
const FakeURL = {
  createObjectURL(blob) { const u = 'blob:' + blobs.size; blobs.set(u, blob); return u; },
  revokeObjectURL() {},
};

// Presse-papier simule : on verifie ce qui part reellement dedans.
const presseP = [];
const navigator = { clipboard: { writeText(t) { presseP.push(t); return Promise.resolve(); } } };

const firebase = {
  firestore: Object.assign(() => ({}), {
    Timestamp: { fromDate: (d) => ({ toDate: () => d }) },
    FieldValue: { serverTimestamp: () => ({ __serveur: true }) },
  }),
};

const sandbox = {
  document, console, JSON, Date, Math, Number, String, Object, Array, Promise,
  setTimeout, clearTimeout, navigator,
  Blob: FakeBlob, URL: FakeURL, firebase,
  window: { location: { pathname: '/comptes.html', search: '', hostname: 'collections.ofildudoubs.fr' } },
};
sandbox.window.document = document;
vm.createContext(sandbox);

vm.runInContext(`
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  var toasts = [];
  function showToast(m, type){ toasts.push({ message: m, type: type }); }
`, sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'hub-utils.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'comptes.js'), 'utf8'), sandbox);

// --- Donnees factices --------------------------------------------
sandbox.fournisseurs = [
  { id: 'f1', type: 'fournisseur', nom: 'Monnaie de Paris', site: 'https://monnaiedeparis.fr', notes: 'Frais de port offerts dès 80 €' },
  { id: 'f2', type: 'fournisseur', nom: 'INCM Portugal', site: '', notes: '' },
  { id: 'f3', type: 'fournisseur', nom: "MTM Monaco & Cie", site: 'mtm.mc', notes: '' },
];
sandbox.comptes = [
  { id: 'c1', type: 'compte', fournisseurId: 'f1', libelle: 'Compte principal',
    email: 'cyril.samson@free.fr', motDePasse: 'A<b>Str0ng&Pass', principal: true, notes: 'Numéro client 4471' },
  { id: 'c2', type: 'compte', fournisseurId: 'f1', libelle: 'Second compte',
    email: 'autre@gmail.com', motDePasse: 'deuxieme', principal: false },
  { id: 'c3', type: 'compte', fournisseurId: 'f2', libelle: '',
    email: 'cyril@incm.pt', identifiant: 'csamson', motDePasse: '', principal: true },
];
sandbox.premierChargement = false;

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) { console.log('  ok   ' + nom); }
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

// --- 1. Assainissement des URL -----------------------------------
console.log('\n1. Assainissement du champ Site');
// Le cas qui compte : ce champ finit dans un href, sur une page qui a
// les mots de passe en memoire.
verifie('« javascript: » est refuse',
  sandbox.urlSure('javascript:alert(document.cookie)') === '', sandbox.urlSure('javascript:alert(1)'));
verifie('« JaVaScRiPt: » aussi (la casse ne sauve pas)',
  sandbox.urlSure('JaVaScRiPt:alert(1)') === '');
verifie('« data: » est refuse',
  sandbox.urlSure('data:text/html,<script>alert(1)</script>') === '');
verifie('« vbscript: » est refuse', sandbox.urlSure('vbscript:msgbox(1)') === '');
verifie('https passe tel quel',
  sandbox.urlSure('https://monnaiedeparis.fr') === 'https://monnaiedeparis.fr');
verifie('http passe tel quel', sandbox.urlSure('http://exemple.fr') === 'http://exemple.fr');
// Sans schema, « mtm.mc » partirait en lien RELATIF vers une page du site.
verifie('Un domaine nu recoit https://', sandbox.urlSure('mtm.mc') === 'https://mtm.mc');
verifie('Un chemin nu recoit https://',
  sandbox.urlSure('boutique.fr/collections') === 'https://boutique.fr/collections');
verifie('Le vide reste vide', sandbox.urlSure('') === '' && sandbox.urlSure(null) === '');
verifie('Les espaces autour sont ignores',
  sandbox.urlSure('  https://exemple.fr  ') === 'https://exemple.fr');
verifie('Le libelle affiche retire le schema',
  sandbox.libelleUrl('https://monnaiedeparis.fr/') === 'monnaiedeparis.fr');

// --- 2. Le mot de passe hors du HTML -----------------------------
console.log('\n2. Le mot de passe ne passe pas par le HTML');
sandbox.render();
const html = elements['fournisseurs-list'].innerHTML;
verifie('La page est bien rendue', html.includes('Monnaie de Paris'));
verifie('Aucun mot de passe en clair dans le HTML genere',
  !html.includes('A<b>Str0ng&Pass') && !html.includes('deuxieme')
  && !html.includes('Str0ng') && !html.includes('&amp;Pass'),
  'un mot de passe a fuite dans innerHTML');
verifie('Le HTML ne contient que des points a la place',
  html.includes('••••••••'));
verifie('Un compte sans mot de passe le dit',
  html.includes('Pas de mot de passe enregistré'));

// --- 3. Reveler / masquer ----------------------------------------
console.log('\n3. Reveler et masquer');
sandbox.basculerMdp('c1');
verifie('Le clic sur l\'oeil pose la vraie valeur',
  elements['mdp-c1'].textContent === 'A<b>Str0ng&Pass', elements['mdp-c1'].textContent);
verifie('L\'icone passe en oeil barre',
  elements['oeil-c1'].className.includes('fa-eye-slash'), elements['oeil-c1'].className);

sandbox.basculerMdp('c1');
verifie('Le second clic re-masque', elements['mdp-c1'].textContent === '••••••••');
verifie('L\'icone revient a l\'oeil ouvert',
  elements['oeil-c1'].className.includes('fa-eye')
  && !elements['oeil-c1'].className.includes('slash'));

// Un rafraichissement Firestore ne doit pas rendre un mot de passe
// revele : render() reconstruit le HTML avec des points, puis reinjecte.
sandbox.basculerMdp('c2');
sandbox.render();
verifie('Un rafraichissement conserve l\'etat revele',
  elements['mdp-c2'].textContent === 'deuxieme', elements['mdp-c2'].textContent);
verifie('...sans pour autant l\'ecrire dans le HTML',
  !elements['fournisseurs-list'].innerHTML.includes('deuxieme'));
sandbox.basculerMdp('c2');

// --- 4. Copie ----------------------------------------------------
console.log('\n4. Copie dans le presse-papier');
sandbox.copierMdp('c1');
verifie('Le mot de passe copie est le bon',
  presseP[presseP.length - 1] === 'A<b>Str0ng&Pass', presseP[presseP.length - 1]);
verifie('Copier ne revele rien a l\'ecran', elements['mdp-c1'].textContent === '••••••••');
sandbox.copierEmail('c1');
verifie('L\'email se copie aussi', presseP[presseP.length - 1] === 'cyril.samson@free.fr');

const avant = presseP.length;
sandbox.copierMdp('c3');
verifie('Un compte sans mot de passe ne copie rien', presseP.length === avant);

// --- 5. Regroupement et tri --------------------------------------
console.log('\n5. Comptes par fournisseur');
verifie('Monnaie de Paris a 2 comptes', sandbox.comptesDe('f1').length === 2);
verifie('Le compte principal passe devant',
  sandbox.comptesDe('f1')[0].id === 'c1', sandbox.comptesDe('f1')[0].id);
verifie('Un fournisseur sans compte rend une liste vide',
  sandbox.comptesDe('f3').length === 0);

// --- 6. Recherche ------------------------------------------------
console.log('\n6. Recherche');
elements['search-input'].value = 'free.fr';
sandbox.render();
verifie('Chercher une adresse retrouve le fournisseur qui l\'utilise',
  elements['fournisseurs-list'].innerHTML.includes('Monnaie de Paris')
  && !elements['fournisseurs-list'].innerHTML.includes('INCM'), 'mauvais filtrage');

elements['search-input'].value = 'incm';
sandbox.render();
verifie('Chercher un nom de fournisseur marche aussi',
  elements['fournisseurs-list'].innerHTML.includes('INCM'));

// Chercher un mot de passe permettrait de le confirmer par tatonnement
// sans jamais l'afficher : la recherche ne le regarde pas.
elements['search-input'].value = 'deuxieme';
sandbox.render();
verifie('La recherche ne porte PAS sur les mots de passe',
  !elements['fournisseurs-list'].innerHTML.includes('Monnaie de Paris'),
  'un mot de passe est devinable par la recherche');
elements['search-input'].value = '';
sandbox.render();

// --- 7. Echappement ----------------------------------------------
console.log('\n7. Echappement');
const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let souci = null;
for (const m of elements['fournisseurs-list'].innerHTML.matchAll(/onclick="([^"]*)"/g)) {
  try { new vm.Script(decodeHtml(m[1])); } catch (e) { souci = decodeHtml(m[1]) + ' :: ' + e.message; }
}
verifie('Tous les onclick generes sont du JS valide apres decodage', souci === null, souci);
verifie('« MTM Monaco & Cie » ne casse pas le rendu',
  elements['fournisseurs-list'].innerHTML.includes('MTM Monaco &amp; Cie'));

// --- 8. Export ---------------------------------------------------
console.log('\n8. Export');
sandbox.exporterJson();
verifie('Un fichier est telecharge', telechargements.length === 1);
const contenu = JSON.parse(blobs.get(telechargements[0].href).parts[0]);
verifie('Les 3 fournisseurs sont exportes', contenu.fournisseurs.length === 3);
verifie('Les comptes sont imbriques sous leur fournisseur',
  contenu.fournisseurs.find((f) => f.nom === 'Monnaie de Paris').comptes.length === 2);
// L'export est trie par nom : on cherche par nom, pas par indice.
verifie('L\'export est trie par nom de fournisseur',
  contenu.fournisseurs.map((f) => f.nom).join('|') === 'INCM Portugal|Monnaie de Paris|MTM Monaco & Cie',
  contenu.fournisseurs.map((f) => f.nom).join('|'));
// L'export est une sauvegarde : incomplet, il ne servirait a rien.
const mdp = contenu.fournisseurs
  .find((f) => f.nom === 'Monnaie de Paris').comptes
  .find((c) => c.email === 'cyril.samson@free.fr').motDePasse;
verifie('Les mots de passe sont bien dans l\'export',
  mdp === 'A<b>Str0ng&Pass', 'sauvegarde incomplete : ' + mdp);
// ...mais le fichier doit le dire, il sort de toute regle Firestore.
verifie('L\'export porte un avertissement en clair',
  /mots de passe en clair/i.test(contenu.avertissement || ''), contenu.avertissement);
const dernierToast = sandbox.toasts[sandbox.toasts.length - 1];
verifie('Le toast previent que le fichier contient les mots de passe',
  /mots de passe en clair/i.test(dernierToast.message), dernierToast.message);
verifie('Le nom de fichier est date',
  /^comptes-collections-\d{4}-\d{2}-\d{2}\.json$/.test(telechargements[0].download),
  telechargements[0].download);

// --- Bilan -------------------------------------------------------
console.log('\n' + (echecs === 0 ? 'Tout passe.' : echecs + ' echec(s).'));
process.exit(echecs === 0 ? 0 : 1);
