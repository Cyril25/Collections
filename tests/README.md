# Tests du site Collections

```bash
node tests/run-tests.js
```

Sortie `0` si tout passe. Aucune installation : ni npm, ni framework, ni configuration —
juste Node. C'est délibéré, et c'est la même contrainte que le site lui-même, qui n'a pas
d'étape de build.

| Fichier | Ce qu'il protège |
|---|---|
| `test-achats.js` | Le suivi des achats : montants, statuts, retard, doublons, dates, échappement, export |
| `test-comptes.js` | Fournisseurs et comptes : assainissement des URL, non-fuite des mots de passe, révélation, copie, recherche, export |

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
