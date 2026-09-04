CREATE TABLE "VersionCv" (
    "id" TEXT NOT NULL,
    "profilId" TEXT NOT NULL,
    "cvUrl" TEXT NOT NULL,
    "cvNomFichier" TEXT,
    "importeLe" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VersionCv_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VersionCv_profilId_idx" ON "VersionCv"("profilId");

ALTER TABLE "VersionCv" ADD CONSTRAINT "VersionCv_profilId_fkey" FOREIGN KEY ("profilId") REFERENCES "Profil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
