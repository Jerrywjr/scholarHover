# Scholar Hover · Avis de confidentialité

Version 0.3.1 · 2026-09-16

[简体中文](privacy.md) · [English](privacy.en.md) · [Deutsch](privacy.de.md)

Cette extension complète uniquement les pages de résultats que l’utilisateur ouvre sur https://scholar.google.com/scholar. Elle lit le titre, les auteurs, l’année, le support de publication et les liens du résultat activé afin d’identifier l’article. Elle n’automatise ni les recherches ni le passage aux pages suivantes ; les téléchargements de textes intégraux sont lancés explicitement par l’utilisateur dans le gestionnaire. Elle ne nécessite aucun compte produit et ne dispose pas de serveur exploité par le projet.

## Destinataires des données

- OpenAlex reçoit le DOI ou le titre de l’article activé pour obtenir ses métadonnées et son résumé original. Si une clé OpenAlex est renseignée, elle est envoyée uniquement à api.openalex.org.
- Crossref reçoit le DOI lorsque cela est nécessaire pour compléter les métadonnées manquantes du même article.
- Le service de modèle configuré par l’utilisateur reçoit le titre de l’article, le résumé original obtenu et les instructions de traduction dans la langue de sortie choisie, uniquement après configuration et consentement à cet envoi externe. En l’absence de résumé original, seuls le titre et les instructions de traduction sont envoyés ; aucun résumé traduit ni aucune synthèse ne sont générés. La clé API du modèle est envoyée uniquement à l’adresse HTTPS configurée. Le prestataire définit ses propres règles de conservation des données.
- Le mode automatique peut appeler le modèle après un survol déclencheur et entraîner des frais. La génération peut être configurée pour nécessiter un clic. Fermer l’interface ne garantit pas l’annulation des frais déjà engagés auprès du prestataire.

La langue de l’interface et celle des résultats peuvent être choisies indépendamment parmi le chinois simplifié, l’anglais, le français et l’allemand. Le chinois simplifié est la valeur par défaut des deux réglages. Les préférences linguistiques sont conservées localement. Modifier uniquement la langue de l’interface permet de réutiliser le cache de génération ; chaque langue de sortie utilise des entrées distinctes. Les traductions ne remplacent pas les informations originales de l’article.

## Stockage local

Par défaut, les clés sont conservées dans le stockage de session de l’extension et sont supprimées au redémarrage du navigateur. Si leur conservation locale est activée, elles sont enregistrées dans le stockage local de l’extension. Il ne s’agit ni d’un coffre-fort de mots de passe du système ni d’une garantie de conservation chiffrée. Les clés ne sont pas écrites dans les pages web, le stockage synchronisé, les outils d’analyse ou les journaux. Les scripts de contenu des pages ne peuvent pas lire le stockage des clés. Les clés peuvent être supprimées à tout moment.

Les données des articles et les résultats générés sont mis en cache uniquement sur l’appareil. Le cache de génération est limité à 200 entrées, sept jours et 4 Mio ; les résultats de modèles ou de langues de sortie différents occupent des entrées distinctes, même pour un seul article. Vider le cache, effacer les clés et désinstaller l’extension produisent leurs effets de suppression locale respectifs. Ces actions ne peuvent pas supprimer les données déjà reçues par un prestataire.

## Autorisations et contrôles

L’extension fonctionne uniquement sur les pages de recherche d’articles de Scholar. Les autorisations OpenAlex et Crossref servent à consulter les métadonnées. L’accès au domaine d’un modèle personnalisé est demandé séparément lorsque l’utilisateur enregistre sa configuration. La plage facultative de domaines HTTPS du manifeste permet d’utiliser des adresses personnalisées ; l’installation n’accorde pas l’accès à tous les sites web. L’autorisation `offscreen` permet à une page cachée appartenant à l’extension et à un Worker dédié d’attendre les réponses lentes du modèle. Cette page ne lit pas le contenu des sites, et la clé du modèle n’est envoyée qu’au service configuré.

Cette version ne contient ni publicité, ni télémétrie automatique, ni envoi en arrière-plan de l’historique d’utilisation. Les diagnostics de test sont conservés localement ; vérifiez leur contenu avant de les partager. Les résultats du modèle peuvent être erronés. Les traductions de résumés et les synthèses indiquent les sources sur lesquelles elles reposent ; elles ne remplacent ni les conclusions tirées du texte intégral ni une évaluation de la qualité de l’article. Les essais sur des pages réelles et les vérifications humaines, notamment par des locuteurs natifs des quatre langues, ne sont pas terminés.

Ce paquet de test n’a pas été publié. La publication sur un dépôt GitHub public attend la confirmation explicite de l’utilisateur après son essai. Avant une publication officielle en boutique, l’éditeur doit fournir sur la fiche de l’extension un moyen de contact fonctionnel et une adresse publique pour le présent avis de confidentialité.

## Enregistrement et export explicites (0.3.0)

Enregistrer un article conserve les métadonnées, liens sources et traductions disponibles dans une collection locale distincte, limitée à 200 articles et 4 Mio, sans expiration automatique. Les données restent jusqu’à leur suppression, l’effacement de la collection ou la désinstallation. La durée de sept jours du cache de génération et son effacement ne concernent pas cette collection. Une génération ultérieure réussie met à jour l’article enregistré uniquement si le contenu source correspond toujours.

L’export Markdown et des originaux utilise l’autorisation downloads pour créer un fichier Markdown et tenter de télécharger les PDF connus. Les requêtes vont au fournisseur du texte intégral, avec les cookies existants du site transmis par Chrome ; aucune clé de modèle ou OpenAlex ne lui est envoyée. Le texte intégral n’est pas transmis au modèle. Les échecs sont expliqués ; la page originale du premier échec du lot s’ouvre automatiquement et les autres disposent de liens. L’utilisateur effectue lui-même la connexion, l’authentification institutionnelle et les CAPTCHA.

Les noms de fichiers, liens sources et états du dernier lot sont conservés localement pour vérification et nouvelle tentative. Une réponse non PDF n’est pas considérée comme un succès ; l’extension tente de supprimer uniquement ce fichier invalide créé par le lot. Les fichiers exportés restent dans le dossier de téléchargement après suppression de la collection, du cache ou de l’extension. Aucun envoi en arrière-plan ni aucune télémétrie n’est ajouté.
