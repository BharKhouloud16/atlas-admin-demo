// Périmètre fonctionnel de la V1 (décision produit du 25/10/2026).
//
// La vidéo de présentation des ingénieurs est reportée à la V2 : elle est
// MASQUÉE dans les trois interfaces (Ingénieur, Admin, Client), sans
// suppression des données (Profil.video*), du code, des routes ni des
// migrations. Les routes /api/ingenieur/video* gardent leurs contrôles
// d'accès (session, mission du Client, lien signé) : rien n'est ouvert.
// Réactiver en V2 : passer à true, puis tester les trois interfaces.
export const VIDEO_PRESENTATION_ACTIVE = false;
