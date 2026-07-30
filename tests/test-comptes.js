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
console.log('\n11. Export');
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
// L'export est une sauvegarde : incomplet, il ne servirait a rien.
const mdp = contenu.fournisseurs
  .find((f) => f.nom === 'Monnaie de Paris').comptes
  .find((c) => c.email === 'cyril.samson@free.fr').motDePasse;
verifie('Les mots de passe sont bien dans l\'export',
  mdp === 'A<b>Str0ng&Pass', 'sauvegarde incomplete : ' + mdp);
// ...mais le fichier doit le dire, il sort de toute regle Firestore.
verifie('L\'export porte les coordonnees et l\'adresse',
  contenu.fournisseurs.find((f) => f.nom === 'Monnaie de Paris').comptes
    .some((c) => c.telephone === '06 12 34 56 78' && c.ville === 'Besançon'
              && c.modePaiement === 'Carte Boursorama'), 'coordonnees absentes de l\'export');
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
