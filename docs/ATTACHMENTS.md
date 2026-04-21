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
