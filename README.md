# Collections — `collections.ofildudoubs.fr`

Suivi des **achats** de collection : ce qui est commandé, ce qui est attendu, ce
qui a été dépensé, et ce qui traîne en double et pourrait se revendre.

Accès réservé à **cyril.samson41@gmail.com**.

## Le grain : une ligne d'achat, pas un objet

Un document = **une ligne d'achat** (« 3 exemplaires du n°42 payés 4 € pièce chez
Untel le 12 mars »), pas un objet possédé. C'est ce qui permet de répondre aux
quatre questions de départ sans avoir à construire d'inventaire :

| La question | Ce qui y répond |
|---|---|
| Qu'est-ce que j'ai commandé ? | les lignes |
| Qu'est-ce que j'attends ? | les lignes non reçues |
| Combien j'ai acheté ? | la somme des lignes |
| Qu'est-ce que j'ai en double ? | les lignes **reçues**, regroupées par article |

**Les doublons sont déduits, jamais saisis.** Deux lignes reçues portant le même
article donnent un doublon, et le surplus est valorisé au prix moyen payé. Le
regroupement se fait sur une forme normalisée du nom (sans accents, sans casse,
sans ponctuation) : sans ça, « Tintin - Objectif Lune » et « tintin objectif lune »
compteraient pour deux articles et aucun doublon ne sortirait jamais.

Le regroupement ignore volontairement la collection : une collection mal
orthographiée sur une des deux lignes ferait disparaître le doublon, ce qui est
précisément le cas qu'on cherche à rattraper.

> **La régularité d'écriture du nom est ce qui fait marcher la détection.** C'est
> la seule discipline demandée à la saisie, et l'avertissement « vous en avez déjà
> 2 » qui s'affiche pendant la frappe sert autant à repérer un doublon qu'à
> retrouver l'orthographe déjà utilisée.

## Modèle de données — collection `achats`

| Champ | Type | Détail |
|---|---|---|
| `article` | string | Obligatoire — ce qui a été acheté |
| `cle` | string | `article` normalisé, recalculé à chaque écriture — clé des doublons |
| `collection` | string | Texte libre, suggestions issues des saisies précédentes |
| `statut` | string | `commande` / `expedie` / `recu` / `probleme` / `annule` |
| `quantite` | int | ≥ 1 |
| `prixUnitaire` | number | € par exemplaire |
| `fraisPort` | number | € pour la ligne entière |
| `vendeur` | string | eBay, Delcampe, brocante… |
| `suivi` | string | N° de suivi |
| `notes` | string | Texte libre |
| `aRevendre` | bool | Marquage **manuel**, indépendant des doublons détectés |
| `dateCommande` | timestamp | Pré-remplie au jour du jour à la création |
| `dateReception` | timestamp | Posée automatiquement au passage en `recu` |
| `createdAt`, `updatedAt` | timestamp | Horodatage serveur |

### Les statuts, et ce qu'ils font aux totaux

| Statut | Attendu | Compté dans « Dépensé » |
|---|---|---|
| `commande` | oui | oui |
| `expedie` | oui | oui |
| `probleme` | oui | oui |
| `recu` | non | oui |
| `annule` | non | **non** |

`probleme` est **attendu** : un litige reste un colis qui n'est pas arrivé. Il est
en revanche exclu du calcul de retard — le problème est déjà signalé, inutile de le
doubler d'une alerte « à relancer ».

`annule` sort de tous les montants mais reste dans l'historique. D'où le texte de la
modale de suppression : pour une commande qui n'a pas abouti, passer en `annule`
plutôt que supprimer.

### Retard : 30 jours

Une ligne `commande` ou `expedie` dont la date de commande remonte à plus de
`SEUIL_RETARD_JOURS` (30) porte un badge « à relancer » et alimente la tuile rouge.
Seuil volontairement large : en collection, l'achat vient souvent de l'étranger ou
de particuliers, et trois semaines de silence n'ont rien d'anormal.

### Deux marquages « à revendre », et c'est voulu

- **Détecté** — la vue *Doublons* agrège les articles reçus en plusieurs
  exemplaires et estime le surplus. Automatique, jamais faux au sens comptable,
  mais aveugle à l'intention (on achète parfois deux exemplaires exprès).
- **Manuel** — la case `aRevendre`, pour tout le reste : la version abîmée, le lot
  acheté pour une seule pièce.

Le filtre *À revendre* ne montre que le second. La détection ne coche jamais la case
toute seule : une déduction ne doit pas se déguiser en décision.

### Pourquoi aucune barre de progression, aucun « % de la collection »

