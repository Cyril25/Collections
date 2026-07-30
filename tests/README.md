# Tests du site Collections

```bash
node tests/run-tests.js
```

Sortie `0` si tout passe. Aucune installation : ni npm, ni framework, ni configuration —
juste Node. C'est délibéré, et c'est la même contrainte que le site lui-même, qui n'a pas
d'étape de build.

| Fichier | Ce qu'il protège |
|---|---|
| `test-acces.js` | Droit d'entrée, impersonation, et cohérence du slug de site avec le hub |
| `test-achats.js` | Le suivi des achats : montants, statuts, retard, doublons, dates, échappement, export |
| `test-comptes.js` | Fournisseurs et comptes : assainissement des URL, non-fuite des mots de passe, révélation, copie, ordre, recherche, export |

### `test-acces.js` — le slug de site, surtout

**La cohérence d'un seul mot entre trois fichiers de deux dépôts** : `SITE_SLUG` dans
`auth.js` d'ici, l'entrée de `sites.js` du hub, et l'argument de `aAccesSite()` dans
`firestore.rules`. Un slug qui diverge donne un site ouvert à personne — ou, selon l'endroit
où il diverge, une case qui semble cochée sans rien ouvrir. Dans les deux cas ça se
diagnostique mal, puisque tout *semble* configuré. Les assertions relisent les vrais
fichiers du dépôt Admin.

Le test vérifie aussi que **l'ancien modèle ne traîne plus** : plus de `aAcces('achats')` ni
de `aAcces('fournisseurs')` dans les règles, plus d'entrée correspondante dans le registre
des projets du hub, et plus de `aAcces()` ni de `projetsVisibles()` dans le vigile — les
laisser ferait croire à un filtrage par page qui n'existe plus.

**Le refus est explicite.** Un membre du hub sans la case Collections doit voir « ce compte
est bien membre, mais le site ne lui est pas ouvert », et non le message générique du
non-membre : sans cette distinction, il croit son compte inconnu et redemande une
inscription. Une fiche d'avant l'existence de `membres.sites` — champ absent — ne doit pas
ouvrir l'accès par accident.

Enfin, le garde-fou de l'impersonation : `estSuperadminReel()` ne doit **jamais** suivre
la fiche impersonnée. Sinon on pourrait se croire — et se comporter comme — superadmin en
regardant à travers les yeux d'un superadmin.

### `test-comptes.js` — deux choses le justifient à elles seules

**Le champ Site devient un `href`.** Un `javascript:…` collé dedans serait un lien
exécutable au clic, sur une page qui a les mots de passe en mémoire. `urlSure()` est la
seule chose entre les deux, et elle est testée sur `javascript:`, `JaVaScRiPt:`,
`data:` et `vbscript:`, plus les saisies normales (`mtm.mc` doit recevoir un `https://`,
sinon le lien part en relatif vers une page du site).

**Le mot de passe ne doit jamais entrer dans le HTML généré.** Le rendu ne pose que des
points ; la valeur arrive par `textContent` au clic sur l'œil. Si une modification
future le remettait dans `innerHTML`, il apparaîtrait dans le code source de la page,
dans les captures d'écran et dans le DOM inspecté — **sans que rien n'échoue**. Le test
vérifie l'absence de la chaîne dans `innerHTML`, y compris après un rafraîchissement
Firestore alors qu'il est révélé.

Le reste couvre l'unicité du compte principal, la suppression en cascade, et le fait
que la recherche ne porte pas sur les mots de passe — sinon on pourrait en confirmer un
par tâtonnement sans jamais l'afficher.

**La requête filtrée par propriétaire** — vérifiée sur les deux pages, `achats` et
`fournisseurs`. Une règle Firestore n'est pas un filtre : le
serveur rejette *en bloc* toute requête qui pourrait ramener un document interdit. Si
quelqu'un retire un jour le `where('proprietaire', ...)`, la page ne montrera pas une liste
partielle — elle sera entièrement vide, avec une erreur de permissions, alors que les
données sont bien là. Une heure de diagnostic pour une ligne. Un test vérifie donc le
filtre lui-même, sa valeur normalisée en minuscules, et le fait qu'il suit la personne
impersonnée. Trois autres relisent `firestore.rules` du dépôt Admin pour s'assurer que les
règles disent la même chose que le client suppose.

