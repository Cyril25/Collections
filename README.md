# Collections — `collections.ofildudoubs.fr`

Suivi des **achats** de collection : ce qui est commandé, ce qui est attendu, ce
qui a été dépensé, et ce qui traîne en double et pourrait se revendre. Plus un carnet
des **comptes fournisseurs**.

## Les accès viennent du hub, ils ne se créent pas ici

Ce site partage **le même projet Firebase et le même annuaire `membres`** que le
[hub admin](https://github.com/Cyril25/Admin). Il n'a donc ni liste d'emails, ni page de
gestion des membres : il lit la fiche de la personne connectée et obéit.

Les deux droits qu'il consomme portent les mêmes slugs partout — dans `membres.projets`,
dans `firestore.rules` et dans le `projets.js` des deux dépôts :

| Slug | Page | Ce que le droit ouvre | Portée |
|---|---|---|---|
| `achats` | `index.html` | Le suivi des achats | Commun **pour l'instant** — doit être cloisonné, voir plus bas |
| `fournisseurs` | `comptes.html` | Fournisseurs et identifiants | **Cloisonné** — chacun ne voit que ses propres fiches |

**Donner un accès se fait sur la page Membres du hub**, en cochant la case du projet.
C'est le seul endroit qui écrit dans `membres.projets`, et c'est voulu : un droit qui se
donnerait depuis deux écrans finirait par diverger.

Les deux droits n'ont pas la même portée, et c'est la différence qui compte : cocher
`fournisseurs` ouvre **la page**, pas les comptes des autres. Voir « Chacun chez soi »
plus bas.

Un membre qui a des droits sur le hub mais aucun ici voit un message qui l'explique, pas
une page blanche. L'accueil de ce site **est** une page à droits (`achats`), donc la
garde ne renvoie jamais vers lui aveuglément : elle va vers la première page permise, ou
affiche le refus s'il n'y en a aucune. Rediriger sans cette précaution produirait une
boucle infinie que rien ne signalerait — l'onglet tournerait, sans erreur.

### Impersonation

Le sélecteur en haut à droite (superadmin uniquement) affiche le site tel que le voit la
personne choisie : menu, garde des pages et refus suivent ses droits. Un bandeau rayé le
rappelle en permanence, et ça meurt avec l'onglet (`sessionStorage`).

Il y a un sélecteur **ici en plus de celui du hub** parce que le `sessionStorage` est
cloisonné par origine : impersonner quelqu'un sur `admin.ofildudoubs.fr` ne change rien
sur `collections.ofildudoubs.fr`.

**C'est un aperçu d'interface, pas un bac à sable.** Les requêtes partent toujours avec
le jeton du superadmin : Firestore continue de tout autoriser. On voit ce que l'autre
verrait, on ne subit pas ses restrictions — donc ça ne sert pas à tester les règles. Pour
ça, le *Rules Playground* de la console Firebase.

## Le grain : une ligne d'achat, pas un objet

Un document = **une ligne d'achat** (« 3 exemplaires de la fève n°42 payés 4 € pièce
chez Untel le 12 mars »), pas un objet possédé. C'est ce qui permet de répondre aux
quatre questions de départ sans avoir à construire d'inventaire :

| La question | Ce qui y répond |
|---|---|
| Qu'est-ce que j'ai commandé ? | les lignes |
| Qu'est-ce que j'attends ? | les lignes non reçues |
| Combien j'ai acheté ? | la somme des lignes |
| Qu'est-ce que je dois encore ? | les lignes non réglées |
| Qu'est-ce que j'ai en double ? | les lignes **reçues**, regroupées par article |

**Les doublons sont déduits, jamais saisis.** Deux lignes reçues portant le même
article donnent un doublon, et le surplus est valorisé au prix moyen payé.

Le regroupement se fait sur **le nom de l'article**, jamais sur l'identifiant du
document — chaque document a le sien, unique par construction, deux lignes n'ont donc
jamais le même. Ce qui est comparé, c'est ce qui a été tapé dans le champ *Article*
(« fève n°42 », « 2 € commémorative 2024 »), sous une forme normalisée : sans accents,
sans casse, sans ponctuation. Sans cette normalisation, « Tintin - Objectif Lune » et
« tintin objectif lune » compteraient pour deux articles et aucun doublon ne sortirait
jamais.

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
| `compte` | `fournisseurId`, `libelle`, `email` (obligatoire), `identifiant`, `motDePasse`, `telephone`, `modePaiement`, `destinataire`, `rue`, `codePostal`, `ville`, `principal`, `ordre`, `notes` |