Il faudrait connaître le total d'une collection, ce qui est faux par nature. La page
montre des faits — dépensé, attendu, en retard, en double — pas une complétude
inventée.

## Architecture

Même stack que le [hub admin](https://github.com/Cyril25/Admin) : statique, sans
build, GitHub Pages, auth Google Firebase, données Firestore. **Même projet
Firebase** que le hub : une seule console, une seule liste de domaines autorisés,
un seul jeu de règles.

| Fichier | Rôle |
|---|---|
| `config.js` | Config Firebase (la même que le hub), emails autorisés, navigation |
| `auth.js` | Le vigile — copie de celui du hub |
| `hub-utils.js` | `toDate`, `formatDateFr`, `escapeAttr`, `jsAttr` — copie du hub |
| `login.html` | Page de connexion Google |
| `index.html` / `achats.js` | Le suivi des achats — l'unique page pour l'instant |
| `style.css` | Feuille de styles |
| `tests/` | Tests hors navigateur — `node tests/run-tests.js` |
| `CNAME` | Domaine custom GitHub Pages |

Le suivi des achats **est** l'accueil : une seule page, pas de clic inutile. Quand
l'inventaire arrivera, il prendra sa place dans `NAV_LINKS` et l'accueil redeviendra
une page à part entière.

`auth.js`, `hub-utils.js` et `style.css` sont des copies du hub — deux copies
coûtent moins cher qu'un mécanisme de partage sur une stack sans build. `style.css`
a en revanche déjà divergé : les classes `.idee-*` y ont été renommées en
`.data-table`, `.cell-*`, `.ligne--terne`, ce site n'ayant pas de page « idées ».
Ne pas reporter bêtement une correction du hub sur ce fichier sans regarder.

### ⚠ Règle Firestore à publier — sinon la page reste vide

Les règles vivent dans le dépôt du hub. Le bloc de cette collection y est déjà
écrit :

```
match /achats/{document} {
  allow read, write: if aAcces('achats');
}
```

**Il faut encore le publier** : console Firebase → Firestore Database → onglet
*Règles* → coller `firestore.rules` du dépôt Admin → *Publier*. Les règles ne se
déploient pas avec le site. Tant que ce n'est pas fait, la page s'affiche et le
tableau reste vide avec une erreur de permissions — c'est le catch-all `if false`
qui ferme toute collection non déclarée.

### Sauvegarde

Le plan gratuit de Firestore n'offre ni sauvegarde automatique ni restauration à un
instant T. Le bouton **Exporter** est la seule protection contre une suppression
malencontreuse : il exporte tout, filtres ignorés. À utiliser de temps en temps.

## Mise en place

1. **Firebase** — rien à créer : réutiliser le projet du hub.
   - **Authentication → Settings → Authorized domains** → ajouter
     `collections.ofildudoubs.fr`
   - **Firestore → Règles** → publier `firestore.rules` du dépôt Admin (voir ci-dessus)
2. **GitHub** — dépôt public `Cyril25/Collections`, puis **Settings → Pages** :
   branche `main`, dossier `/ (root)`. Le `CNAME` renseigne le domaine custom ;
   cocher **Enforce HTTPS** une fois le certificat émis.
3. **DNS OVH** — `ofildudoubs.fr` est géré chez OVH. Manager OVH → *Noms de domaine*
   → `ofildudoubs.fr` → **Zone DNS** → *Ajouter une entrée* :

   | Type | Sous-domaine | Cible |
   |---|---|---|
   | CNAME | `collections` | `cyril25.github.io.` |

## La suite

La vraie gestion des collections se construira **au-dessus de ces lignes**, pas à
côté : un objet possédé, c'est une ligne d'achat reçue. Pistes, dans l'ordre où
elles deviennent utiles :

1. **Inventaire** — une vue « ce que je possède » agrégée par article, avec les
   manques d'une collection (« il me manque les n° 12, 17, 23 »).
2. **Ventes** — un statut `vendu` et un prix de vente, pour boucler la boucle du
   surplus et savoir ce qu'une revente a rapporté.
3. **Photos** — via Cloudinary, comme le projet Extérieur du hub.
4. **Import** — reprise des historiques de commandes eBay / Delcampe, la saisie
   manuelle étant le vrai frein.

## Tests

```bash
node tests/run-tests.js
```

Aucune installation nécessaire. Voir `tests/README.md` pour ce qui est couvert — et
surtout pour ce qui ne l'est pas (les règles Firestore ne s'exécutent que chez Google).

## Développement local

```bash
python -m http.server 8080
# puis http://localhost:8080/login.html
```

`localhost` est déjà dans les domaines autorisés de Firebase.
