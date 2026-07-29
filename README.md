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
| Qu'est-ce que je dois encore ? | les lignes non réglées |
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
| `compteEmail` | string | Adresse du compte depuis lequel la commande a été passée |
| `paye` | bool | Réglé ou non. **Absent = dû** (voir plus bas) |
| `modePaiement` | string | Texte libre : PayPal, carte BNP, espèces… suggestions issues des saisies |
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

### Payé ou non — indépendant du statut

Recevoir et payer sont deux axes séparés, et les quatre combinaisons existent
vraiment : payé d'avance et jamais arrivé, arrivé et pas encore réglé, etc. D'où un
champ à part plutôt qu'un statut `paye` de plus, qui aurait forcé à choisir entre
« où en est le colis » et « où en est l'argent ».

Une commande `annule` n'est jamais due, quoi qu'il arrive. Tout le reste l'est tant
que la case n'est pas cochée — **y compris ce qui n'est pas encore arrivé** : sur
eBay ou Delcampe on paie à la commande, attendre ne dispense pas de régler.

Le mode de paiement est du **texte libre** : les suggestions se remplissent toutes
seules à partir des saisies précédentes, comme pour les collections et les vendeurs.
Rien à maintenir en dur, et la liste colle au vrai usage dès le troisième achat.

À l'écran, le paiement se lit **sous le montant** — « à payer » en ambre, ou le mode
de règlement — plutôt que dans une colonne à lui : c'est la même information et le
tableau a déjà huit colonnes.

> **⚠ Les lignes saisies avant l'arrivée de ce champ n'ont pas de `paye` du tout, et
> comptent donc comme dues.** C'est délibéré : un arriéré ne doit pas se cacher
> derrière un champ absent. Le bouton **€** de chaque ligne les règle en un clic,
> sans ouvrir la modale — le mode de paiement, lui, se saisit dans la modale et reste
> facultatif.

### Depuis quel compte — une adresse, pas une référence

`compteEmail` stocke **l'adresse en toutes lettres**, pas l'identifiant d'un document
de la collection `fournisseurs`. Une référence serait plus « propre » mais fragile :
supprimer un compte laisserait les achats pointer dans le vide. Une adresse reste
lisible et cherchable même après la disparition du compte, et c'est la même
convention que `collection`, `vendeur` ou `modePaiement`.

Les suggestions du champ viennent des **achats déjà saisis**, pas de la collection
`fournisseurs`. C'est délibéré : cette page-là porte des mots de passe, elle n'a rien
à faire en mémoire sur la page Achats. Le prix à payer est de taper l'adresse une
première fois — la page Comptes a un bouton *copier* pour ça.

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

## Modèle de données — collection `fournisseurs`

**Un seul tiroir pour deux choses**, discriminées par un champ `type` — même parti
pris que le projet Extérieur du hub :

| `type` | Champs |
|---|---|
| `fournisseur` | `nom` (obligatoire), `cle` (nom normalisé), `site`, `notes` |
| `compte` | `fournisseurId`, `libelle`, `email` (obligatoire), `identifiant`, `motDePasse`, `telephone`, `modePaiement`, `destinataire`, `rue`, `codePostal`, `ville`, `principal`, `notes` |

Le `modePaiement` d'un compte porte **le même vocabulaire** que celui d'une ligne
d'achat (« carte BNP », « PayPal ») : ici le moyen enregistré chez ce fournisseur, là
celui qui a réellement réglé la commande. Les deux se suggèrent depuis les saisies
précédentes, ce qui les fait converger sans contrainte.

L'adresse est **découpée** (destinataire / rue / CP / ville) plutôt que laissée en
texte libre, pour pouvoir la recomposer proprement — le bouton *copier* rend les trois
lignes prêtes à coller dans un formulaire de livraison. Une adresse à moitié remplie
rend ce qu'on en connaît, sans ligne vide au milieu.

Aucun de ces champs n'est obligatoire : une ligne absente ne s'affiche pas du tout,
plutôt que d'occuper la place avec un libellé vide.