**Le glisser-déposer passe par un faux Firestore** qui capture les écritures : on
vérifie les rangs qui *partent réellement en base*, pas seulement l'ordre affiché. Le
réordonnancement n'a aucune autre trace, et un rang mal écrit ne se verrait qu'au
rechargement suivant. Les cas couverts : descendre, remonter, déposer sur le principal
(qui garde le rang 0), rangs contigus sans trou, dépôt sur soi-même et dépôt chez un
autre fournisseur — les deux derniers ne doivent rien écrire du tout.

### `test-achats.js` — où porte l'effort

**La détection des doublons.** C'est la seule chose du site qu'on ne peut pas vérifier en
regardant l'écran : elle regroupe sur une forme normalisée du nom (sans accents, sans
casse, sans ponctuation). Si le calcul de clé se casse, la liste se vide — et une liste
vide se lit « je n'ai pas de doublon », pas « la détection est en panne ». Rien n'échoue,
tout est faux. D'où les cas explicites : `Tintin - Objectif Lune`, `tintin  objectif lune`
et `Tintin, Objectif Lune !` doivent tomber sur la même clé.

Ensuite viennent les calculs qu'un coup d'œil ne rattrape pas :

- **Les montants.** `annule` sort des totaux, `probleme` y reste. Une erreur de signe ou
  de statut donne un « Dépensé » plausible mais faux.
- **Le champ `paye` absent.** Les lignes saisies avant l'arrivée du suivi de paiement
  n'ont pas le champ du tout. Elles doivent compter comme dues : si `undefined` était
  traité comme « réglé », un arriéré disparaîtrait derrière un champ manquant, et le
  total afficherait 0 € à payer sans que rien n'échoue. Un cas de test porte
  explicitement une ligne sans `paye`.
- **`nombre()`.** Un francophone tape `12,50`. Un `<input type="number">` rejette cette
  saisie en silence (`value` devient `''`), ce qui enregistrerait `0` sans prévenir : d'où
  le champ texte et son parser, testé sur virgule, point, espaces et texte libre.
- **L'aller-retour des dates.** `'2026-07-29'` seul est lu comme minuit UTC et s'affiche la
  veille dans tout fuseau à l'ouest de Greenwich. Le test vérifie que le jour survit au
  trajet `input → Timestamp → input`.
- **Le retard.** Un `probleme` de 70 jours ne doit pas porter « à relancer » : le litige est
  déjà signalé.
- **L'échappement.** Bug déjà rencontré sur le hub : une apostrophe dans un libellé
  (« L'Étoile mystérieuse ») cassait les `onclick` générés. Chaque `onclick` produit est
  décodé puis passé à l'analyseur JavaScript de Node.

## Comment ça marche

Il n'y a pas de navigateur. Le test charge les vrais fichiers du site (`hub-utils.js`,
`achats.js`) dans un contexte `vm` de Node, avec un DOM minimal simulé (juste
`getElementById`, `createElement`…), puis appelle les fonctions et vérifie le résultat.
Les assertions passent par une fonction maison `verifie(nom, condition, detail)`.

Charger `hub-utils.js` ici est ce qui fait échouer le test si `index.html` oublie la balise
`<script>` correspondante.

C'est rustique, mais ça teste le code réellement livré, sans le dupliquer.

## Ce que ces tests ne couvrent pas

**Les règles Firestore.** Elles ne s'exécutent que chez Google et ne peuvent pas être
rejouées ici. Pour les éprouver, utiliser le **Rules Playground** de la console Firebase.

**L'affichage.** Rien ne vérifie qu'une page est jolie ou même lisible ; les tests
regardent le HTML produit, pas son rendu.

**L'authentification.** `auth.js` n'est pas chargé : seules `escapeHtml` et `showToast`
sont recréées en deux lignes.

## Ajouter un test

Déposer un fichier `test-<sujet>.js` dans ce dossier : `run-tests.js` le ramasse tout seul.
Copier la structure de `test-achats.js` — le DOM simulé et la fonction `verifie()` s'y
trouvent en une trentaine de lignes.

Terminer par :

```js
process.exit(echecs === 0 ? 0 : 1);
```