Les deux types portent en plus `proprietaire` (email du détenteur), `creePar` (email de
l'utilisateur **réel**) et les horodatages.

### Chacun chez soi

`proprietaire` est ce qui rend la page utilisable à plusieurs : les règles Firestore ne
laissent voir que ses propres fiches, et le droit `fournisseurs` ouvre donc la page, pas
les identifiants des autres.

Trois conséquences qui ne se devinent pas :

**La requête doit être filtrée, et ce n'est pas une optimisation.** Une règle Firestore
n'est pas un filtre : le serveur rejette **en bloc** toute requête qui pourrait ramener un
document interdit. La page interroge donc
`where('proprietaire', '==', <son email>)`. Sans ce `where`, elle n'afficherait pas une
liste partielle — elle serait entièrement vide, avec une erreur de permissions, alors que
les données sont bien là. C'est le genre de panne qu'on met une heure à comprendre, d'où
un test qui verrouille la présence du filtre.

**Le champ est dupliqué sur les comptes**, pas seulement sur les fournisseurs. Les règles
s'évaluent document par document : sans lui, chaque lecture d'un compte demanderait un
`get()` sur son fournisseur parent. Le compte hérite du propriétaire de son fournisseur à
la création, et `proprietaire` est ensuite **immuable** — les règles interdisent de le
réécrire, sinon un membre pourrait pousser une fiche chez quelqu'un d'autre.

**Le superadmin ne fait pas exception : il voit ses propres fiches.** C'est une règle de
ce site, et pas du hub — la distinction est délibérée :

| Écran | Ce que voit le superadmin | Pourquoi |
|---|---|---|
| `idees` (hub) | **Tout** | C'est lui qui lit les idées pour les mettre en place |
| `fournisseurs`, `achats` | **Les siennes** | Ce sont des données personnelles, pas un bac commun |

Ne pas généraliser « superadmin = voit tout » : ça vaut là où les données sont partagées,
pas ici.

La règle Firestore, elle, lui accorde bien la lecture complète — deux raisons, aucune
contournable : sans ça l'impersonation n'afficherait rien, et il lit de toute façon la
base depuis la console Firebase. **La seule porte dans l'interface est l'impersonation**,
un geste explicite, signalé par un bandeau rayé permanent. En dehors de ça, l'écran ne
montre jamais les fiches d'un autre.

L'interface affiche en clair de qui elle montre les fiches, pour que « il n'y a rien » et
« il n'y a rien à moi » ne se confondent pas.

> **Les fiches créées avant ce cloisonnement n'ont pas de `proprietaire`.** Elles ne
> correspondent à aucune requête filtrée et sont donc invisibles. Firestore ne sait pas
> interroger l'*absence* d'un champ — `where('proprietaire', '==', null)` ne trouve que
> les `null` explicites — il faut lire la collection entière, ce que seul le superadmin
> peut faire. La page le fait une fois au chargement et propose un bouton
> « Me les attribuer ». Le bandeau disparaît quand il n'y a plus rien à reprendre.

> ### ⚠ Les achats doivent l'être aussi — décidé, pas encore fait
>
> **Décision du 30 juillet 2026 : les achats ne sont pas communs.** Chacun gère les
> siens, et chaque ligne doit être rattachée au membre qui l'a créée. Ce n'est pas
> implémenté à ce jour : la collection `achats` reste ouverte à tous ceux qui ont le
> droit, et sa règle est encore `allow read, write: if aAcces('achats')`.
>
> Le patron à appliquer est celui décrit ci-dessus, à l'identique :
>
> 1. champ `proprietaire` sur chaque ligne d'achat, posé à la création, immuable ;
> 2. `where('proprietaire', '==', …)` dans `ecouterAchats()` — **obligatoire**, sans quoi
>    la page est entièrement vide et non pas partielle ;
> 3. règles séparées par opération dans `firestore.rules`, comme pour `fournisseurs` ;
> 4. reprise des lignes déjà saisies, qui n'ont pas le champ et deviendraient invisibles.
>
> Deux points à trancher au moment de le faire, parce qu'ils touchent le sens des
> chiffres et pas seulement les droits :
>
> - **Les doublons deviennent personnels par construction.** Aujourd'hui, si deux membres
>   saisissent chacun une ligne reçue « fève n°42 », le regroupement par nom d'article les
>   voit comme deux exemplaires du même article et signale un doublon revendable. Après
>   cloisonnement, non : chacun n'en a qu'un chez lui. C'est cohérent avec « chacun sa
>   collection », mais il faut le vouloir — ça change la réponse à « qu'est-ce que je peux
>   revendre ? ».
> - **Le bandeau de chiffres devient personnel** (« Dépensé », « À payer »…). S'il faut un
>   total pour le foyer, il demandera une lecture que les règles refusent aux membres.

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

### L'ordre des comptes

Un champ `ordre` (entier, 0 = premier) se règle au **glisser-déposer**, par la poignée
à gauche de chaque fiche. Trois décisions qui méritent d'être écrites :

- **Le principal passe toujours devant**, quel que soit son `ordre`. C'est une promesse
  de l'interface, pas une conséquence du rang : il porte une punaise au lieu d'une
  poignée, et reste une cible de dépôt valide — y déposer une fiche revient à la placer
  juste après lui.
- **On se déplace vers la cible** : en descendant, la fiche passe *après* elle ; en
  remontant, *avant*. Aucune géométrie n'est interprétée, donc le geste se comporte
  pareil que les fiches soient l'une sous l'autre ou côte à côte — ce que la grille
  fait selon la largeur de l'écran.
- **Seule la poignée est saisissable**, pas la fiche entière : rendre l'article
  `draggable` empêcherait de sélectionner l'email ou le mot de passe à la souris. Elle
  n'est déplaçable que le temps d'un appui sur la poignée.

Les rangs sont réécrits **en entier** pour le fournisseur concerné à chaque dépôt.
Avec deux ou trois comptes, n'écrire que le strict minimum coûterait plus en complexité
que les écritures épargnées. Les comptes créés avant cette possibilité n'ont pas de
`ordre` et retombent sur l'alphabet, après ceux qui en ont un.

> Le glisser-déposer HTML5 ne fonctionne pas au doigt : sur mobile, l'ordre reste celui
> défini depuis un ordinateur.

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

**À plusieurs, le risque ne s'additionne pas.** Grâce au cloisonnement par
`proprietaire`, chaque membre ne détient que ses propres identifiants : ouvrir la page à
quelqu'un n'expose rien de ce qui existe déjà. Ce qui reste vrai pour chacun, c'est la
concentration sur **son** compte Google — la consigne des deux paragraphes ci-dessus vaut
donc pour tout le monde, et pas seulement pour le propriétaire du hub.

Le superadmin, lui, garde un accès de lecture à tout par les règles et par la console. Ce
n'est pas contournable, et ce n'est pas caché : c'est écrit dans les règles, l'interface ne
lui montre que ses propres fiches par défaut, et la seule façon d'en voir d'autres est
l'impersonation — un geste explicite, sous bandeau rayé. **À dire aux membres** : ce n'est
pas un coffre-fort dont on serait seul à avoir la clé.

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
| `config.js` | Config Firebase (la même que le hub) et adresse du propriétaire |
| `projets.js` | Registre des pages — source du menu et de la garde |
| `auth.js` | Le vigile : droits, garde, en-tête, impersonation |
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

`hub-utils.js` est une copie conforme du hub. `auth.js` et `style.css` en sont dérivés
mais **ont divergé volontairement** — deux copies coûtent moins cher qu'un mécanisme de
partage sur une stack sans build, mais il ne faut plus y reporter une correction du hub
sans regarder :

| Fichier | Ce qui diffère du hub |
|---|---|
| `auth.js` | Pas de page Membres (les accès se donnent dans le hub) ; sélecteur d'impersonation dans l'en-tête ; garde sans redirection en boucle ; site à plat, pas de `data-racine` |
| `style.css` | Les classes `.idee-*` renommées en `.data-table`, `.cell-*`, `.ligne--terne` — ce site n'a pas de page « idées » |

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

Le bloc `fournisseurs` est plus long que ça : il **cloisonne par `proprietaire`** (voir
« Chacun chez soi »). C'est la seule barrière entre des mots de passe en clair et le reste
d'Internet — ne jamais l'élargir « pour dépanner ».

> ⚠ **Le cloisonnement est arrivé après une première version du bloc.** Si la version
> publiée dans la console est l'ancienne (`allow read, write: if aAcces('fournisseurs')`),
> chacun voit tout : republier `firestore.rules` est ce qui applique réellement la
> séparation. Le message d'erreur de la page mentionne ce cas.

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

0. **Cloisonner les achats par membre** — décidé le 30/07/2026, à faire en premier.
   Chaque ligne rattachée à son créateur, même patron que `fournisseurs`. Détails et
   points à trancher dans « Les achats doivent l'être aussi » ci-dessus. À faire **avant**
   l'inventaire : celui-ci s'agrège depuis les achats, il héritera du découpage.
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
