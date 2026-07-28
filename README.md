# Collections — `collections.ofildudoubs.fr`

Coquille en place, **contenu à définir**. Le sous-domaine, l'hébergement GitHub Pages
et l'authentification Google fonctionnent : il ne reste qu'à décider ce que le site
fait.

Accès réservé à **cyril.samson41@gmail.com**.

## Architecture

Identique au [hub admin](https://github.com/Cyril25/Admin), dont `auth.js`
et `style.css` sont des copies conformes. **Même projet Firebase** : une seule console,
une seule liste de domaines autorisés, un seul jeu de règles Firestore.

| Fichier | Rôle |
|---|---|
| `config.js` | Config Firebase (la même que le hub), emails autorisés, navigation |
| `auth.js` | Le vigile — copie de celui du hub |
| `login.html` | Page de connexion Google |
| `index.html` | Page d'accueil, actuellement un simple placeholder |
| `style.css` | Feuille de styles — copie de celle du hub |
| `CNAME` | Domaine custom GitHub Pages |

Pas de `firestore.rules` ici : les règles vivent dans le dépôt du hub et couvrent tout
le projet Firebase. **Toute nouvelle collection utilisée par ce site doit y être
déclarée**, sinon Firestore refuse la lecture — c'est le catch-all `if false` qui
ferme le reste.

`auth.js` et `style.css` sont dupliqués volontairement : deux copies de deux fichiers
coûtent moins cher qu'un mécanisme de partage (submodule, build, CDN) sur une stack
sans build. Si les deux sites divergent durablement, ce n'est plus un problème ; s'ils
doivent rester identiques, penser à reporter les corrections des deux côtés.

## Mise en place

1. **Firebase** — rien à créer : réutiliser le projet du hub. Deux choses à faire dans
   la console :
   - **Authentication → Settings → Authorized domains** → ajouter
     `collections.ofildudoubs.fr`
   - copier l'objet `firebaseConfig` du hub dans `config.js`
2. **GitHub** — dépôt public `Cyril25/Collections`, puis
   **Settings → Pages** : branche `main`, dossier `/ (root)`. Le `CNAME` renseigne le
   domaine custom ; cocher **Enforce HTTPS** une fois le certificat émis.
3. **DNS Cloudflare** — zone `ofildudoubs.fr` :

   | Type | Nom | Cible | Proxy |
   |---|---|---|---|
   | CNAME | `collections` | `cyril25.github.io` | **DNS only** (nuage gris) |

   Le proxy orange casse l'émission du certificat Let's Encrypt de GitHub Pages.

## Développement local

```bash
python -m http.server 8080
# puis http://localhost:8080/login.html
```
