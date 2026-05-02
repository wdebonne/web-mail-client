# Pieces Jointes

Guide dedie a la gestion des pieces jointes dans WebMail.

## Objectifs

- Donner une vue claire des modes d'ouverture disponibles.
- Lister les formats pris en charge pour l'apercu.
- Expliquer les limites de rendu connues.
- Documenter la trajectoire d'amelioration vers un rendu bureautique plus fidele via l'ecosysteme NextCloud Office.

---

## Modes d'ouverture (utilisateur)

Chaque utilisateur peut choisir son comportement d'ouverture des pieces jointes :

- Apercu : ouvre directement la modal d'apercu.
- Telechargement : telecharge directement le fichier.
- Menu : propose Apercu ou Telechargement a chaque clic.

Configuration disponible dans :

- Ruban : Afficher > Piece jointe
- Parametres : Parametres > Messagerie

---

## Enregistrer dans Nextcloud

Quand l'utilisateur courant est lie a un compte Nextcloud (voir `docs/NEXTCLOUD.md`), une option supplementaire apparait pour chaque piece jointe : **Enregistrer dans Nextcloud**.

### Points d'entree dans l'UI

- Icone *nuage* a cote de chaque piece jointe (modes Apercu et Telechargement).
- Entree *Enregistrer dans Nextcloud* dans le menu deroulant (mode Menu).
- Bouton *Nextcloud* dans l'en-tete de la modal d'apercu plein ecran.
- Bouton *Tout enregistrer dans Nextcloud* en debut de barre, qui telecharge en une seule action toutes les pieces jointes du message vers le meme dossier.

### Selection du dossier

Une modale liste les dossiers du drive Files de l'utilisateur :

- Navigation par fil d'Ariane cliquable + bouton *Racine* + remontee d'un niveau.
- Bouton *Creer* qui accepte un nom simple ou un chemin multi-niveaux (par exemple `2026/Factures/Mai`) et cree toute l'arborescence manquante en une seule etape.
- Bouton *Enregistrer ici* qui valide le dossier courant.

### Anti-collision et limites

- Si un fichier du meme nom existe deja, un suffixe ` (2)`, ` (3)`, ... est applique automatiquement.
- Taille maximale par fichier : 100 Mo (limite serveur).
- Les chemins contenant `..` ou `\` sont nettoyes cote serveur avant tout appel WebDAV.
- Si Nextcloud n'est pas lie pour l'utilisateur, aucune option de sauvegarde n'apparait.

### API associee

Voir la section `Nextcloud Files (par utilisateur)` dans `API.md` :

- `GET /api/nextcloud/files/status`
- `GET /api/nextcloud/files/list?path=...`
- `POST /api/nextcloud/files/mkdir`
- `POST /api/nextcloud/files/upload`

---

## Formats d'apercu

### Images

- JPEG/JPG
- PNG
- GIF
- WEBP
- HEIC/HEIF (conversion cote client)

### Documents

- PDF : rendu via iframe blob dans la modal
- DOCX : rendu HTML simplifie
- XLSX : rendu HTML simplifie (feuille principale)

---

## Limites connues (etat actuel)

Les apercus DOCX/XLSX fournis localement privilegient la lisibilite du contenu et ne reproduisent pas toujours la mise en page exacte de Microsoft Office :

- styles avances partiellement restitues
- mise en page complexe non garantie
- ecarts possibles sur colonnes, tailles, bordures, zones figees, etc.

Ce comportement est normal avec un rendu local simplifie sans moteur Office complet.

---

## Securite et CSP

Pour l'apercu PDF en iframe blob, la politique CSP inclut une directive frame-src compatible avec blob/data.

Si l'apercu PDF est bloque, verifier :

- redemarrage du backend apres modification CSP
- vidage du cache navigateur (Ctrl+F5)
- absence de proxy inverse qui ecrase les headers CSP

---

## Roadmap NextCloud Office

Un rendu plus fidele DOCX/XLSX est prevu via l'ecosysteme NextCloud Office (selon les applications activees sur votre instance, par exemple Collabora ou OnlyOffice).

Objectif cible :

- rapprocher le rendu visuel de Word/Excel
- conserver les preferences utilisateur de comportement (Apercu/Telechargement/Menu)
- maintenir un fallback local si le service Office externe est indisponible

---

## Depannage rapide

- La modal ne se ferme pas : cliquer hors contenu, bouton fermer, ou touche Echap.
- PDF vide : verifier CSP et recharger la page.
- DOCX/XLSX differents de Microsoft Office : attendu en mode local simplifie, utiliser le telechargement pour le rendu natif.
