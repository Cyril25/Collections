// ============================================================
// test-achats.js — Le suivi des achats
// ============================================================
// Charge achats.js avec un DOM minimal simule et verifie ce qui n'est
// pas visible a l'oeil nu : les totaux, la detection des doublons, le
// calcul de retard, l'aller-retour des dates et l'echappement.
//
// Lancer :  node tests/test-achats.js
//
// La detection des doublons est la seule chose de ce site qu'on ne peut
// pas verifier en regardant l'ecran : elle regroupe sur une forme
// normalisee du nom. Si elle se trompe, on ne le voit pas — on ne voit
// qu'une liste vide, qu'on prend pour « je n'ai pas de doublon ».
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');

// --- DOM minimal -------------------------------------------------
const elements = {};
function fakeEl(id) {
  return {
    id, value: '', innerHTML: '', textContent: '', checked: false, style: {},
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

// Faux Firestore : on veut verifier ce qui PART EN BASE et avec quel
// filtre. Une requete non filtree serait rejetee en bloc par les regles.
const ecritures = [];
const requetes = [];
const fauxDb = {
  batch() {
    const operations = [];
    return {
      update(ref, data) { operations.push({ type: 'update', id: ref.id, data }); },
      commit() { operations.forEach((o) => ecritures.push(o)); return Promise.resolve(); },
    };
  },
  collection() {
    return {
      doc(id) {
        const reference = id || 'nouveau-doc';
        return {
          id: reference,
          update(data) { ecritures.push({ type: 'update', id: reference, data }); return Promise.resolve(); },
        };
      },
      add(data) { ecritures.push({ type: 'add', data }); return Promise.resolve({ id: 'nouveau-doc' }); },
      onSnapshot() {},
      where(champ, operateur, valeur) {
        requetes.push({ champ, operateur, valeur });
        return { onSnapshot() {} };
      },
      get: () => Promise.resolve({ forEach() {} }),
    };
  },
};
const firebase = {
  firestore: Object.assign(() => fauxDb, {
    Timestamp: { fromDate: (d) => ({ toDate: () => d, __ts: true }) },
    FieldValue: { serverTimestamp: () => ({ __serveur: true }) },
  }),
};

const sandbox = {
  document, console, JSON, Date, Math, Number, String, Object, Array, parseFloat, parseInt, isNaN,
  Blob: FakeBlob, URL: FakeURL, firebase,
  window: { location: { pathname: '/index.html', search: '', hostname: 'collections.ofildudoubs.fr' } },
};
sandbox.window.document = document;
vm.createContext(sandbox);

// escapeHtml / showToast viennent de auth.js : on ne charge que ce qu'il faut.
vm.runInContext(`
  function escapeHtml(t){ var d=document.createElement('div'); d.appendChild(document.createTextNode(t==null?'':t)); return d.innerHTML; }
  function showToast(){}
`, sandbox);
// hub-utils.js fournit toDate / formatDateFr / escapeAttr / jsAttr. Le
// charger ici est ce qui fait echouer ce test si index.html oublie la
// balise <script> correspondante.
vm.runInContext(fs.readFileSync(path.join(RACINE, 'hub-utils.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'achats.js'), 'utf8'), sandbox);

// --- Donnees factices --------------------------------------------
const ts = (d) => ({ toDate: () => d });
const ilYA = (jours) => ts(new Date(Date.now() - jours * 86400000));

sandbox.achats = [
  // Deux receptions du meme article, ecrites differemment : un doublon.
  { id: 'a1', article: "Tintin - Objectif Lune", collection: 'BD', statut: 'recu',
    quantite: 1, prixUnitaire: 20, fraisPort: 5, vendeur: 'eBay',
    dateCommande: ilYA(90), dateReception: ilYA(80), paye: true, modePaiement: 'PayPal' },
  { id: 'a2', article: "tintin  objectif lune", collection: 'BD', statut: 'recu',
    quantite: 1, prixUnitaire: 30, fraisPort: 0, vendeur: 'Brocante',
    dateCommande: ilYA(60), dateReception: ilYA(58), paye: true, modePaiement: 'Espèces' },
  // Article unique recu. Champ « paye » ABSENT : c'est une ligne saisie
  // avant l'arrivee du suivi de paiement, elle doit compter comme due.
  { id: 'a3', article: 'Fève Roi Soleil', collection: 'Fèves', statut: 'recu',
    quantite: 1, prixUnitaire: 3, fraisPort: 0, vendeur: 'Delcampe',
    dateCommande: ilYA(40), dateReception: ilYA(35) },
  // Attendu depuis longtemps : en retard. Paye a la commande, comme sur eBay.
  { id: 'a4', article: "L'Étoile mystérieuse", collection: 'BD', statut: 'commande',
    quantite: 1, prixUnitaire: 15, fraisPort: 4, vendeur: 'eBay',
    dateCommande: ilYA(45), paye: true, modePaiement: 'Carte BNP' },
  // Attendu, recent : pas en retard. Futur doublon, et pas encore regle.
  { id: 'a5', article: 'Tintin, Objectif Lune !', collection: 'BD', statut: 'expedie',
    quantite: 1, prixUnitaire: 25, fraisPort: 0, vendeur: 'Delcampe',
    dateCommande: ilYA(5), paye: false },
  // Annule : sorti des montants ET de ce qui reste a payer.
  { id: 'a6', article: 'Lot de doubles', collection: 'BD', statut: 'annule',
    quantite: 10, prixUnitaire: 100, fraisPort: 50, vendeur: 'eBay',
    dateCommande: ilYA(20) },
  // Litige : attendu, compte dans le depense, mais pas « a relancer ».
  { id: 'a7', article: 'Vinyle rare', collection: 'Vinyles', statut: 'probleme',
    quantite: 2, prixUnitaire: 40, fraisPort: 10, vendeur: 'Discogs',
    dateCommande: ilYA(70), aRevendre: true, paye: true, modePaiement: 'Virement' },
];
sandbox.premierChargement = false;
// onHubReady() n'est pas appele hors navigateur : on branche le faux
// Firestore et l'etat que auth.js aurait rempli.
sandbox.db = fauxDb;
sandbox.HUB = {
  user: { email: 'Cyril.Samson41@Gmail.com' },
  membre: { email: 'cyril.samson41@gmail.com', role: 'superadmin' },
  effectif: { email: 'cyril.samson41@gmail.com', role: 'superadmin' },
  impersonation: '',
};
sandbox.normaliserEmail = (e) => String(e || '').trim().toLowerCase();
sandbox.estSuperadminReel = () => true;
sandbox.proprietaireVu = 'cyril.samson41@gmail.com';

let echecs = 0;
function verifie(nom, condition, detail) {
  if (condition) { console.log('  ok   ' + nom); }
  else { console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); echecs++; }
}

// --- 1. Montants -------------------------------------------------
console.log('\n1. Montants');
verifie('Total ligne = qte x PU + port',
  sandbox.totalLigne(sandbox.achats[0]) === 25, sandbox.totalLigne(sandbox.achats[0]));
verifie('Total ligne avec quantite > 1',
  sandbox.totalLigne(sandbox.achats[6]) === 90, sandbox.totalLigne(sandbox.achats[6]));
verifie('Ligne vide ne casse rien',
  sandbox.totalLigne({}) === 0);

// « 12,50 » est ce que tape un francophone : le parser doit l'accepter,
// sinon la saisie enregistre 0 sans prevenir.
verifie('nombre() accepte la virgule', sandbox.nombre('12,50') === 12.5, sandbox.nombre('12,50'));
verifie('nombre() accepte le point', sandbox.nombre('12.50') === 12.5);
verifie('nombre() ignore les espaces', sandbox.nombre(' 1 234,5 ') === 1234.5, sandbox.nombre(' 1 234,5 '));
verifie('nombre() renvoie 0 sur du texte', sandbox.nombre('abc') === 0);
verifie('nombre() renvoie 0 sur vide', sandbox.nombre('') === 0);

// --- 2. Statuts et attente ---------------------------------------
console.log('\n2. Statuts');
verifie('« commande » est attendu', sandbox.estAttendu({ statut: 'commande' }) === true);
verifie('« expedie » est attendu', sandbox.estAttendu({ statut: 'expedie' }) === true);
verifie('« probleme » est attendu (un litige reste un colis absent)',
  sandbox.estAttendu({ statut: 'probleme' }) === true);
verifie('« recu » n\'est plus attendu', sandbox.estAttendu({ statut: 'recu' }) === false);
verifie('« annule » n\'est pas attendu', sandbox.estAttendu({ statut: 'annule' }) === false);

// --- 3. Retard ---------------------------------------------------
console.log('\n3. Retard');
verifie('Commande de 45 j est en retard', sandbox.estEnRetard(sandbox.achats[3]) === true);
verifie('Expedition de 5 j ne l\'est pas', sandbox.estEnRetard(sandbox.achats[4]) === false);
verifie('Un « probleme » de 70 j n\'est pas signale « a relancer »',
  sandbox.estEnRetard(sandbox.achats[6]) === false);
verifie('Un article recu n\'est jamais en retard', sandbox.estEnRetard(sandbox.achats[0]) === false);
verifie('Sans date de commande, pas de retard',
  sandbox.estEnRetard({ statut: 'commande' }) === false);

// --- 4. Paiement -------------------------------------------------
console.log('\n4. Paiement');
// Le cas qui compte : les lignes saisies AVANT l'arrivee du champ n'ont
// pas de « paye » du tout. Elles doivent compter comme dues, sinon un
// arriere se cache derriere un champ absent.
verifie('Une ligne sans champ « paye » est due', sandbox.estAPayer(sandbox.achats[2]) === true);
verifie('« paye: false » est du', sandbox.estAPayer(sandbox.achats[4]) === true);
verifie('« paye: true » n\'est plus du', sandbox.estAPayer(sandbox.achats[0]) === false);
// Une commande annulee ne se doit plus, meme jamais reglee.
verifie('Une ligne annulee n\'est jamais due', sandbox.estAPayer(sandbox.achats[5]) === false);
// Payer a la commande est la norme sur eBay : attendre n'est pas devoir.
verifie('Un colis attendu peut etre deja regle', sandbox.estAPayer(sandbox.achats[3]) === false);

// --- 5. Doublons -------------------------------------------------
console.log('\n5. Doublons');
verifie('cleArticle enleve accents, casse et ponctuation',
  sandbox.cleArticle("L'Étoile  mystérieuse !") === 'l etoile mysterieuse',
  sandbox.cleArticle("L'Étoile  mystérieuse !"));
verifie('Deux ecritures du meme titre donnent la meme cle',
  sandbox.cleArticle('Tintin - Objectif Lune') === sandbox.cleArticle('tintin  objectif lune'));

const doublons = sandbox.calculerDoublons();
verifie('Un seul article en doublon', doublons.length === 1, doublons.length + ' trouves');
verifie('2 exemplaires comptes', doublons[0] && doublons[0].exemplaires === 2);
verifie('1 exemplaire en trop', doublons[0] && doublons[0].surplus === 1);
// Prix moyen hors port : (20 + 30) / 2 = 25. Le port ne se revend pas.
verifie('Surplus valorise au prix moyen HORS port',
  doublons[0] && doublons[0].valeurSurplus === 25, doublons[0] && doublons[0].valeurSurplus);
verifie('L\'article en route ne compte PAS comme doublon possede',
  doublons[0] && doublons[0].lignes.length === 2, doublons[0] && doublons[0].lignes.length);

const presentes = sandbox.clesEnCollection();
verifie('L\'article encore en route est signale « deja en collection »',
  presentes[sandbox.cleDe(sandbox.achats[4])] === 2,
  presentes[sandbox.cleDe(sandbox.achats[4])]);
verifie('Un article jamais recu n\'est pas signale',
  !presentes[sandbox.cleArticle('Objet inconnu')]);

// --- 6. Bandeau de chiffres --------------------------------------
console.log('\n6. Bandeau de chiffres');
sandbox.renderStats();
const stats = elements['stats'].innerHTML;
const valeurs = [...stats.matchAll(/<div class="stat-valeur">([^<]*)<\/div>/g)].map((m) => m[1]);
// Depense = tout sauf a6 (annule) : 25 + 30 + 3 + 19 + 25 + 90 = 192
verifie('« Dépensé » exclut les annulations', /192/.test(valeurs[0]), valeurs[0]);
// A payer = a3 (3) + a5 (25) = 28 ; a6 annule ne compte pas malgre ses 1050
verifie('« À payer » somme les lignes dues, annulations exclues',
  /28/.test(valeurs[1]) && !/1050/.test(valeurs[1]), valeurs[1]);
// Attendus : a4, a5, a7
verifie('« En attente » compte 3 lignes', valeurs[2] === '3', valeurs[2]);
// En retard : a4 seulement
verifie('« En retard » compte 1 ligne', valeurs[3] === '1', valeurs[3]);
// Recus : a1 + a2 + a3 = 3 exemplaires
verifie('« Reçu » compte 3 exemplaires', valeurs[4] === '3', valeurs[4]);
verifie('« En double » compte 1 exemplaire en trop', valeurs[5] === '1', valeurs[5]);
verifie('La tuile « En retard » passe en alerte', /stat--alerte/.test(stats));
verifie('La tuile « À payer » s\'allume tant qu\'il reste un du',
  /stat--impaye/.test(stats));

// --- 7. Filtres --------------------------------------------------
console.log('\n7. Filtres');
sandbox.filtreStatut = 'attendus';
verifie('Filtre par defaut : les 3 lignes attendues',
  sandbox.getAchatsFiltres('').length === 3, sandbox.getAchatsFiltres('').length);

sandbox.filtreStatut = 'retard';
verifie('Filtre « en retard »', sandbox.getAchatsFiltres('').length === 1);

sandbox.filtreStatut = 'revendre';
verifie('Filtre « a revendre » ne montre que le marquage manuel',
  sandbox.getAchatsFiltres('').length === 1);

sandbox.filtreStatut = 'apayer';
verifie('Filtre « a payer » : la ligne sans champ et la ligne a false',
  sandbox.getAchatsFiltres('').length === 2, sandbox.getAchatsFiltres('').length);

sandbox.filtreStatut = 'tous';
verifie('« Tout » montre les 7 lignes, annulation comprise',
  sandbox.getAchatsFiltres('').length === 7);

sandbox.filtreCollection = 'BD';
verifie('Filtre par collection', sandbox.getAchatsFiltres('').length === 5,
  sandbox.getAchatsFiltres('').length);
sandbox.filtreCollection = 'toutes';

sandbox.filtreStatut = 'tous';
verifie('Recherche insensible a la casse', sandbox.getAchatsFiltres('discogs').length === 1);
verifie('La recherche porte aussi sur les notes et le vendeur',
  sandbox.getAchatsFiltres('brocante').length === 1);
verifie('La recherche porte sur le mode de paiement',
  sandbox.getAchatsFiltres('carte bnp').length === 1, sandbox.getAchatsFiltres('carte bnp').length);

// --- 8. Dates <input type="date"> --------------------------------
console.log('\n8. Dates');
// Le piege : « 2026-07-29 » seul est lu comme minuit UTC et affiche la
// veille dans tout fuseau a l'ouest de Greenwich.
const allerRetour = sandbox.inputDepuisDate(sandbox.dateDepuisInput('2026-07-29'));
verifie('Aller-retour input -> Timestamp -> input conserve le jour',
  allerRetour === '2026-07-29', allerRetour);
verifie('Le 1er janvier garde ses zeros',
  sandbox.inputDepuisDate(sandbox.dateDepuisInput('2026-01-01')) === '2026-01-01');
verifie('Une date vide reste vide', sandbox.dateDepuisInput('') === null);
verifie('Une date absente rend une chaine vide', sandbox.inputDepuisDate(null) === '');

// --- 9. Echappement ----------------------------------------------
console.log('\n9. Echappement');
// Bug reel deja rencontre sur le hub : une apostrophe dans un libelle
// cassait les onclick generes. Ici « L'Étoile mystérieuse » et les
// collections saisies a la main sont exactement ce cas.
verifie('jsAttr protege l\'apostrophe pour JS', sandbox.jsAttr("L'Étoile") === "L\\'Étoile");
verifie('jsAttr protege le guillemet pour HTML', sandbox.jsAttr('a"b') === 'a&quot;b');

const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function onclicksValides(html) {
  for (const m of html.matchAll(/onclick="([^"]*)"/g)) {
    try { new vm.Script(decodeHtml(m[1])); }
    catch (e) { return decodeHtml(m[1]) + ' :: ' + e.message; }
  }
  return null;
}

sandbox.filtreStatut = 'tous';
sandbox.render();
let souci = onclicksValides(elements['achats-list'].innerHTML);
verifie('Tous les onclick du tableau sont du JS valide apres decodage', souci === null, souci);
souci = onclicksValides(elements['statut-filter'].innerHTML);
verifie('Tous les onclick des filtres statut sont valides', souci === null, souci);
souci = onclicksValides(elements['collection-filter'].innerHTML);
verifie('Tous les onclick des filtres collection sont valides', souci === null, souci);

sandbox.filtreStatut = 'doublons';
sandbox.render();
souci = onclicksValides(elements['achats-list'].innerHTML);
verifie('Tous les onclick de la vue doublons sont valides', souci === null, souci);

// --- 10. Rendu ---------------------------------------------------
console.log('\n10. Rendu');
verifie('La vue doublons affiche le titre de l\'article',
  elements['achats-list'].innerHTML.includes('Tintin'), 'titre absent');
verifie('La vue doublons annonce le surplus',
  /\+1</.test(elements['achats-list'].innerHTML));

sandbox.filtreStatut = 'attendus';
sandbox.render();
const tableau = elements['achats-list'].innerHTML;
verifie('Le badge « a relancer » apparait sur la commande de 45 j',
  tableau.includes('a relancer') || tableau.includes('à relancer'), 'badge absent');
verifie('Le badge « deja en collection » apparait sur le futur doublon',
  tableau.includes('en collection'), 'badge absent');
verifie('Le compteur annonce des lignes et un montant',
  /ligne/.test(elements['result-count'].textContent), elements['result-count'].textContent);

sandbox.filtreStatut = 'tous';
sandbox.render();
const complet = elements['achats-list'].innerHTML;
verifie('Une ligne due porte la mention « a payer » sous le montant',
  /cell-sous--impaye/.test(complet), 'mention absente');
verifie('Une ligne reglee affiche son mode de paiement',
  complet.includes('PayPal') && complet.includes('Carte BNP'), 'mode absent');
verifie('Le bouton de bascule est present sur les lignes reglees comme dues',
  (complet.match(/basculerPaiement/g) || []).length === 6,
  (complet.match(/basculerPaiement/g) || []).length + ' boutons');
// On isole la vraie ligne du tableau plutot que de fenetrer sur N
// caracteres : une fenetre trop courte passerait par accident.
const ligneAnnulee = complet.split('<tr').find((tr) => tr.includes('Lot de doubles'));
verifie('La ligne annulee est bien rendue', !!ligneAnnulee);
verifie('Aucune bascule de paiement sur une ligne annulee',
  !!ligneAnnulee && !ligneAnnulee.includes('basculerPaiement'), 'bascule presente sur l\'annulee');
verifie('Ni mention « a payer » sur une ligne annulee',
  !!ligneAnnulee && !ligneAnnulee.includes('cell-sous--impaye'));

// --- 11. Cloisonnement par proprietaire --------------------------
console.log('\n11. Cloisonnement par proprietaire');

// LE test qui compte. Les regles ne laissent lire que ses propres lignes,
// et Firestore rejette EN BLOC une requete qui pourrait ramener un
// document interdit. Sans `where`, la page n'est pas partielle : elle est
// vide, avec une erreur de permissions, alors que les lignes sont la.
requetes.length = 0;
sandbox.onHubReady();
verifie('L\'ecoute filtre sur le proprietaire',
  requetes.some((r) => r.champ === 'proprietaire' && r.operateur === '=='),
  JSON.stringify(requetes));
verifie('L\'email du filtre est normalise en minuscules',
  requetes[0] && requetes[0].valeur === 'cyril.samson41@gmail.com', requetes[0] && requetes[0].valeur);

// Sous impersonation, on regarde les achats de l'AUTRE : sinon la vue ne
// montre pas ce que l'autre voit.
requetes.length = 0;
sandbox.HUB.effectif = { email: 'marie@gmail.com', role: 'membre', projets: ['achats'] };
sandbox.HUB.impersonation = 'marie@gmail.com';
sandbox.onHubReady();
verifie('Sous impersonation, on lit les achats de la personne regardee',
  requetes[0] && requetes[0].valeur === 'marie@gmail.com', requetes[0] && requetes[0].valeur);

// Une ligne creee porte son proprietaire, sans quoi elle serait invisible
// des le rechargement suivant — et absente de tous les totaux.
ecritures.length = 0;
sandbox.idEnEdition = null;
document.getElementById('f-article').value = 'Fève n°42';
document.getElementById('f-collection').value = 'Fèves';
document.getElementById('f-statut').value = 'commande';
document.getElementById('f-quantite').value = '1';
document.getElementById('f-prix').value = '3,50';
document.getElementById('f-port').value = '';
document.getElementById('f-vendeur').value = 'Delcampe';
document.getElementById('f-suivi').value = '';
document.getElementById('f-notes').value = '';
document.getElementById('f-paiement').value = '';
document.getElementById('f-compte').value = '';
document.getElementById('f-date-commande').value = '2026-07-30';
document.getElementById('f-date-reception').value = '';
sandbox.sauverAchat();
const creation = ecritures.find((e) => e.type === 'add');
verifie('Une ligne creee porte un proprietaire',
  !!creation && creation.data.proprietaire === 'marie@gmail.com',
  creation && creation.data.proprietaire);
// Tracabilite : l'utilisateur REEL, pas l'impersonne.
verifie('...et « creePar » nomme l\'utilisateur reel',
  !!creation && creation.data.creePar === 'cyril.samson41@gmail.com',
  creation && creation.data.creePar);

// Modifier ne doit jamais reecrire le proprietaire.
ecritures.length = 0;
sandbox.idEnEdition = 'a1';
sandbox.sauverAchat();
const maj = ecritures.find((e) => e.type === 'update');
verifie('Une modification ne touche pas au proprietaire',
  !!maj && !('proprietaire' in maj.data), maj && Object.keys(maj.data).join(','));
sandbox.idEnEdition = null;

// Les regles publiees doivent dire ce que le client suppose.
const blocAchats = fs.readFileSync(
  path.join(RACINE, '..', 'Admin', 'firestore.rules'), 'utf8')
  .split('match /achats/')[1].split('match /')[0];
verifie('Les regles du hub cloisonnent les achats par proprietaire',
  /resource\.data\.proprietaire == idAppelant\(\)/.test(blocAchats),
  'le bloc match /achats ne filtre pas par proprietaire');
verifie('...et interdisent de changer le proprietaire d\'une ligne',
  /request\.resource\.data\.proprietaire == resource\.data\.proprietaire/.test(blocAchats));
verifie('...et exigent un proprietaire a la creation',
  /request\.resource\.data\.proprietaire == idAppelant\(\)/.test(blocAchats));
// L'ancienne regle ouverte ne doit plus traîner.
verifie('L\'ancien « read, write » global a disparu',
  !/allow read, write: if aAcces\('achats'\)/.test(blocAchats));

// Remise en etat pour la suite du fichier.
sandbox.HUB.effectif = sandbox.HUB.membre;
sandbox.HUB.impersonation = '';
sandbox.proprietaireVu = 'cyril.samson41@gmail.com';

// --- 12. Export --------------------------------------------------
console.log('\n12. Export');
sandbox.exporterJson();
verifie('Un fichier est bien telecharge', telechargements.length === 1);
const contenu = JSON.parse(blobs.get(telechargements[0].href).parts[0]);
verifie('L\'export ignore les filtres et prend TOUT',
  contenu.nombre === 7, contenu.nombre + ' lignes exportees');
verifie('Les horodatages sortent en ISO',
  typeof contenu.achats[0].dateCommande === 'string'
  && contenu.achats[0].dateCommande.includes('T'), contenu.achats[0].dateCommande);
verifie('Le total de chaque ligne est calcule dans l\'export',
  contenu.achats.some((a) => a.total > 0));
verifie('L\'export porte le paiement et son mode',
  contenu.achats.some((a) => a.paye === true && a.modePaiement === 'PayPal')
  && contenu.achats.some((a) => a.paye === false), 'paiement absent de l\'export');
verifie('Le nom de fichier est date',
  /^achats-collections-\d{4}-\d{2}-\d{2}\.json$/.test(telechargements[0].download),
  telechargements[0].download);

// --- Bilan -------------------------------------------------------
console.log('\n' + (echecs === 0 ? 'Tout passe.' : echecs + ' echec(s).'));
process.exit(echecs === 0 ? 0 : 1);
