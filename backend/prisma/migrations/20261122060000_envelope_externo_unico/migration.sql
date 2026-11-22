-- O mesmo envelope externo (rsf-signer) nunca responde por dois termos
DROP INDEX "Envelope_provedor_idExterno_idx";

CREATE UNIQUE INDEX "Envelope_provedor_idExterno_key" ON "Envelope"("provedor", "idExterno");