Pourquoi pas une sous-collection `fournisseurs/{id}/comptes` : il faudrait un écouteur
par fournisseur, ou une requête `collectionGroup` avec son index — pour une poignée de
documents. Ici un seul `onSnapshot` alimente la page, et chercher « free.fr » retrouve
d'un coup le fournisseur chez qui cette adresse est utilisée.

`principal` est **unique par fournisseur** : cocher un compte décoche l'ancien dans le
même lot d'écriture, sinon deux comptes se disent principaux et l'étoile ne veut plus
rien dire. Le premier compte créé chez un fournisseur est principal par défaut.

Supprimer un fournisseur supprime **ses comptes avec lui**, dans un `batch`. Sans ça
ils resteraient orphelins : invisibles à l'écran, bien présents en base, mots de passe
inclus.

### Mots de passe : le risque assumé

Ils sont stockés **en clair**. Ce n'est pas un oubli, c'est un choix — voici ce qu'il
coûte, pour pouvoir le refaire en connaissance de cause :

- **Le compte Google devient la clé de tous les comptes fournisseurs.** Qui entre dans
  la session Google les lit tous depuis la console Firebase, sans passer par ce site.
  C'est le risque dominant, et il justifie à lui seul d'avoir la double
  authentification activée sur ce compte.
- **La CSP contient `'unsafe-inline'`** — inévitable, tout le hub fonctionne avec des
  `onclick`. Le code échappe soigneusement, mais en cas de XSS la CSP ne serait pas un
  second rempart.
- **L'export JSON les écrit en clair** dans le dossier Téléchargements, hors de toute
  règle Firestore. Le toast le rappelle au moment du clic.
- Google les stocke lisibles au niveau applicatif.

**Ce qu'on n'y met pas** : rien qui déplace de l'argent directement (banque, PayPal,
carte) ni un mot de passe réutilisé ailleurs. Un bandeau le rappelle en haut de la page.

Ce que le code fait quand même, et qui n'est pas rien :

| Mesure | Ce que ça protège |
|---|---|
| Le mot de passe n'est **jamais dans le HTML généré** — que des points ; la valeur arrive par `textContent` au clic | Le code source de la page, les captures d'écran, le DOM inspecté |
| Bouton **copier** à côté de l'œil | L'usage courant (coller dans le formulaire) sans rien afficher |
| **Re-masquage automatique** après 30 s | Le mot de passe révélé puis oublié à l'écran |
| Le mot de passe n'entre **pas dans la recherche** | Le confirmer par tâtonnement sans jamais l'afficher |
| `urlSure()` sur le champ Site | Un `javascript:` collé dans le champ deviendrait un lien exécutable sur une page qui a les mots de passe en mémoire |

> **L'œil est une protection contre le regard par-dessus l'épaule, pas une mesure de
> sécurité.** La valeur est en mémoire du navigateur dès le chargement de la page,
> masquée ou non.

Un chiffrement côté client (passphrase + Web Crypto) retirerait le risque principal,
au prix d'une phrase à retenir et d'une perte définitive en cas d'oubli. Mauvais
compromis ici : ce site existe justement parce qu'on oublie des choses.

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
| `index.html` / `achats.js` | Le suivi des achats — la page d'accueil |
| `comptes.html` / `comptes.js` | Fournisseurs et comptes (identifiants) |
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

Les règles vivent dans le dépôt du hub. Les blocs de ce site y sont déjà écrits — **il
y en a deux** :

```
match /achats/{document} {
  allow read, write: if aAcces('achats');
}

match /fournisseurs/{document} {
  allow read, write: if aAcces('fournisseurs');
}
```

Le second protège des mots de passe en clair : c'est la seule barrière entre eux et le
reste d'Internet. Ne jamais l'élargir « pour dépanner », et garder en tête qu'accorder
le projet `fournisseurs` à quelqu'un lui donne **tous** les identifiants — il n'y a pas
de demi-accès.

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
