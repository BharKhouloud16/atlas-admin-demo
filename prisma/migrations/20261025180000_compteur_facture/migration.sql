-- Numérotation réglementaire des factures (lib/billing/transitions.ts).
-- Ajout pur : nouvelle table, aucune donnée existante modifiée ; les
-- factures déjà numérotées gardent leur numéro.
CREATE TABLE "CompteurFacture" (
    "annee" INTEGER NOT NULL,
    "dernier" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompteurFacture_pkey" PRIMARY KEY ("annee")
);
