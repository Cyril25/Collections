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
// Les ecouteurs sont retenus, pas jetes : sans ca le handler Echap de
// comptes.js ne serait teste nulle part, et une modale qui ne se ferme
// plus ne se voit qu'a l'usage.
const ecouteurs = {};
const document = {
  addEventListener(type, fn) { (ecouteurs[type] = ecouteurs[type] || []).push(fn); },
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

// Faux Firestore : on veut verifier ce qui PART EN BASE, pas seulement
// ce que l'ecran affiche. Le reordonnancement n'a pas d'autre trace.
const ecritures = [];
const fauxDb = {
  batch() {
    const operations = [];
    return {
      update(ref, data) { operations.push({ type: 'update', id: ref.id, data }); },
      set(ref, data) { operations.push({ type: 'set', id: ref.id, data }); },
      delete(ref) { operations.push({ type: 'delete', id: ref.id }); },
      commit() { operations.forEach((o) => ecritures.push(o)); return Promise.resolve(); },
    };
  },
  collection() {
    return {
      doc(id) {
        const reference = id || 'nouveau-doc';
        return {
          id: reference,
          update(data) { ecritures.push({ type: 'update', id: reference, data: data }); return Promise.resolve(); },
          set(data) { ecritures.push({ type: 'set', id: reference, data: data }); return Promise.resolve(); },
          delete() { ecritures.push({ type: 'delete', id: reference }); return Promise.resolve(); },
          get: () => Promise.resolve({ exists: false }),
        };
      },
      onSnapshot() {},
      // On enregistre les filtres demandes : une requete NON filtree serait
      // rejetee en bloc par les regles, et la page paraitrait vide.
      where(champ, operateur, valeur) {
        requetes.push({ champ: champ, operateur: operateur, valeur: valeur });
        return { onSnapshot() {}, get: () => Promise.resolve({ forEach() {} }) };
      },
      get: () => Promise.resolve({ forEach() {} }),
      add(data) { ecritures.push({ type: 'add', data: data }); return Promise.resolve({ id: 'nouveau-doc' }); },
    };
  },
};
const requetes = [];
const firebase = {
  firestore: Object.assign(() => fauxDb, {
    Timestamp: { fromDate: (d) => ({ toDate: () => d }) },
    FieldValue: {
      serverTimestamp: () => ({ __serveur: true }),
      arrayUnion: (...elementsAjoutes) => ({ __arrayUnion: elementsAjoutes }),
    },
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
// « ordre » volontairement absent partout au depart : c'est l'etat des
// comptes crees avant le glisser-deposer.
sandbox.comptes = [
  { id: 'c1', type: 'compte', fournisseurId: 'f1', libelle: 'Compte principal',
    email: 'cyril.samson@free.fr', motDePasse: 'A<b>Str0ng&Pass', principal: true, notes: 'Numéro client 4471',
    telephone: '06 12 34 56 78', modePaiement: 'Carte Boursorama',
    destinataire: 'Cyril Samson', rue: '12 rue des Lilas', codePostal: '25000', ville: 'Besançon' },
  { id: 'c2', type: 'compte', fournisseurId: 'f1', libelle: 'Second compte',
    email: 'autre@gmail.com', motDePasse: 'deuxieme', principal: false,
    modePaiement: 'Carte BNP', destinataire: 'Cyril Samson', ville: 'Pontarlier' },
  { id: 'c3', type: 'compte', fournisseurId: 'f2', libelle: '',
    email: 'cyril@incm.pt', identifiant: 'csamson', motDePasse: '', principal: true },
];
sandbox.premierChargement = false;
// onHubReady() n'est pas appele hors navigateur : on branche le faux
// Firestore a la main.
sandbox.db = fauxDb;

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
// c3 n'a pas de libelle : rien ne doit s'afficher a la place. Un
// « Compte » generique n'apprend rien et vole la place de l'email.
verifie('Un compte sans libelle n\'affiche pas de libelle de secours',
  !html.includes('>Compte<'), 'un libelle generique est rendu');

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

// --- 5. Coordonnees et adresse -----------------------------------
console.log('\n5. Coordonnees et adresse');
verifie('L\'adresse complete tient en trois lignes',
  sandbox.adresseFormatee(sandbox.comptes[0]).join('\n') === 'Cyril Samson\n12 rue des Lilas\n25000 Besançon',
  JSON.stringify(sandbox.adresseFormatee(sandbox.comptes[0])));
// Une adresse a moitie remplie doit rendre ce qu'on en connait, sans
// ligne vide ni « undefined » au milieu.
verifie('Une adresse partielle saute les morceaux absents',
  sandbox.adresseFormatee(sandbox.comptes[1]).join('\n') === 'Cyril Samson\nPontarlier',
  JSON.stringify(sandbox.adresseFormatee(sandbox.comptes[1])));
verifie('Aucune adresse rend une liste vide',
  sandbox.adresseFormatee(sandbox.comptes[2]).length === 0);
verifie('Code postal seul ne fabrique pas de ligne bancale',
  sandbox.adresseFormatee({ codePostal: '25000' }).join('') === '25000');

sandbox.copierAdresse('c1');
verifie('L\'adresse se copie d\'un bloc, avec ses retours a la ligne',
  presseP[presseP.length - 1] === 'Cyril Samson\n12 rue des Lilas\n25000 Besançon',
  JSON.stringify(presseP[presseP.length - 1]));
sandbox.copierTelephone('c1');
verifie('Le telephone se copie', presseP[presseP.length - 1] === '06 12 34 56 78');

sandbox.render();
const htmlComplet = elements['fournisseurs-list'].innerHTML;
verifie('Le telephone est affiche', htmlComplet.includes('06 12 34 56 78'));
verifie('Le moyen de paiement est affiche', htmlComplet.includes('Carte Boursorama'));
verifie('L\'adresse est affichee ligne par ligne',
  htmlComplet.includes('Cyril Samson<br>12 rue des Lilas<br>25000 Besançon'),
  'mise en forme de l\'adresse inattendue');
verifie('Un compte sans coordonnees n\'affiche pas de ligne vide',
  !htmlComplet.includes('fa-location-dot compte-icone"></i><span class="compte-valeur"></span>'));

// --- 6. Regroupement et tri --------------------------------------
console.log('\n6. Comptes par fournisseur');
verifie('Monnaie de Paris a 2 comptes', sandbox.comptesDe('f1').length === 2);
verifie('Le compte principal passe devant',
  sandbox.comptesDe('f1')[0].id === 'c1', sandbox.comptesDe('f1')[0].id);
verifie('Un fournisseur sans compte rend une liste vide',
  sandbox.comptesDe('f3').length === 0);

// --- 7. Reordonner au glisser-deposer ----------------------------
console.log('\n7. Reordonner au glisser-deposer');
const rangs = () => sandbox.comptesDe('f4').map((c) => c.id).join(',');
const evenement = () => ({ preventDefault() {}, dataTransfer: null });

// Quatre comptes chez un meme fournisseur, dont le principal.
sandbox.fournisseurs.push({ id: 'f4', type: 'fournisseur', nom: 'Ordre & Cie' });
sandbox.comptes.push(
  { id: 'd0', type: 'compte', fournisseurId: 'f4', libelle: 'Le principal', email: 'p@x.fr', principal: true, ordre: 0 },
  { id: 'd1', type: 'compte', fournisseurId: 'f4', libelle: 'Premier', email: 'a@x.fr', ordre: 1 },
  { id: 'd2', type: 'compte', fournisseurId: 'f4', libelle: 'Deuxieme', email: 'b@x.fr', ordre: 2 },
  { id: 'd3', type: 'compte', fournisseurId: 'f4', libelle: 'Troisieme', email: 'c@x.fr', ordre: 3 }
);
sandbox.render();
verifie('Ordre de depart', rangs() === 'd0,d1,d2,d3', rangs());

// Descendre d1 sur d3 : on se deplace VERS la cible, donc on passe apres.
function glisserSur(sourceId, cibleId) {
  ecritures.length = 0;
  sandbox.glisseId = sourceId;
  sandbox.deposer(evenement(), cibleId);
  // Le faux Firestore n'a pas d'ecouteur : on rejoue a la main ce que
  // onSnapshot ferait, pour que le tri suivant voie les nouveaux rangs.
  ecritures.forEach((e) => {
    const compte = sandbox.comptes.find((c) => c.id === e.id);
    if (compte) Object.assign(compte, e.data);
  });
}

glisserSur('d1', 'd3');
verifie('Descendre une fiche la place APRES la cible',
  rangs() === 'd0,d2,d3,d1', rangs());

glisserSur('d3', 'd2');
verifie('Remonter une fiche la place AVANT la cible',
  rangs() === 'd0,d3,d2,d1', rangs());

// Deposer sur le principal = « juste apres lui », puisqu'il ne bouge pas.
glisserSur('d1', 'd0');
verifie('Deposer sur le principal place la fiche juste apres lui',
  rangs() === 'd0,d1,d3,d2', rangs());
verifie('Le principal garde le rang 0 en base',
  sandbox.comptes.find((c) => c.id === 'd0').ordre === 0,
  sandbox.comptes.find((c) => c.id === 'd0').ordre);

// Les rangs ecrits doivent etre 0,1,2,3 — sans trou, sinon un tri
// ulterieur repartirait dans le desordre.
const rangsEnBase = sandbox.comptesDe('f4').map((c) => c.ordre).join(',');
verifie('Les rangs en base sont contigus et dans l\'ordre affiche',
  rangsEnBase === '0,1,2,3', rangsEnBase);

// Rien ne doit partir en base si la fiche ne bouge pas.
ecritures.length = 0;
sandbox.glisseId = 'd1';
sandbox.deposer(evenement(), 'd1');
verifie('Deposer une fiche sur elle-meme n\'ecrit rien', ecritures.length === 0);

// Un compte ne change pas de fournisseur par glissement : les rangs sont
// relatifs a un fournisseur, et la fiche disparaitrait de sa colonne.
ecritures.length = 0;
sandbox.glisseId = 'd1';
sandbox.deposer(evenement(), 'c1');
verifie('Un depot chez un autre fournisseur est refuse', ecritures.length === 0);

// Le principal l'emporte sur son rang : c'est une promesse de l'interface.
sandbox.comptes.find((c) => c.id === 'd0').ordre = 99;
verifie('Le principal reste en tete meme avec un rang eleve',
  sandbox.comptesDe('f4')[0].id === 'd0', rangs());
sandbox.comptes.find((c) => c.id === 'd0').ordre = 0;

// Sans « ordre », on retombe sur l'alphabet — le cas des comptes crees
// avant cette fonctionnalite.
verifie('Sans rang, le tri reste alphabetique',
  sandbox.comptesDe('f1').map((c) => c.id).join(',') === 'c1,c2',
  sandbox.comptesDe('f1').map((c) => c.id).join(','));

// La poignee arme puis desarme le glisser : sans ca, le texte de la
// fiche resterait non selectionnable apres un simple clic.
sandbox.render();
sandbox.armerGlisser('d1');
verifie('La poignee rend la fiche deplacable', elements['compte-d1'].draggable === true);
sandbox.desarmerGlisser();
verifie('Le relachement la rend a nouveau selectionnable',
  elements['compte-d1'].draggable === false);

verifie('Le principal n\'a pas de poignee de deplacement',
  /compte-poignee--fixe/.test(elements['fournisseurs-list'].innerHTML));

// --- 8. Recherche -----------------------------------------------
console.log('\n8. Recherche');
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
console.log('\n9. Echappement');
const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let souci = null;
for (const m of elements['fournisseurs-list'].innerHTML.matchAll(/onclick="([^"]*)"/g)) {
  try { new vm.Script(decodeHtml(m[1])); } catch (e) { souci = decodeHtml(m[1]) + ' :: ' + e.message; }
}
verifie('Tous les onclick generes sont du JS valide apres decodage', souci === null, souci);
verifie('« MTM Monaco & Cie » ne casse pas le rendu',
  elements['fournisseurs-list'].innerHTML.includes('MTM Monaco &amp; Cie'));

// --- 10. Cloisonnement par proprietaire --------------------------
console.log('\n10. Cloisonnement par proprietaire');

// LE test qui compte. Les regles n'autorisent la lecture que de ses
// propres fiches, et Firestore rejette EN BLOC une requete qui pourrait
// ramener un document interdit. Une requete sans `where` ne donne donc
// pas une liste partielle : elle donne une page vide avec une erreur de
// permissions, alors que les donnees sont bien la.
requetes.length = 0;
sandbox.HUB = {
  user: { email: 'Cyril.Samson41@Gmail.com' },
  membre: { email: 'cyril.samson41@gmail.com', role: 'superadmin' },
  effectif: { email: 'cyril.samson41@gmail.com', role: 'superadmin' },
  impersonation: '',
};
sandbox.normaliserEmail = (e) => String(e || '').trim().toLowerCase();
sandbox.estSuperadminReel = () => true;
sandbox.onHubReady();
verifie('L\'ecoute filtre sur le proprietaire',
  requetes.some((r) => r.champ === 'proprietaire' && r.operateur === '=='),
  JSON.stringify(requetes));
verifie('L\'email du filtre est normalise en minuscules',
  requetes[0] && requetes[0].valeur === 'cyril.samson41@gmail.com', requetes[0] && requetes[0].valeur);

// Sous impersonation, on regarde les fiches de l'AUTRE : sinon la vue ne
// montre pas ce que l'autre voit, et l'impersonation ne sert a rien ici.
requetes.length = 0;
sandbox.HUB.effectif = { email: 'marie@gmail.com', role: 'membre', projets: ['fournisseurs'] };
sandbox.HUB.impersonation = 'marie@gmail.com';
sandbox.onHubReady();
verifie('Sous impersonation, on lit les fiches de la personne regardee',
  requetes[0] && requetes[0].valeur === 'marie@gmail.com', requetes[0] && requetes[0].valeur);

// Une fiche creee porte son proprietaire, sans quoi elle serait invisible
// des le rechargement suivant.
ecritures.length = 0;
sandbox.fournisseurEnEdition = null;
// Passer par getElementById : le DOM simule cree les elements a la
// demande, ils n'existent pas avant d'avoir ete reclames.
document.getElementById('ff-nom').value = 'Nouveau fournisseur';
document.getElementById('ff-site').value = '';
document.getElementById('ff-notes').value = '';
sandbox.sauverFournisseur();
const creation = ecritures.find((e) => e.type === 'add');
verifie('Un fournisseur cree porte un proprietaire',
  !!creation && creation.data.proprietaire === 'marie@gmail.com',
  creation && creation.data.proprietaire);
// Tracabilite : l'utilisateur REEL, pas l'impersonne. Sous impersonation
// l'ecriture part avec le jeton du superadmin ; inscrire l'autre identite
// ferait mentir la trace.
verifie('...et « creePar » nomme l\'utilisateur reel, pas l\'impersonne',
  !!creation && creation.data.creePar === 'cyril.samson41@gmail.com',
  creation && creation.data.creePar);

// Modifier ne doit jamais reecrire le proprietaire : les regles
// l'interdisent, et une fiche qui change de main toute seule serait pire
// qu'une fiche mal rangee.
ecritures.length = 0;
sandbox.fournisseurEnEdition = 'f1';
sandbox.sauverFournisseur();
const maj = ecritures.find((e) => e.type === 'update');
verifie('Une modification ne touche pas au proprietaire',
  !!maj && !('proprietaire' in maj.data), maj && JSON.stringify(Object.keys(maj.data)));
sandbox.fournisseurEnEdition = null;

// Les regles publiees doivent correspondre a ce que le client suppose.
const blocFournisseurs = fs.readFileSync(
  path.join(RACINE, '..', 'Admin', 'firestore.rules'), 'utf8').split('match /fournisseurs/')[1] || '';
verifie('Les regles du hub cloisonnent bien par proprietaire',
  /resource\.data\.proprietaire == idAppelant\(\)/.test(blocFournisseurs),
  'le bloc match /fournisseurs ne filtre pas par proprietaire');
verifie('...et interdisent de changer le proprietaire d\'une fiche',
  /request\.resource\.data\.proprietaire == resource\.data\.proprietaire/.test(blocFournisseurs));
verifie('...et exigent un proprietaire a la creation',
  /request\.resource\.data\.proprietaire == idAppelant\(\)/.test(blocFournisseurs));

// --- 11. Export --------------------------------------------------
// DEUX BOUTONS, ET LA SEULE CHOSE QUI COMPTE ICI EST LEUR DIFFERENCE.
// Le geste courant ne doit RIEN laisser sortir ; l'export complet doit
// tout sortir, et se signaler. Si une modification future ramenait le
// mot de passe dans l'export courant, rien a l'ecran ne le dirait — le
// fichier part dans les telechargements et personne ne l'ouvre.
console.log('\n11. Export courant (sans les mots de passe)');
sandbox.exporterJson();
verifie('Un fichier est telecharge', telechargements.length === 1);
const contenu = JSON.parse(blobs.get(telechargements[0].href).parts[0]);
// « Ordre & Cie » a ete ajoute par la section 7 : l'export doit le voir
// lui aussi, sans quoi la sauvegarde serait partielle.
verifie('Tous les fournisseurs sont exportes',
  contenu.fournisseurs.length === sandbox.fournisseurs.length,
  contenu.fournisseurs.length + ' exportes pour ' + sandbox.fournisseurs.length + ' en memoire');
verifie('Les comptes sont imbriques sous leur fournisseur',
  contenu.fournisseurs.find((f) => f.nom === 'Monnaie de Paris').comptes.length === 2);
// L'export est trie par nom : on cherche par nom, pas par indice.
verifie('L\'export est trie par nom de fournisseur',
  contenu.fournisseurs.map((f) => f.nom).join('|')
    === 'INCM Portugal|Monnaie de Paris|MTM Monaco & Cie|Ordre & Cie',
  contenu.fournisseurs.map((f) => f.nom).join('|'));
// Les comptes sortent dans l'ordre affiche, pas dans celui de la base :
// une sauvegarde qui perd l'ordre choisi le perd pour de bon.
verifie('Les comptes sont exportes dans l\'ordre du glisser-deposer',
  contenu.fournisseurs.find((f) => f.nom === 'Ordre & Cie').comptes
    .map((c) => c.libelle).join(',') === 'Le principal,Premier,Troisieme,Deuxieme',
  contenu.fournisseurs.find((f) => f.nom === 'Ordre & Cie').comptes.map((c) => c.libelle).join(','));
verifie('L\'export porte les coordonnees et l\'adresse',
  contenu.fournisseurs.find((f) => f.nom === 'Monnaie de Paris').comptes
    .some((c) => c.telephone === '06 12 34 56 78' && c.ville === 'Besançon'
              && c.modePaiement === 'Carte Boursorama'), 'coordonnees absentes de l\'export');

// LE TEST QUI JUSTIFIE LE CHANTIER DU 2026-09-06.
const tousLesMdp = contenu.fournisseurs
  .flatMap((f) => f.comptes)
  .map((c) => c.motDePasse);
verifie('AUCUN mot de passe ne sort de l\'export courant',
  tousLesMdp.every((m) => m === null), JSON.stringify(tousLesMdp));
verifie('Le JSON complet ne contient nulle part le mot de passe',
  !blobs.get(telechargements[0].href).parts[0].includes('A<b>Str0ng&Pass'),
  'le mot de passe fuit malgre motDePasse: null');
// Sans la valeur, il faut savoir lesquels sont a ressaisir : une
// sauvegarde muette laisserait deviner quels comptes sont incomplets.
verifie('...mais l\'export dit lesquels en avaient un',
  contenu.fournisseurs.find((f) => f.nom === 'Monnaie de Paris').comptes
    .find((c) => c.email === 'cyril.samson@free.fr').motDePasseDefini === true);
verifie('L\'export courant s\'annonce comme incomplet',
  contenu.motsDePasse === 'exclus'
  && /sans les mots de passe/i.test(contenu.avertissement || ''),
  contenu.motsDePasse + ' / ' + contenu.avertissement);
verifie('Le toast ne promet pas une sauvegarde complete',
  /sans les mots de passe/i.test(sandbox.toasts[sandbox.toasts.length - 1].message),
  sandbox.toasts[sandbox.toasts.length - 1].message);
verifie('Le nom de fichier est date, sans mention d\'alerte',
  /^comptes-collections-\d{4}-\d{2}-\d{2}\.json$/.test(telechargements[0].download),
  telechargements[0].download);

console.log('\n11 bis. Export complet (derriere confirmation)');
// Le bouton n'exporte pas : il ouvre la modale. Si un jour il
// telechargeait directement, la confirmation ne servirait plus a rien
// et personne ne s'en apercevrait.
sandbox.ouvrirExportComplet();
verifie('Le bouton ouvre la modale et ne telecharge rien',
  elements['modal-export'].style.display === 'flex' && telechargements.length === 1,
  telechargements.length + ' telechargement(s)');
const attendus = sandbox.fournisseurs
  .flatMap((f) => sandbox.comptesDe(f.id))
  .filter((c) => c.motDePasse).length;
verifie('La modale annonce combien de mots de passe vont sortir',
  attendus > 0 && elements['export-detail'].textContent.includes(String(attendus)),
  attendus + ' attendus — ' + elements['export-detail'].textContent);

sandbox.confirmerExportComplet();
verifie('Confirmer telecharge et referme la modale',
  telechargements.length === 2 && elements['modal-export'].style.display === 'none');
const complet = JSON.parse(blobs.get(telechargements[1].href).parts[0]);
const mdp = complet.fournisseurs
  .find((f) => f.nom === 'Monnaie de Paris').comptes
  .find((c) => c.email === 'cyril.samson@free.fr').motDePasse;
// Le filet doit rester un filet : ampute, il ne servirait a rien.
verifie('Les mots de passe sont bien dans l\'export complet',
  mdp === 'A<b>Str0ng&Pass', 'sauvegarde incomplete : ' + mdp);
verifie('L\'export complet le dit en clair',
  complet.motsDePasse === 'en clair'
  && /mots de passe en clair/i.test(complet.avertissement || ''),
  complet.motsDePasse + ' / ' + complet.avertissement);
verifie('Le toast previent que le fichier contient les mots de passe',
  /mots de passe en clair/i.test(sandbox.toasts[sandbox.toasts.length - 1].message),
  sandbox.toasts[sandbox.toasts.length - 1].message);
// Le nom crie : c'est ce qui permet de reperer le fichier dangereux
// dans les telechargements, et de retrouver les anciens pour les jeter.
verifie('Le nom de fichier signale ce qu\'il contient',
  /^comptes-collections-\d{4}-\d{2}-\d{2}-AVEC-MOTS-DE-PASSE\.json$/
    .test(telechargements[1].download),
  telechargements[1].download);
// Meme structure des deux cotes : une restauration n'a pas a connaitre
// deux formats, seule la valeur du mot de passe change.
verifie('Les deux exports ont la meme forme',
  JSON.stringify(contenu.fournisseurs.map((f) => f.comptes.map((c) => Object.keys(c).join(','))))
    === JSON.stringify(complet.fournisseurs.map((f) => f.comptes.map((c) => Object.keys(c).join(',')))));

// Echap doit fermer la modale de l'export comme les autres, sinon on
// est coince devant une confirmation qu'on ne voulait pas ouvrir.
sandbox.ouvrirExportComplet();
(ecouteurs.keydown || []).forEach((fn) => fn({ key: 'Escape' }));
verifie('Echap referme la modale d\'export sans telecharger',
  elements['modal-export'].style.display === 'none' && telechargements.length === 2);

// Le faux Firestore n'a pas d'ecouteur : on rejoue a la main ce que
// onSnapshot ferait, y compris un arrayUnion.
function rejouerEcritures() {
  ecritures.forEach((e) => {
    const fiche = sandbox.fournisseurs.find((f) => f.id === e.id)
      || sandbox.comptes.find((c) => c.id === e.id);
    if (!fiche || !e.data) return;
    Object.keys(e.data).forEach((champ) => {
      const valeur = e.data[champ];
      fiche[champ] = valeur && valeur.__arrayUnion
        ? (fiche[champ] || []).concat(valeur.__arrayUnion)
        : valeur;
    });
  });
}
const nomsAffiches = () => [...elements['fournisseurs-list'].innerHTML.matchAll(/<h2>([^<]*)<\/h2>/g)]
  .map((m) => m[1]).join('|');

// --- 12. Fournisseur favori --------------------------------------
// Le gain de quelques secondes le jour J : le fournisseur de la sortie
// en tete de page, sans defiler. Un seul a la fois.
console.log('\n12. Fournisseur favori');
elements['search-input'].value = '';
sandbox.render();
verifie('Sans favori, l\'ordre est alphabetique',
  nomsAffiches() === 'INCM Portugal|Monnaie de Paris|MTM Monaco &amp; Cie|Ordre &amp; Cie', nomsAffiches());
verifie('Chaque fournisseur porte une etoile creuse',
  (elements['fournisseurs-list'].innerHTML.match(/fa-regular fa-star/g) || []).length === sandbox.fournisseurs.length);

ecritures.length = 0;
sandbox.basculerFavori('f4');
verifie('Marquer un favori n\'ecrit que lui quand il n\'y en avait pas',
  ecritures.length === 1 && ecritures[0].id === 'f4' && ecritures[0].data.favori === true,
  JSON.stringify(ecritures));
verifie('...sans toucher a « modifie le »', !('updatedAt' in ecritures[0].data));
rejouerEcritures();
sandbox.render();
verifie('Le favori passe en tete, les autres restent alphabetiques',
  nomsAffiches() === 'Ordre &amp; Cie|INCM Portugal|Monnaie de Paris|MTM Monaco &amp; Cie', nomsAffiches());
verifie('Son etoile est pleine et annoncee comme enfoncee',
  /btn-favori btn-favori--actif" aria-pressed="true"[^>]*><i class="fa-solid fa-star">/
    .test(elements['fournisseurs-list'].innerHTML));

// Le cas du jour J : on change de sortie, donc de favori. L'ancien doit
// etre decoche dans le MEME lot, sinon deux blocs se disputent la tete.
ecritures.length = 0;
sandbox.basculerFavori('f2');
verifie('Le nouveau favori remplace l\'ancien dans le meme lot',
  ecritures.length === 2
  && ecritures.some((e) => e.id === 'f2' && e.data.favori === true)
  && ecritures.some((e) => e.id === 'f4' && e.data.favori === false),
  JSON.stringify(ecritures));
rejouerEcritures();
sandbox.render();
verifie('Un seul favori a la fois',
  sandbox.fournisseurs.filter((f) => f.favori).map((f) => f.id).join(',') === 'f2');
verifie('L\'ancien favori retrouve sa place alphabetique',
  nomsAffiches() === 'INCM Portugal|Monnaie de Paris|MTM Monaco &amp; Cie|Ordre &amp; Cie', nomsAffiches());

sandbox.basculerFavori('f3');
rejouerEcritures();
elements['search-input'].value = 'mo';
sandbox.render();
verifie('Pendant une recherche, le favori reste en tete des resultats',
  nomsAffiches().startsWith('MTM Monaco'), nomsAffiches());
elements['search-input'].value = '';

ecritures.length = 0;
sandbox.basculerFavori('f3');
verifie('Re-cliquer l\'etoile pleine retire le favori, sans en designer d\'autre',
  ecritures.length === 1 && ecritures[0].id === 'f3' && ecritures[0].data.favori === false,
  JSON.stringify(ecritures));
rejouerEcritures();

// --- 13. Journal d'un compte -------------------------------------
console.log('\n13. Journal d\'un compte');

// L'aller-retour avec <input type="datetime-local"> : l'heure saisie
// doit etre l'heure enregistree, pas une heure decalee par l'UTC.
const neufHeures = new Date(2026, 9, 7, 9, 2);
verifie('Une date devient la valeur du champ, en heure locale',
  sandbox.versChampDateHeure(neufHeures) === '2026-10-07T09:02', sandbox.versChampDateHeure(neufHeures));
verifie('...et revient intacte',
  sandbox.depuisChampDateHeure('2026-10-07T09:02').getTime() === neufHeures.getTime());
verifie('Un champ vide ou bancal ne donne pas de date',
  sandbox.depuisChampDateHeure('') === null && sandbox.depuisChampDateHeure('demain') === null);

const reference = new Date(2026, 9, 8, 15, 0);
verifie('Le jour meme se lit « aujourd\'hui »',
  sandbox.libelleDateNote(new Date(2026, 9, 8, 9, 2), reference) === 'aujourd\'hui 09:02',
  sandbox.libelleDateNote(new Date(2026, 9, 8, 9, 2), reference));
verifie('La veille se lit « hier »',
  sandbox.libelleDateNote(new Date(2026, 9, 7, 21, 15), reference) === 'hier 21:15',
  sandbox.libelleDateNote(new Date(2026, 9, 7, 21, 15), reference));
verifie('La veille d\'un 1er du mois aussi',
  sandbox.libelleDateNote(new Date(2026, 8, 30, 8, 0), new Date(2026, 9, 1, 10, 0)) === 'hier 08:00');
verifie('Une autre annee se signale',
  /2025/.test(sandbox.libelleDateNote(new Date(2025, 9, 7, 9, 2), reference)),
  sandbox.libelleDateNote(new Date(2025, 9, 7, 9, 2), reference));

// Ouvrir une note neuve : maintenant, et le moyen de paiement du compte.
const avantOuverture = Date.now();
sandbox.ouvrirModaleNote('c2', null);
verifie('La modale s\'ouvre', elements['modal-note'].style.display === 'flex');
const ecart = Math.abs(sandbox.depuisChampDateHeure(elements['fn-date'].value).getTime() - avantOuverture);
verifie('La date proposee est maintenant', ecart < 2 * 60 * 1000, elements['fn-date'].value);
verifie('Le moyen de paiement du compte est pre-rempli',
  elements['fn-paiement'].value === 'Carte BNP', elements['fn-paiement'].value);
verifie('La modale dit de quel compte il s\'agit',
  /Monnaie de Paris/.test(elements['fn-compte'].textContent)
  && /autre@gmail\.com/.test(elements['fn-compte'].textContent), elements['fn-compte'].textContent);
verifie('Pas de bouton Supprimer sur une note neuve', elements['fn-supprimer'].style.display === 'none');

// Le jour J on a paye avec une autre carte : la note le retient, le
// compte garde son habitude.
elements['fn-paiement'].value = 'Carte Revolut';
elements['fn-texte'].value = "Sortie Portugal — 2 € BU + coffret L'Étoile <b>";
ecritures.length = 0;
sandbox.sauverNote();
const ajout = ecritures[0];
verifie('Une note neuve s\'ajoute par arrayUnion, sans reecrire le journal',
  ecritures.length === 1 && ajout.id === 'c2' && ajout.data.journal && ajout.data.journal.__arrayUnion,
  JSON.stringify(ecritures));
const noteAjoutee = ajout.data.journal.__arrayUnion[0];
verifie('La note porte le paiement reellement utilise',
  noteAjoutee.paiement === 'Carte Revolut', noteAjoutee.paiement);
verifie('...un identifiant, une date et le commentaire',
  !!noteAjoutee.id && typeof noteAjoutee.date.toDate === 'function'
  && noteAjoutee.texte.startsWith('Sortie Portugal'));
verifie('Le moyen de paiement du compte n\'est pas touche',
  Object.keys(ajout.data).join(',') === 'journal', Object.keys(ajout.data).join(','));
rejouerEcritures();

// Une note datee d'hier (le cas de la sortie portugaise, notee le
// lendemain) sur un autre compte : il n'est PAS « utilise aujourd'hui ».
const hier = new Date(); hier.setDate(hier.getDate() - 1);
sandbox.comptes.find((c) => c.id === 'c1').journal = [
  { id: 'nh', date: { toDate: () => hier }, paiement: 'Carte Boursorama', texte: 'Commande Portugal' },
];
sandbox.render();
const htmlJournal = elements['fournisseurs-list'].innerHTML;
verifie('Le compte noté aujourd\'hui est marque comme utilise',
  /class="compte compte--utilise" id="compte-c2"/.test(htmlJournal));
verifie('Celui noté hier ne l\'est pas',
  /class="compte" id="compte-c1"/.test(htmlJournal));
verifie('Celui sans note non plus', /class="compte" id="compte-c3"/.test(htmlJournal));
verifie('La note du jour est affichee, avec le paiement du jour',
  htmlJournal.includes('journal-note--du-jour') && htmlJournal.includes('Carte Revolut'));
verifie('Le commentaire est echappe',
  htmlJournal.includes('&lt;b&gt;') && !htmlJournal.includes('coffret L\'Étoile <b>'));
const carteDe = (id) => (elements['fournisseurs-list'].innerHTML.split('id="compte-' + id + '"')[1] || '')
  .split('</article>')[0];
verifie('Un compte sans note n\'affiche pas de journal vide',
  carteDe('c3') !== '' && !carteDe('c3').includes('class="journal"'));

// Le glisser-deposer reecrit className : il ne doit pas effacer la marque.
sandbox.classerCarte('c2', 'compte--cible');
verifie('Le glisser-deposer conserve la marque « utilise »',
  elements['compte-c2'].className === 'compte compte--utilise compte--cible', elements['compte-c2'].className);
sandbox.classerCarte('c2', '');

// Au-dela de NOTES_VISIBLES, le reste se replie.
const compteBavard = sandbox.comptes.find((c) => c.id === 'd1');
compteBavard.journal = [1, 2, 3, 4, 5].map((j) => (
  { id: 'v' + j, date: { toDate: () => new Date(2026, 4, j, 10, 0) }, paiement: '', texte: 'sortie ' + j }));
verifie('Le journal est trie du plus recent au plus ancien',
  sandbox.journalDe(compteBavard).map((n) => n.id).join(',') === 'v5,v4,v3,v2,v1');
sandbox.render();
let carteBavarde = carteDe('d1');
verifie('Seules les trois plus recentes sont affichees',
  carteBavarde.includes('sortie 5') && carteBavarde.includes('sortie 3') && !carteBavarde.includes('sortie 2'));
verifie('...avec de quoi deplier les deux autres',
  carteBavarde.includes('+ 2 notes plus anciennes'));
sandbox.basculerJournal('d1');
carteBavarde = carteDe('d1');
verifie('Deplie, le journal montre tout', carteBavarde.includes('sortie 1') && carteBavarde.includes('Replier'));
sandbox.basculerJournal('d1');

// Modifier : la note est retrouvee par son id, et seule elle change.
const idNote = noteAjoutee.id;
sandbox.ouvrirModaleNote('c2', idNote);
verifie('Modifier recharge le paiement de la note, pas celui du compte',
  elements['fn-paiement'].value === 'Carte Revolut', elements['fn-paiement'].value);
verifie('...et propose Supprimer', elements['fn-supprimer'].style.display === '');
elements['fn-texte'].value = 'Sortie Portugal — finalement 3 rouleaux';
elements['fn-date'].value = '2026-10-07T09:02';
sandbox.comptes.find((c) => c.id === 'c2').journal.push(
  { id: 'autre', date: { toDate: () => neufHeures }, paiement: 'PayPal', texte: 'ne pas toucher' });
ecritures.length = 0;
sandbox.sauverNote();
const majNote = ecritures[0] && ecritures[0].data.journal;
verifie('Une modification reecrit le journal sans en changer la taille',
  Array.isArray(majNote) && majNote.length === 2, JSON.stringify(ecritures));
verifie('...ne change que la note visee',
  majNote.find((n) => n.id === idNote).texte === 'Sortie Portugal — finalement 3 rouleaux'
  && majNote.find((n) => n.id === 'autre').texte === 'ne pas toucher');
verifie('...et prend la date corrigee a la main',
  majNote.find((n) => n.id === idNote).date.toDate().getTime() === neufHeures.getTime());
rejouerEcritures();

// Une date effacee ne doit rien enregistrer.
sandbox.ouvrirModaleNote('c2', null);
elements['fn-date'].value = '';
ecritures.length = 0;
sandbox.sauverNote();
verifie('Sans date, rien ne part en base', ecritures.length === 0);
verifie('...et on le dit', /date/i.test(sandbox.toasts[sandbox.toasts.length - 1].message));
// Echap ferme la modale de note, comme les autres.
(ecouteurs.keydown || []).forEach((fn) => fn({ key: 'Escape' }));
verifie('Echap referme la modale de note', elements['modal-note'].style.display === 'none');

// Les suggestions de paiement apprennent aussi des notes.
sandbox.ouvrirModaleNote('c1', null);
verifie('Un paiement saisi dans une note est suggere ensuite',
  elements['paiement-list'].innerHTML.includes('Carte Revolut'));
sandbox.fermerModaleNote();

// La recherche voit le journal : « rouleaux » retrouve le fournisseur.
elements['search-input'].value = 'rouleaux';
sandbox.render();
verifie('La recherche porte aussi sur les notes du journal',
  nomsAffiches() === 'Monnaie de Paris', nomsAffiches());
elements['search-input'].value = '';
sandbox.render();

let souciJournal = null;
for (const m of elements['fournisseurs-list'].innerHTML.matchAll(/onclick="([^"]*)"/g)) {
  try { new vm.Script(decodeHtml(m[1])); } catch (e) { souciJournal = decodeHtml(m[1]) + ' :: ' + e.message; }
}
verifie('Les onclick du journal et de l\'etoile sont du JS valide', souciJournal === null, souciJournal);

// L'export garde le journal : c'est l'historique des sorties, il ne se
// reconstitue de nulle part ailleurs.
sandbox.exporterJson();
const exportJournal = JSON.parse(blobs.get(telechargements[telechargements.length - 1].href).parts[0]);
const journalExporte = exportJournal.fournisseurs.find((f) => f.nom === 'Monnaie de Paris').comptes
  .find((c) => c.email === 'autre@gmail.com').journal;
verifie('L\'export contient le journal, dates en ISO',
  journalExporte.length === 2 && journalExporte.every((n) => /^\d{4}-\d{2}-\d{2}T/.test(n.date)),
  JSON.stringify(journalExporte));
verifie('L\'export dit quel fournisseur est favori',
  exportJournal.fournisseurs.every((f) => typeof f.favori === 'boolean'));

// Supprimer : passe par la confirmation, et ne retire que cette note.
sandbox.ouvrirModaleNote('c2', idNote);
sandbox.ouvrirSuppressionNote();
verifie('Supprimer une note demande confirmation',
  elements['modal-suppression'].style.display === 'flex');
ecritures.length = 0;
sandbox.confirmerSuppression();
const apresSuppression = ecritures[0] && ecritures[0].data.journal;
verifie('La suppression ne retire que la note visee',
  Array.isArray(apresSuppression) && apresSuppression.length === 1 && apresSuppression[0].id === 'autre',
  JSON.stringify(ecritures));
verifie('...et ne supprime pas le compte',
  !ecritures.some((e) => e.type === 'delete'));

// --- Bilan -------------------------------------------------------
console.log('\n' + (echecs === 0 ? 'Tout passe.' : echecs + ' echec(s).'));
process.exit(echecs === 0 ? 0 : 1);
